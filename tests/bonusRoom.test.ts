import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { PortKind } from '../src/cable/cable';
import { plug, unplug } from '../src/cable/plug';
import { events } from '../src/core/events';
import { THEME_COLOR, type DeviceDefId } from '../src/data/catalog';
import { BOOT_MS } from '../src/game/power';
import { SAVE_VERSION, type SaveData } from '../src/game/save';
import type { Device } from '../src/rack/device';
import { createStartRoom, restoreRoom, type Room } from '../src/view/room';

const port = (d: Device, kind: PortKind, nth = 0) => d.ports.filter((p) => p.kind === kind)[nth]!;
const freeLan = (d: Device) => d.ports.find((p) => p.kind === 'lan' && !p.plugged)!;
const byDef = (room: Room, id: DeviceDefId) => room.devices.find((d) => d.def.id === id)!;

/** 끼우고 전원(시작 PDU)·랜(시작 스위치) 배선 후 켬 */
function addServer(room: Room, defId: DeviceDefId, u: number, rackId = 'rack-1'): Device {
  const d = room.install(defId, u, rackId)!;
  const pdu = byDef(room, 'pdu');
  room.wire(pdu.ports.find((p) => !p.plugged)!, port(d, 'power'));
  room.wire(freeLan(byDef(room, 'switch-8')), port(d, 'lan'));
  room.setPower(d, true);
  return d;
}

/** 부팅 끝날 때까지 */
function boot(room: Room): number {
  const t = Date.now();
  room.updatePower(t);
  return room.updatePower(t + BOOT_MS).incomePerSec;
}

/** 이벤트 세기 (테스트 끝에 해제) */
const offs: (() => void)[] = [];
afterEach(() => offs.splice(0).forEach((f) => f()));
function count() {
  const n = { themed: 0, paired: 0 };
  offs.push(events.on('rack:themed', () => n.themed++), events.on('server:paired', () => n.paired++));
  return n;
}

/** 시작 방 + 스토리지·GPU, 둘째 랜 포트끼리 직결 */
function pairedRoom() {
  const room = createStartRoom(new THREE.Scene());
  const sto = addServer(room, 'server-storage', 5);
  const gpu = addServer(room, 'server-gpu', 8);
  const link = room.wire(port(gpu, 'lan', 1), port(sto, 'lan', 1));
  return { room, sto, gpu, link };
}

const toSave = (room: Room): SaveData => ({ v: SAVE_VERSION, money: 0, bought: {}, ...room.snapshot() });

describe('Room 보너스', () => {
  it('엔트리 2대 → 전용 랙, 수익 2 × 1.1', () => {
    const room = createStartRoom(new THREE.Scene());
    addServer(room, 'server-entry', 5);
    expect(boot(room)).toBeCloseTo(2.2);
    expect(room.bonuses.themes.get('rack-1')).toEqual({ kind: 'server-entry', full: false });
  });

  it('웹 서버를 섞으면 전용이 풀림', () => {
    const room = createStartRoom(new THREE.Scene());
    addServer(room, 'server-entry', 5);
    addServer(room, 'server-web', 6);
    expect(boot(room)).toBeCloseTo(5);
    expect(room.bonuses.themes.has('rack-1')).toBe(false);
  });

  it('GPU↔스토리지 짝: 둘 다 +15%', () => {
    const { room, sto, gpu } = pairedRoom();
    expect(boot(room)).toBeCloseTo(1 + 10 * 1.15 + 55 * 1.15);
    expect(room.bonuses.pairs.get(gpu.id)).toBe(sto.id);
  });

  it('짝 선을 뽑으면 바로 보너스 없음', () => {
    const { room, link } = pairedRoom();
    boot(room);
    unplug(link, 0);
    expect(room.updatePower(Date.now() + BOOT_MS).incomePerSec).toBeCloseTo(66);
  });

  it('짝 서버 하나를 끄면 바로 보너스 없음', () => {
    const { room, sto } = pairedRoom();
    boot(room);
    room.setPower(sto, false);
    expect(room.updatePower(Date.now() + BOOT_MS).incomePerSec).toBeCloseTo(56);
  });

  it('새 짝·새 테마마다 이벤트 한 번, 같은 상태로 다시 불러도 안 남', () => {
    const n = count();
    const room = createStartRoom(new THREE.Scene());
    addServer(room, 'server-entry', 5);
    boot(room);
    expect(n.themed).toBe(1);
    const sto = addServer(room, 'server-storage', 6);
    const gpu = addServer(room, 'server-gpu', 9);
    room.wire(port(gpu, 'lan', 1), port(sto, 'lan', 1));
    const t = Date.now() + BOOT_MS;
    room.updatePower(t);
    for (let i = 0; i < 4; i++) room.updatePower(t + BOOT_MS + i);
    expect(n.paired).toBe(1);
    expect(n.themed).toBe(1);
  });

  it('서버를 다른 랙으로 옮기면 두 랙 테마가 바로 바뀜', () => {
    const room = createStartRoom(new THREE.Scene());
    const e2 = addServer(room, 'server-entry', 5);
    boot(room);
    expect(room.bonuses.themes.has('rack-1')).toBe(true);
    room.addRack([1, 0]);
    const n = count();
    room.remove(e2);
    room.install('server-entry', 3, 'rack-2', e2.id);
    room.updatePower(Date.now());
    expect(room.bonuses.themes.has('rack-1')).toBe(false);
    expect(room.bonuses.themes.has('rack-2')).toBe(false);
    room.install('server-entry', 5, 'rack-2');
    room.updatePower(Date.now());
    expect(room.bonuses.themes.get('rack-2')?.kind).toBe('server-entry');
    expect(n.themed).toBe(1);
  });

  it('불러오면 테마·짝이 그대로, 이벤트는 안 남', () => {
    const { room } = pairedRoom();
    boot(room);
    const data = toSave(room);
    const n = count();
    const back = restoreRoom(new THREE.Scene(), data);
    expect(back.bonuses.pairs.size).toBe(2);
    expect(back.summary.incomePerSec).toBeCloseTo(75.75);
    expect(n).toEqual({ themed: 0, paired: 0 });
    expect(back.quiet).toBe(false);
  });

  it('시작 방은 조용함', () => {
    const n = count();
    const room = createStartRoom(new THREE.Scene());
    expect(n).toEqual({ themed: 0, paired: 0 });
    expect(room.quiet).toBe(false);
  });
});

