import * as THREE from 'three';
import { createCable, CableWorld, type Cable, type Port, type PortKind } from '../cable/cable';
import { CableMesh } from '../cable/cableMesh';
import type { Aabb, Vec3 } from '../cable/collide';
import { guideOf, type Guide } from '../cable/guide';
import { plug, unplug, type PortHit } from '../cable/plug';
import { findRoute, laneOffsets, routePath, tidyDegree, type LaneOffset } from '../cable/route';
import { events } from '../core/events';
import { createRng } from '../core/rng';
import { isSideDef, type DeviceDefId, type SideDefId } from '../data/catalog';
import { CABLE_DEFAULT_LENGTH, RACK_HEIGHT } from '../data/units';
import { BOOT_MS, resetBreaker, updatePower, type PowerSummary } from '../game/power';
import { round3, type SaveData, type SavedCable, type SavedDevice } from '../game/save';
import { createPdu, createRackDevice, createSideManager, PDU_SIDES, setDeviceLed, setDevicePower, type Device, type Socket } from '../rack/device';
import { RackSlots } from '../rack/rack';
import { collectColliders } from './scene';

// 서버실: 랙 슬롯표 + 장비 + 케이블 월드. 장비를 끼우면 포트·충돌 상자를 월드에 더한다.
// 가동 판정은 updatePower(now): 꽂힌 케이블로 포트 연결표를 만들어 power.ts에 넘긴다.

const LAN_COLORS = [0x2f7fd8, 0xe0b020, 0x38a860, 0xd0483c];
const POWER_COLOR = 0x23262b;
const BLINK_COLOR = new THREE.Color(0xd9a400);

/** 정리 보상: 장비에 꽂힌 선이 모두 다 묶였을 때 줄어드는 전력 비율 (첫 값, 플레이로 조정) */
export const TIDY_POWER_CUT = 0.15;
/** 묶이지 않은 가이드 구간의 구불거림 진폭 m (tight 1이면 0) — 차선이 벌어지는 방향과 수직(z)으로 */
const WOBBLE = 0.008;
/** 구불거림 주기 m */
const WOBBLE_PERIOD = 0.25;

function polylineLength(pts: Vec3[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  }
  return L;
}

export class Room {
  readonly world = new CableWorld();
  readonly slots = new RackSlots();
  readonly devices: Device[] = [];
  readonly meshes: CableMesh[] = [];
  private readonly sockets = new Map<Port, Socket>();
  /** 장비마다 월드에 더한 충돌 상자 (빼기에서 다시 걷어냄) */
  private readonly boxes = new Map<Device, Aabb[]>();
  private hinted: Socket | null = null;
  private serial = 0;
  /** 케이블 id 번호 — 팔아도 되돌리지 않아 id가 겹치지 않음 (불러오면 저장된 id의 가장 큰 번호 다음부터) */
  private cableSerial = 0;
  /** 가이드마다 선을 묶은 순서 (차선 순서). 풀린 선이 남아 있어도 laneMap이 지금 묶인 선만 고름 */
  private readonly tieOrder = new Map<string, Cable[]>();
  private spawned = 0;
  private stressCables: Cable[] = [];
  private readonly rng = createRng(42);
  /** 마지막 가동 판정 결과 */
  summary: PowerSummary = { incomePerSec: 0, powerUsed: 0, powerCap: 0 };

  /** 초당 수익 */
  get incomePerSec(): number {
    return this.summary.incomePerSec;
  }

  constructor(
    private readonly scene: THREE.Scene,
    readonly rack: THREE.Group,
  ) {
    this.world.colliders.push(...collectColliders(rack));
    // 어디서든 커넥터가 뽑히면 경로에서 빠짐. 버스는 전역이고 id만 오므로 id로 찾지 않고,
    // 이 방의 선 중 경로에 든 채 끝이 빠진 선(그 객체)을 푼다 (장비 빼기·판매는 Cable 객체로 직접 푼다)
    events.on('cable:unplugged', () => {
      for (const c of this.world.cables) if (c.route && (!c.ends[0] || !c.ends[1])) this.unroute(c);
    });
  }

  /** 빈 칸이면 끼우고 장비를 돌려줌. id는 불러오기에서만 지정 (포트 id가 같아야 케이블을 다시 꽂음) */
  install(defId: DeviceDefId, u: number, id = `${defId}#${++this.serial}`): Device | null {
    const { device, sockets } = createRackDevice(id, defId, u);
    if (!this.slots.place(id, u, device.def.sizeU)) return null;
    this.rack.add(device.group);
    this.addDevice(device, sockets);
    events.emit('device:installed', { deviceId: id });
    return device;
  }

