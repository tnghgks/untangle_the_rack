import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CABLES, SHOP_CABLES } from '../src/data/catalog';
import { plug, unplug } from '../src/cable/plug';
import { loadSave, parseSave, SAVE_KEY, SAVE_VERSION, writeSave, type SaveData } from '../src/game/save';
import { createStartRoom, restoreRoom, type Room } from '../src/view/room';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function toSave(room: Room, money = 123.4): SaveData {
  return { v: SAVE_VERSION, money, bought: { 'server-web': 2 }, ...room.snapshot() };
}

/** JSON을 거쳐 다시 만든 방 */
function roundTrip(room: Room): { data: SaveData; back: Room } {
  const store = memoryStorage();
  writeSave(store, toSave(room));
  const data = loadSave(store)!;
  return { data, back: restoreRoom(new THREE.Scene(), data) };
}

function startRoom(): Room {
  return createStartRoom(new THREE.Scene());
}

describe('save', () => {
  it('시작 방 왕복: 장비·배선·가동·돈 그대로', () => {
    const room = startRoom();
    const { data, back } = roundTrip(room);
    expect(data.money).toBe(123.4);
    expect(data.bought).toEqual({ 'server-web': 2 });
    expect(back.devices.map((d) => [d.id, d.u, d.side, d.on])).toEqual(room.devices.map((d) => [d.id, d.u, d.side, d.on]));
    expect(back.world.cables.map((c) => [c.id, c.color, c.ends.map((p) => p?.id)])).toEqual(
      room.world.cables.map((c) => [c.id, c.color, c.ends.map((p) => p?.id)]),
    );
    // 이미 부팅된 상태로 → 바로 초당 1원
    expect(back.summary).toEqual(room.summary);
    expect(back.summary.incomePerSec).toBe(1);
    expect(back.devices.map((d) => d.power.status)).toEqual(['running', 'running', 'running']);
  });

  it('케이블 모양은 원래 마디 좌표에서 거의 안 움직임', () => {
    const room = startRoom();
    const { back } = roundTrip(room);
    room.world.cables.forEach((c, i) => {
      const a = c.rope.pos, b = back.world.cables[i].rope.pos;
      let worst = 0;
      for (let k = 0; k < a.length; k += 3) worst = Math.max(worst, Math.hypot(a[k] - b[k], a[k + 1] - b[k + 1], a[k + 2] - b[k + 2]));
      expect(worst).toBeLessThan(0.01);
    });
  });

  it('뽑힌 케이블·새 장비·꺼진 장비·차단된 PDU·카운터', () => {
    const room = startRoom();
    const web = room.install('server-web', 10)!;
    const pdu2 = room.addPdu()!;
    const loose = room.spawnCable('lan');
    plug(loose, 0, web.ports.find((p) => p.kind === 'lan')!);
    unplug(room.world.cables[2], 1); // 스위치 ↔ 엔트리 랜선 한쪽 뽑기
    room.setPower(room.devices[1], false);
    pdu2.power.tripped = true;
    room.updatePower(Date.now());

    const { data, back } = roundTrip(room);
    expect(data.serial).toBe(5);
    expect(data.spawned).toBe(1);
    expect(back.device(web.id)?.u).toBe(10);
    expect(back.device(pdu2.id)?.side).toBe(1);
    expect(back.device(pdu2.id)?.power.tripped).toBe(true);
    expect(back.devices[1].on).toBe(false);
    expect(back.world.cables.map((c) => c.ends.map((p) => p?.id ?? null))).toEqual(
      room.world.cables.map((c) => c.ends.map((p) => p?.id ?? null)),
    );
    expect(back.summary.incomePerSec).toBe(0);
    // 다음 구매는 겹치지 않는 id
    expect(back.install('server-web', 12)!.id).toBe('server-web#6');
    expect(back.freePduSide()).toBeNull();
  });

  it('줄이기 도구 시절 저장의 길이(length)는 무시하고 기본 2m', () => {
    const { data } = roundTrip(startRoom());
    const old = { ...data, v: 1, cables: data.cables.map((c) => ({ ...c, length: 0.9 })) };
    const fromOld = restoreRoom(new THREE.Scene(), parseSave(JSON.stringify(old))!);
    expect(fromOld.world.cables[2].rope.length).toBeCloseTo(2, 3);
  });

  it('옛 ties 저장도 불러옴', () => {
    const room = startRoom();
    const data = toSave(room);
    data.cables[0] = { ...data.cables[0], ties: [{ node: 10, pos: [0, 1, 0], hook: 'cable-manager#3:ring1' }] };
    const parsed = parseSave(JSON.stringify(data));
    expect(parsed).not.toBeNull();
    const back = restoreRoom(new THREE.Scene(), parsed!);
    expect(back.world.cables[0].ends.map((p) => p?.id)).toEqual(room.world.cables[0].ends.map((p) => p?.id));
    // 옛 띠는 무시: 마디를 고정하지 않고, 경로 없이 물리로
    expect(back.world.cables[0].rope.isPinned(10)).toBe(false);
    expect(back.world.cables[0].rope.frozen).toBe(false);
    expect(back.world.cables[0].route).toBeNull();
  });

  it('깨진 저장은 무시', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('{oops')).toBeNull();
    expect(parseSave(JSON.stringify({ v: 999 }))).toBeNull();
    const ok = toSave(startRoom());
    expect(parseSave(JSON.stringify(ok))).not.toBeNull();
    expect(parseSave(JSON.stringify({ ...ok, devices: [{ ...ok.devices[0], defId: 'nope' }] }))).toBeNull();
    const store = memoryStorage();
    store.setItem(SAVE_KEY, 'garbage');
    expect(loadSave(store)).toBeNull();
  });
});

