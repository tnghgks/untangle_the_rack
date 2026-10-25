import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
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
  return { data, back: restoreRoom(new THREE.Scene(), new THREE.Group(), data) };
}

function startRoom(): Room {
  return createStartRoom(new THREE.Scene(), new THREE.Group());
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
    const old = { ...data, cables: data.cables.map((c) => ({ ...c, length: 0.9 })) };
    const fromOld = restoreRoom(new THREE.Scene(), new THREE.Group(), parseSave(JSON.stringify(old))!);
    expect(fromOld.world.cables[2].rope.length).toBeCloseTo(2, 3);
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