  /** 그 옆면 장비의 비어 있는 자리 (없으면 null). PDU와 세로 매니저는 자리가 따로 (각각 왼쪽·오른쪽) */
  freeSide(defId: SideDefId): number | null {
    for (let side = 0; side < PDU_SIDES; side++) if (!this.devices.some((d) => d.def.id === defId && d.side === side)) return side;
    return null;
  }

  freePduSide(): number | null {
    return this.freeSide('pdu');
  }

  /** 빈 옆면에 붙임 (자리 없으면 null) */
  addSide(defId: SideDefId, side = this.freeSide(defId), id = `${defId}#${++this.serial}`): Device | null {
    if (side === null || this.devices.some((d) => d.def.id === defId && d.side === side)) return null;
    const { device, sockets } = defId === 'pdu' ? createPdu(id, side) : createSideManager(id, side);
    this.scene.add(device.group);
    this.addDevice(device, sockets);
    return device;
  }

  addPdu(side = this.freePduSide(), id = `pdu#${++this.serial}`): Device | null {
    return this.addSide('pdu', side, id);
  }

  private addDevice(device: Device, sockets: Socket[]) {
    this.devices.push(device);
    for (const s of sockets) {
      this.sockets.set(s.port, s);
      this.world.ports.push(s.port);
    }
    const boxes = collectColliders(device.group);
    this.boxes.set(device, boxes);
    this.world.colliders.push(...boxes);
    // 새 상자에 잠든 케이블이 박힌 채 남지 않게 모두 깨움
    for (const c of this.world.cables) c.rope.wake();
  }

  /** 랙 장비를 뺌: 꽂힌 케이블을 뽑고 포트·충돌 상자·메시를 걷어냄. 옆면 PDU는 판매(allowPdu)로만 뺀다 */
  remove(device: Device, allowPdu = false): boolean {
    const i = this.devices.indexOf(device);
    if (i < 0 || (device.u === null && !allowPdu)) return false;
    // 매니저면 그 가이드를 지나던 선만 경로에서 빠짐
    for (const c of this.world.cables) if (c.route?.guides.includes(device.id)) this.unroute(c);
    for (const port of device.ports) {
      if (port.plugged) {
        // 꽂힌 그 선을 먼저 경로에서 뺌 (id로 찾지 않음)
        this.unroute(port.plugged.cable);
        unplug(port.plugged.cable, port.plugged.end);
      }
      if (this.hinted?.port === port) this.hinted = null;
      this.sockets.delete(port);
    }
    const ports = new Set(device.ports);
    const boxes = new Set(this.boxes.get(device));
    this.boxes.delete(device);
    removeWhere(this.world.ports, (p) => ports.has(p));
    removeWhere(this.world.colliders, (b) => boxes.has(b));
    this.devices.splice(i, 1);
    this.slots.remove(device.id);
    device.group.removeFromParent(); // 랙 장비는 랙 그룹, PDU는 장면에 붙어 있음
    device.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
    // 받치던 상자가 사라졌으니 걸쳐 있던 케이블이 떨어지게
    for (const c of this.world.cables) c.rope.wake();
    events.emit('device:removed', { deviceId: device.id });
    return true;
  }

  device(id: string): Device | undefined {
    return this.devices.find((d) => d.id === id);
  }

  setPower(device: Device, on: boolean): void {
    if (device.on === on) return;
    setDevicePower(device, on);
    events.emit('device:power', { deviceId: device.id, on });
  }

  /** 가동 판정 + LED. 매 틱과 배선·전원 이벤트마다 */
  updatePower(now: number): PowerSummary {
    const links = new Map<string, string>();
    for (const c of this.world.cables) {
      const [a, b] = c.ends;
      if (!a || !b) continue;
      links.set(a.id, b.id);
      links.set(b.id, a.id);
    }
    // 정리 보상: 장비 포트에 꽂힌 선들의 정리 정도 평균만큼 전력이 줄어듦
    for (const d of this.devices) {
      const plugged = d.ports.flatMap((p) => (p.plugged ? [p.plugged.cable] : []));
      const avg = plugged.length ? plugged.reduce((s, c) => s + tidyDegree(c.route), 0) / plugged.length : 0;
      d.power.saving = TIDY_POWER_CUT * avg;
    }
    const wasTripped = new Set(this.devices.filter((d) => d.power.tripped));
    this.summary = updatePower(
      this.devices.map((d) => d.power),
      links,
      now,
    );
    for (const d of this.devices) {
      setDeviceLed(d);
      if (d.power.tripped && !wasTripped.has(d)) events.emit('pdu:tripped', { deviceId: d.id });
    }
    return this.summary;
  }

