import * as THREE from 'three';
import { createCable, CableWorld, type Cable, type Port, type PortKind } from '../cable/cable';
import { CableMesh } from '../cable/cableMesh';
import type { Vec3 } from '../cable/collide';
import { plug, type PortHit } from '../cable/plug';
import { events } from '../core/events';
import { createRng } from '../core/rng';
import type { DeviceDefId } from '../data/catalog';
import { CABLE_DEFAULT_LENGTH, RACK_HEIGHT } from '../data/units';
import { BOOT_MS, resetBreaker, updatePower, type PowerSummary } from '../game/power';
import { round3, type SaveData, type SavedCable, type SavedDevice } from '../game/save';
import { createPdu, createRackDevice, PDU_SIDES, setDeviceLed, setDevicePower, type Device, type Socket } from '../rack/device';
import { RackSlots } from '../rack/rack';
import { collectColliders } from './scene';

// 서버실: 랙 슬롯표 + 장비 + 케이블 월드. 장비를 끼우면 포트·충돌 상자를 월드에 더한다.
// 가동 판정은 updatePower(now): 꽂힌 케이블로 포트 연결표를 만들어 power.ts에 넘긴다.

const LAN_COLORS = [0x2f7fd8, 0xe0b020, 0x38a860, 0xd0483c];
const POWER_COLOR = 0x23262b;
const BLINK_COLOR = new THREE.Color(0xd9a400);

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
  private hinted: Socket | null = null;
  private serial = 0;
  private spawned = 0;
  private stressCables: Cable[] = [];
  private readonly rng = createRng(42);
  /** 마지막 가동 판정 결과 */
  summary: PowerSummary = { incomePerSec: 0, powerUsed: 0, powerCap: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    readonly rack: THREE.Group,
  ) {
    this.world.colliders.push(...collectColliders(rack));
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

  /** 비어 있는 옆면 자리 (없으면 null) */
  freePduSide(): number | null {
    for (let side = 0; side < PDU_SIDES; side++) if (!this.devices.some((d) => d.side === side)) return side;
    return null;
  }

  /** 빈 옆면에 PDU를 붙임 (자리 없으면 null) */
  addPdu(side = this.freePduSide(), id = `pdu#${++this.serial}`): Device | null {
    if (side === null || this.devices.some((d) => d.side === side)) return null;
    const { device, sockets } = createPdu(id, side);
    this.scene.add(device.group);
    this.addDevice(device, sockets);
    return device;
  }

  private addDevice(device: Device, sockets: Socket[]) {
    this.devices.push(device);
    for (const s of sockets) {
      this.sockets.set(s.port, s);
      this.world.ports.push(s.port);
    }
    this.world.colliders.push(...collectColliders(device.group));
    // 새 상자에 잠든 케이블이 박힌 채 남지 않게 모두 깨움
    for (const c of this.world.cables) c.rope.wake();
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
    const wasTripped = new Set(this.devices.filter((d) => d.power.tripped));
    this.summary = updatePower(
      this.devices.map((d) => d.power),
      links,
      now,
    );
    for (const d of this.devices) {
      setDeviceLed(d, d.power.status);
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
    const c = createCable(saved?.id ?? `cable-${n}`, kind, CABLE_DEFAULT_LENGTH, color);
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
  spawnCable(kind: PortKind): Cable {
    const c = this.addCable(kind);
    const z = -0.62 - (this.spawned++ % 4) * 0.12;
    const y = c.rope.cfg.radius + 0.02;
    const x0 = -0.42, x1 = 0.5, w = 0.08;
    c.rope.setFromPolyline([[x0, y, z], [x1, y, z], [x1, y, z - w], [x0, y, z - w]]);
    return c;
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
      }));
    return { serial: this.serial, spawned: this.spawned, devices, cables };
  }

  /** 불러오기: 저장된 id·자리로 장비를, 마디 좌표 그대로 케이블을 다시 만든다 */
  restore(data: Pick<SaveData, 'serial' | 'spawned' | 'devices' | 'cables'>): void {
    for (const d of data.devices) {
      const device = d.defId === 'pdu' ? this.addPdu(d.side, d.id) : d.u === null ? null : this.install(d.defId, d.u, d.id);
      if (!device) continue;
      if (device.def.id !== 'pdu') setDevicePower(device, d.on);
      device.power.tripped = d.tripped;
    }
    const portById = new Map(this.world.ports.map((p) => [p.id, p]));
    for (const saved of data.cables) {
      const c = this.addCable(saved.kind, saved);
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