describe('save v2: 랙 목록·긴 랜선', () => {
  it('랙 2대·10m 선 왕복', () => {
    const room = startRoom();
    const r2 = room.addRack([1, 0])!;
    const sw2 = room.install('switch-24', 1, r2.id)!;
    const sw1 = room.devices.find((d) => d.def.id === 'switch-8')!;
    const c = room.spawnCable('lan', 50, 10, 'rack-2');
    plug(c, 0, sw1.ports.find((p) => p.kind === 'lan' && !p.plugged)!);
    plug(c, 1, sw2.ports.find((p) => p.kind === 'lan' && !p.plugged)!);
    expect(room.routeCable(c, 'rack-1:tray')).toBe(true);
    const { back } = roundTrip(room);
    expect(back.racks.map((r) => [r.id, r.cell])).toEqual(room.racks.map((r) => [r.id, r.cell]));
    const b = back.world.cables.find((x) => x.id === c.id)!;
    expect(b.rope.length).toBe(10);
    expect(b.route).toEqual(c.route);
    const sw2b = back.devices.find((d) => d.id === sw2.id)!;
    expect(sw2b.ports.map((p) => p.pos)).toEqual(sw2.ports.map((p) => p.pos));
  });

  it('v1 저장은 rack-1 한 대로 읽음', () => {
    const snap: Record<string, unknown> = { ...startRoom().snapshot() };
    delete snap.racks;
    snap.devices = (snap.devices as Record<string, unknown>[]).map((d) => {
      const { rack: _r, ...rest } = d;
      return rest;
    });
    const data = parseSave(JSON.stringify({ v: 1, money: 5, bought: {}, ...snap }))!;
    expect(data).not.toBeNull();
    expect(data.racks).toEqual([{ id: 'rack-1', cell: [0, 0] }]);
    expect(restoreRoom(new THREE.Scene(), data).summary.incomePerSec).toBe(1);
  });

  it('경로 하나가 깨져도 나머지는 불러옴', () => {
    const snap = toSave(startRoom());
    snap.cables = snap.cables.slice(0, 2).map((c) => ({ ...c, route: { guides: ['g'], tied: [] } }));
    const bad = JSON.parse(JSON.stringify(snap));
    bad.cables[0].route.guides = [1];
    const data = parseSave(JSON.stringify(bad))!;
    expect(data).not.toBeNull();
    expect(data.cables[0].route).toBeUndefined();
    expect(data.cables[1].route).toEqual({ guides: ['g'], tied: [] });
  });

  it('랙이 하나도 없는 저장은 버림', () => {
    const ok = toSave(startRoom());
    expect(parseSave(JSON.stringify({ ...ok, racks: [] }))).toBeNull();
  });

  it('길이가 터무니없는 선은 그 길이만 버리고 기본 길이로', () => {
    const snap = toSave(startRoom());
    const bad = JSON.parse(JSON.stringify(snap));
    bad.cables[0].length = 1e7;
    bad.cables[1].length = 10;
    const data = parseSave(JSON.stringify(bad))!;
    expect(data).not.toBeNull();
    expect(data.cables[0].length).toBeUndefined();
    expect(data.cables[1].length).toBe(10);
    expect(restoreRoom(new THREE.Scene(), data).world.cables[0].rope.length).toBeCloseTo(2, 3);
  });

  it('상점 10m 랜선은 50원, 길이 10', () => {
    expect(CABLES['cable-lan-long']).toMatchObject({ price: 50, length: 10, kind: 'lan' });
    expect(CABLES['cable-lan'].length).toBe(2);
    expect(CABLES['cable-power'].length).toBe(2);
    expect(SHOP_CABLES).toEqual(['cable-lan', 'cable-lan-long', 'cable-power']);
  });
});