  /** 차단기 올림. 부하가 그대로면 다음 판정에서 또 내려감 */
  resetBreaker(pdu: Device): void {
    if (!pdu.power.tripped) return;
    resetBreaker(pdu.power);
    events.emit('pdu:reset', { deviceId: pdu.id });
  }

  private addCable(kind: PortKind, saved?: SavedCable): Cable {
    const n = this.world.cables.length;
    const color = saved?.color ?? (kind === 'lan' ? LAN_COLORS[n % LAN_COLORS.length] : POWER_COLOR);
    // 저장된 id는 그대로 (옛 저장 포함), 번호는 그보다 뒤로
    const num = saved && /^cable-(\d+)$/.exec(saved.id);
    if (num) this.cableSerial = Math.max(this.cableSerial, Number(num[1]) + 1);
    const c = createCable(saved?.id ?? `cable-${this.cableSerial++}`, kind, CABLE_DEFAULT_LENGTH, color);
    this.world.cables.push(c);
    const m = new CableMesh(c);
    this.scene.add(m.group);
    this.meshes.push(m);
    return c;
  }

  /**
   * 상점에서 산 케이블: 랙 바로 뒤 바닥에 U자로 접어 놓음. 양 끝은 PDU 쪽(-x)에 모여
   * 뒷면 시점에서 하단 툴바·상점 패널에 가리지 않는다. 놓을 때마다 조금씩 뒤로
   */
  spawnCable(kind: PortKind, paid = 0): Cable {
    const c = this.addCable(kind);
    c.paid = paid;
    const z = -0.62 - (this.spawned++ % 4) * 0.12;
    const y = c.rope.cfg.radius + 0.02;
    const x0 = -0.42, x1 = 0.5, w = 0.08;
    c.rope.setFromPolyline([[x0, y, z], [x1, y, z], [x1, y, z - w], [x0, y, z - w]]);
    return c;
  }

  /** 케이블을 없앰 (판매): 뽑고 메시를 걷어냄 */
  removeCable(cable: Cable): void {
    const i = this.world.cables.indexOf(cable);
    if (i < 0) return;
    this.unroute(cable);
    for (const end of [0, 1] as const) unplug(cable, end);
    this.world.cables.splice(i, 1);
    for (const order of this.tieOrder.values()) removeWhere(order, (x) => x === cable);
    const k = this.meshes.findIndex((m) => m.cable === cable);
    if (k >= 0) {
      this.scene.remove(this.meshes[k].group);
      this.meshes[k].dispose();
      this.meshes.splice(k, 1);
    }
  }

  /** 설치된 매니저들의 가이드 */
  guides(): Guide[] {
    return this.devices.flatMap((d) => guideOf(d) ?? []);
  }

  /** 선을 가이드에 올림: 양 끝이 꽂혀 있으면 그 가이드를 포함하는 경로를 찾아 깖 (묶음은 비움) */
  routeCable(cable: Cable, guideId: string): boolean {
    const [a, b] = cable.ends;
    if (!a || !b) return false;
    const seq = findRoute(a, b, this.guides(), guideId, cable.rope.length);
    if (!seq) return false;
    this.setRoute(cable, seq.map((g) => g.id), []);
    events.emit('cable:routed', { cableId: cable.id });
    return true;
  }

  /** 저장·옮기기 복원용: 그 가이드 순서 그대로 경로를 깖 (길이 검사 없음) */
  routeWith(cable: Cable, guideIds: readonly string[], tied: readonly string[]): boolean {
    if (!cable.ends[0] || !cable.ends[1] || guideIds.length === 0) return false;
    const have = new Set(this.guides().map((g) => g.id));
    if (!guideIds.every((id) => have.has(id))) return false;
    // 묶은 순서는 그대로 (옮기기 뒤에도 같은 차선). 처음 보는 선만 뒤에 붙임
    for (const id of tied) {
      const order = this.tieOrderOf(id);
      if (!order.includes(cable)) order.push(cable);
    }
    this.setRoute(cable, [...guideIds], [...tied]);
    return true;
  }