describe('랙 테마 띠', () => {
  const bandMats = (room: Room, k = 0) =>
    room.racks[k]!.band.children.map((m) => (m as THREE.Mesh).material as THREE.MeshStandardMaterial);

  it('전용이 되면 띠가 그 색으로 켜지고, 풀리면 꺼짐', () => {
    const room = createStartRoom(new THREE.Scene());
    expect(room.racks[0]!.band.visible).toBe(false);
    addServer(room, 'server-entry', 5);
    boot(room);
    expect(room.racks[0]!.band.visible).toBe(true);
    for (const m of bandMats(room)) {
      expect(m.color.getHex()).toBe(THEME_COLOR['server-entry']);
      expect(m.emissiveIntensity).toBeCloseTo(0.35);
    }
    addServer(room, 'server-web', 6);
    boot(room);
    expect(room.racks[0]!.band.visible).toBe(false);
  });

  it('꽉 차면 밝아짐', () => {
    const room = createStartRoom(new THREE.Scene());
    for (let u = 1; u <= 42; u++) if (room.racks[0]!.slots.canPlace(u, 1)) room.install('server-entry', u);
    expect(room.racks[0]!.slots.firstFree(1)).toBeNull();
    room.updatePower(Date.now());
    expect(room.bonuses.themes.get('rack-1')).toEqual({ kind: 'server-entry', full: true });
    for (const m of bandMats(room)) expect(m.emissiveIntensity).toBeCloseTo(1);
  });

  it('같은 상태로 매 프레임 불러도 재질이 그대로', () => {
    const room = createStartRoom(new THREE.Scene());
    addServer(room, 'server-entry', 5);
    boot(room);
    const before = bandMats(room);
    const n = room.racks[0]!.band.children.length;
    for (let i = 0; i < 5; i++) room.updatePower(Date.now() + BOOT_MS + i);
    expect(room.racks[0]!.band.children.length).toBe(n);
    bandMats(room).forEach((m, i) => expect(m).toBe(before[i]));
    // 띠 판 둘이 재질 하나를 나눠 씀
    expect(new Set(before).size).toBe(1);
  });

  it('불러온 방도 띠가 켜진 채', () => {
    const room = createStartRoom(new THREE.Scene());
    addServer(room, 'server-entry', 5);
    boot(room);
    const back = restoreRoom(new THREE.Scene(), toSave(room));
    expect(back.racks[0]!.band.visible).toBe(true);
  });
});

describe('들었다 놓기는 새 보너스가 아님', () => {
  it('전용 랙 서버를 빼서 같은 칸에 다시 끼우면 이벤트 없음 (빼는 순간에도 판정이 돎)', () => {
    const room = createStartRoom(new THREE.Scene());
    const e2 = addServer(room, 'server-entry', 5);
    const t = Date.now();
    room.updatePower(t);
    room.updatePower(t + BOOT_MS);
    const n = count();
    room.remove(e2);
    room.updatePower(t + BOOT_MS + 500);
    expect(room.bonuses.themes.has('rack-1')).toBe(false);
    room.install('server-entry', 5, 'rack-1', e2.id);
    room.updatePower(t + BOOT_MS + 1000);
    expect(room.bonuses.themes.has('rack-1')).toBe(true);
    expect(n.themed).toBe(0);
  });

  it('짝 선을 뽑았다 다시 꽂으면 이벤트 없음', () => {
    const { room, gpu, link } = pairedRoom();
    const t = Date.now();
    room.updatePower(t);
    room.updatePower(t + BOOT_MS);
    const n = count();
    unplug(link, 0);
    room.updatePower(t + BOOT_MS + 100);
    expect(room.bonuses.pairs.size).toBe(0);
    plug(link, 0, port(gpu, 'lan', 1));
    room.updatePower(t + BOOT_MS + 200);
    expect(room.bonuses.pairs.size).toBe(2);
    expect(n.paired).toBe(0);
  });

  it('한참 뒤에 다시 이루면 그때는 이벤트', () => {
    const room = createStartRoom(new THREE.Scene());
    const e2 = addServer(room, 'server-entry', 5);
    const t = Date.now();
    room.updatePower(t);
    room.updatePower(t + BOOT_MS);
    const n = count();
    room.remove(e2);
    room.updatePower(t + BOOT_MS + 500);
    room.install('server-entry', 5, 'rack-1', e2.id);
    room.updatePower(t + BOOT_MS + 60_000);
    expect(n.themed).toBe(1);
  });
});