  private setRoute(cable: Cable, guides: string[], tied: string[]): void {
    const touched = new Set([...(cable.route?.guides ?? []), ...guides]);
    cable.route = { guides, tied };
    for (const id of touched) this.relayout(id);
  }

  /** 경로에서 뺌: 지금 마디 자리에서 다시 물리로 (경로가 2m보다 길었으면 제약이 당겨 줄임) */
  unroute(cable: Cable): void {
    const route = cable.route;
    if (!route) return;
    cable.route = null;
    cable.rope.frozen = false;
    cable.rope.wake();
    for (const id of route.guides) this.relayout(id);
    events.emit('cable:unrouted', { cableId: cable.id });
  }

  /** 가이드 한 구간을 묶음: 그 가이드를 지나면서 아직 안 묶인 선들을 묶고 돌려줌 */
  tieGuide(guideId: string): Cable[] {
    const tied = this.world.cables.filter((c) => c.route?.guides.includes(guideId) && !c.route.tied.includes(guideId));
    if (tied.length === 0) return tied;
    // 새로 묶인 선은 묶인 순서 맨 뒤로 (전에 묶였다 풀린 선도)
    const order = this.tieOrderOf(guideId);
    for (const c of tied) {
      c.route!.tied.push(guideId);
      removeWhere(order, (x) => x === c);
      order.push(c);
    }
    this.relayout(guideId);
    events.emit('cable:tied', { guideId, cableIds: tied.map((c) => c.id) });
    return tied;
  }

  private tieOrderOf(guideId: string): Cable[] {
    let order = this.tieOrder.get(guideId);
    if (!order) this.tieOrder.set(guideId, (order = []));
    return order;
  }

  /**
   * 그 가이드의 차선 (지나는 경로 선마다 오프셋). 가이드 하나에 격자 하나: 간격은 그 가이드에서 가장 굵은 선 기준.
   * 묶인 선이 앞 차선(묶은 순서), 안 묶인 선이 그 뒤(world.cables 순서). tight = 안 묶인 선의 tight (묶인 선은 늘 1)
   */
  laneMap(guideId: string, tight = 0): Map<Cable, LaneOffset> {
    const passing = this.world.cables.filter((c) => c.route?.guides.includes(guideId));
    const order = this.tieOrder.get(guideId) ?? [];
    const rank = (c: Cable) => {
      const i = order.indexOf(c);
      return i < 0 ? Infinity : i;
    };
    // 묶은 순서를 모르는 선(순서 목록 밖)은 world.cables 순서로 뒤에 (sort는 안정 정렬)
    const tied = passing.filter((c) => c.route!.tied.includes(guideId)).sort((p, q) => rank(p) - rank(q));
    const untied = passing.filter((c) => !c.route!.tied.includes(guideId));
    const maxRadius = Math.max(0, ...passing.map((c) => c.rope.cfg.radius));
    const offsets = laneOffsets(passing.length, tied.length, tight, maxRadius);
    return new Map([...tied, ...untied].map((c, k) => [c, offsets[k]!]));
  }

  /**
   * 그 가이드(없으면 모든 가이드)를 지나는 경로 선들의 마디를 다시 깖. 차선은 laneMap.
   * tight: 가이드 id → 0..1 — 그 가이드에서 아직 안 묶인 선에만 적용 (묶는 연출). 이미 묶인 선은 늘 1, 그 밖엔 0
   */
  relayout(guideId?: string, tight?: ReadonlyMap<string, number>): void {
    const byId = new Map(this.guides().map((g) => [g.id, g]));
    const lanesOn = new Map<string, Map<Cable, LaneOffset>>();
    const lanesOf = (id: string) => {
      let m = lanesOn.get(id);
      if (!m) lanesOn.set(id, (m = this.laneMap(id, tight?.get(id) ?? 0)));
      return m;
    };
    for (const c of this.world.cables) {
      const route = c.route;
      const [a, b] = c.ends;
      if (!route || !a || !b || (guideId !== undefined && !route.guides.includes(guideId))) continue;
      const seq = route.guides.map((id) => byId.get(id));
      if (seq.some((g) => !g)) continue;
      const tights = route.guides.map((id) => (route.tied.includes(id) ? 1 : tight?.get(id) ?? 0));
      const lanes: LaneOffset[] = route.guides.map((id) => lanesOf(id).get(c)!);
      const pts = routePath(a, b, seq as Guide[], lanes);
      c.rope.setPath(pts);
      wobble(c, pts, tights);
    }
  }

  /** 시작 배선: 두 포트 사이를 바닥에 늘어진 모양으로 미리 깔고 꽂음 */
  wire(a: Port, b: Port): Cable {
    const c = this.addCable(a.kind);
    const out = (p: Port, k: number): Vec3 => [p.pos[0] + p.dir[0] * k, p.pos[1] + p.dir[1] * k, p.pos[2] + p.dir[2] * k];
    const a1 = out(a, 0.08), b1 = out(b, 0.08);
    const y = c.rope.cfg.radius;
    const af: Vec3 = [a1[0], y, a1[2] - 0.1], bf: Vec3 = [b1[0], y, b1[2] - 0.1];
    // 남는 길이는 바닥에 U자로 깔아 처음부터 케이블 길이와 맞춘다 (눌린 채 시작하면 구겨짐)
    const used = polylineLength([a.pos, a1, af, bf, b1, b.pos]);
    const extra = Math.max(0, c.rope.length - used) / 2;
    c.rope.setFromPolyline([a.pos, a1, af, [af[0], y, af[2] - extra], [bf[0], y, bf[2] - extra], bf, b1, b.pos]);
    plug(c, 0, a);
    plug(c, 1, b);
    return c;
  }

  /** 저장할 장비·케이블 (돈·구매 기록은 main이 GameState에서 붙임) */
  snapshot(): Pick<SaveData, 'serial' | 'spawned' | 'devices' | 'cables'> {
    const devices: SavedDevice[] = this.devices.map((d) => ({
      id: d.id, defId: d.def.id, u: d.u, side: d.side, on: d.on, tripped: d.power.tripped,
    }));
    const cables: SavedCable[] = this.world.cables
      .filter((c) => !this.stressCables.includes(c))
      .map((c) => ({
        id: c.id, kind: c.kind, color: c.color,
        ends: [c.ends[0]?.id ?? null, c.ends[1]?.id ?? null],
        nodes: Array.from(c.rope.pos, round3),
        ...(c.paid ? { paid: c.paid } : {}),
        ...(c.route ? { route: { guides: [...c.route.guides], tied: [...c.route.tied] } } : {}),
      }));
    return { serial: this.serial, spawned: this.spawned, devices, cables };
  }

  /** 불러오기: 저장된 id·자리로 장비를, 마디 좌표 그대로 케이블을 다시 만든다 */
  restore(data: Pick<SaveData, 'serial' | 'spawned' | 'devices' | 'cables'>): void {
    for (const d of data.devices) {
      const device = isSideDef(d.defId) ? this.addSide(d.defId, d.side, d.id) : d.u === null ? null : this.install(d.defId, d.u, d.id);
      if (!device) continue;
      if (device.def.id !== 'pdu') setDevicePower(device, d.on);
      device.power.tripped = d.tripped;
    }
    const portById = new Map(this.world.ports.map((p) => [p.id, p]));
    for (const saved of data.cables) {
      const c = this.addCable(saved.kind, saved);
      c.paid = saved.paid ?? 0;
      const { rope } = c;
      if (saved.nodes.length === rope.pos.length) {
        rope.pos.set(saved.nodes);
        rope.prev.set(saved.nodes);
        rope.wake();
      } else {
        // 케이블 길이가 바뀐 옛 저장: 꺾은선으로 다시 깐다
        const pts: Vec3[] = [];
        for (let i = 0; i < saved.nodes.length; i += 3) pts.push([saved.nodes[i], saved.nodes[i + 1], saved.nodes[i + 2]]);
        if (pts.length >= 2) rope.setFromPolyline(pts);
      }
      saved.ends.forEach((id, end) => {
        const port = id === null ? undefined : portById.get(id);
        if (port) plug(c, end as 0 | 1, port);
      });
      // 가이드가 없거나 끝이 빠졌으면 저장된 마디 그대로 늘어진 로프
      if (saved.route) this.routeWith(c, saved.route.guides, saved.route.tied);
    }
    this.serial = Math.max(this.serial, data.serial);
    this.spawned = data.spawned;
  }

  /** 측정용: 랙 위에서 떨어지는 케이블 n가닥 (redrop으로 다시) */
  addStress(n: number): void {
    for (let i = 0; i < n; i++) this.stressCables.push(this.addCable(this.rng() < 0.7 ? 'lan' : 'power'));
    this.redrop();
  }

  redrop(): void {
    const rng = this.rng;
    for (const c of this.stressCables) {
      const cx = (rng() - 0.5) * 0.8, cz = (rng() - 0.5) * 1.2;
      const y = RACK_HEIGHT + 0.1 + rng() * 0.8;
      const a = rng() * Math.PI;
      const h = c.rope.length / 2;
      c.rope.setFromPolyline([[cx - Math.cos(a) * h, y, cz - Math.sin(a) * h], [cx + Math.cos(a) * h, y, cz + Math.sin(a) * h]]);
    }
  }

  showPortHint = (hit: PortHit | null): void => {
    this.hinted = hit ? this.sockets.get(hit.port) ?? null : null;
    if (this.hinted && hit) emissive(this.hinted).setHex(hit.ok ? 0x22cc55 : 0xcc3322);
  };

  /** 메시 갱신 + 빈 포트 깜빡임 */
  sync(timeSec: number): void {
    for (const m of this.meshes) m.update();
    const k = 0.25 + 0.25 * Math.sin(timeSec * 5);
    for (const s of this.sockets.values()) {
      if (s === this.hinted) continue;
      const e = emissive(s);
      if (s.blink && !s.port.plugged) e.copy(BLINK_COLOR).multiplyScalar(k);
      else e.setHex(0x000000);
    }
  }
}

/**
 * 묶이지 않은 가이드 구간 마디를 z로 사인 모양 흔듦 (진폭 WOBBLE × (1 - tight)).
 * pts = routePath 꺾은선 [a, 스텁, (들어감, 나감)*, 스텁, b] — 마디는 setPath가 호 길이로 고르게 깔아 둠
 */
function wobble(c: Cable, pts: readonly Vec3[], tights: readonly number[]): void {
  const { rope } = c;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + polylineLength([pts[i - 1], pts[i]]));
  const total = cum[cum.length - 1];
  let moved = false;
  tights.forEach((t, k) => {
    const amp = WOBBLE * (1 - t);
    if (amp <= 0) return;
    const s0 = cum[2 + 2 * k], s1 = cum[3 + 2 * k];
    for (let i = 0; i < rope.n; i++) {
      const d = (total * i) / (rope.n - 1);
      if (d <= s0 || d >= s1) continue;
      rope.pos[i * 3 + 2] += amp * Math.sin((2 * Math.PI * (d - s0)) / WOBBLE_PERIOD);
      moved = true;
    }
  });
  if (!moved) return;
  rope.prev.set(rope.pos);
  rope.version++;
}

function removeWhere<T>(arr: T[], drop: (x: T) => boolean): void {
  let k = 0;
  for (const x of arr) if (!drop(x)) arr[k++] = x;
  arr.length = k;
}

function emissive(s: Socket): THREE.Color {
  return (s.mesh.material as THREE.MeshStandardMaterial).emissive;
}

/** 켜진 장비를 BOOT_MS 전에 켠 것으로 → 지금 판정에서 바로 가동 */
function bootNow(room: Room): void {
  const now = Date.now();
  room.updatePower(now - BOOT_MS);
  room.updatePower(now);
}

/** 저장에서 방을 다시 만듦. 켜진 장비는 이미 부팅된 것으로, 케이블은 원래 모양에서 조금만 안정화 */
export function restoreRoom(scene: THREE.Scene, rack: THREE.Group, data: SaveData): Room {
  const room = new Room(scene, rack);
  room.restore(data);
  bootNow(room);
  for (let i = 0; i < 20; i++) room.world.step(1 / 60);
  return room;
}

/** 계획서 4.4 시작 상태: 옆면 PDU, U1 스위치 8포트, U3 엔트리 서버. 전원선 2·랜선 1이 꽂혀 켜진 채 */
export function createStartRoom(scene: THREE.Scene, rack: THREE.Group): Room {
  const room = new Room(scene, rack);
  const pdu = room.addPdu()!;
  const sw = room.install('switch-8', 1)!;
  const entry = room.install('server-entry', 3)!;
  const port = (d: Device, kind: PortKind, nth = 0) => d.ports.filter((p) => p.kind === kind)[nth];
  room.wire(pdu.ports[0], port(sw, 'power'));
  room.wire(pdu.ports[1], port(entry, 'power'));
  room.wire(port(sw, 'lan'), port(entry, 'lan'));
  room.setPower(sw, true);
  room.setPower(entry, true);
  // 시작 장비는 이미 부팅이 끝난 상태로 → 처음부터 초당 1원
  bootNow(room);
  // 꽂힌 케이블이 늘어진 모양으로 자리 잡게 미리 돌림
  for (let i = 0; i < 240; i++) room.world.step(1 / 60);
  return room;
}
