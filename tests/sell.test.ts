import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { POST_X, POST_Z, strap } from '../src/cable/velcro';
import { CABLES, DEVICES } from '../src/data/catalog';
import { priceOf, sellCable, sellDevice } from '../src/game/economy';
import { parseSave, SAVE_VERSION, type SaveData } from '../src/game/save';
import { createGameState } from '../src/game/state';
import { createStartRoom, restoreRoom } from '../src/view/room';

describe('판매', () => {
  it('장비: 마지막으로 산 값의 50%를 돌려주고 다음 가격을 한 단계 내림', () => {
    const web = DEVICES['server-web'];
    const s = createGameState(0, 0);
    s.bought['server-web'] = 2;
    expect(sellDevice(s, web)).toBe(Math.round(priceOf(web, 1) * 0.5));
    expect(s.bought['server-web']).toBe(1);
    expect(sellDevice(s, web)).toBe(200);
    expect(s.money).toBe(Math.round(priceOf(web, 1) * 0.5) + 200);
    // 산 기록이 없으면(시작 지급) 0원
    expect(sellDevice(s, web)).toBe(0);
    expect(s.bought['server-web']).toBe(0);
  });

  it('케이블: 낸 값의 50%, 시작 배선은 0원', () => {
    const s = createGameState(0, 0);
    expect(sellCable(s, CABLES['cable-power'].price)).toBe(7.5);
    expect(sellCable(s, 0)).toBe(0);
  });

  it('케이블을 없애면 포트가 비고 벨크로·메시도 걷힘', () => {
    const scene = new THREE.Scene();
    const room = createStartRoom(scene, new THREE.Group());
    const c = room.world.cables[0];
    const ports = c.ends.slice();
    c.rope.pin(20, -POST_X, 0.8, POST_Z - 0.03);
    c.rope.unpin(20);
    strap(room.world.cables, -1, 0.8);
    room.removeCable(c);
    expect(room.world.cables).not.toContain(c);
    expect(room.meshes.some((m) => m.cable === c)).toBe(false);
    expect(ports.every((p) => p === null || p.plugged === null)).toBe(true);
    expect(c.ties).toHaveLength(0);
  });

  it('판매로는 옆면 PDU도 뺄 수 있음 (빼기는 여전히 안 됨)', () => {
    const room = createStartRoom(new THREE.Scene(), new THREE.Group());
    const pdu = room.devices.find((d) => d.def.id === 'pdu')!;
    expect(room.remove(pdu)).toBe(false);
    expect(room.remove(pdu, true)).toBe(true);
    expect(room.devices).not.toContain(pdu);
    expect(room.freePduSide()).not.toBeNull();
  });

  it('산 케이블의 낸 값은 저장됨', () => {
    const room = createStartRoom(new THREE.Scene(), new THREE.Group());
    const bought = room.spawnCable('lan', 10);
    const data: SaveData = { v: SAVE_VERSION, money: 0, bought: {}, ...room.snapshot() };
    const back = restoreRoom(new THREE.Scene(), new THREE.Group(), parseSave(JSON.stringify(data))!);
    expect(back.world.cables.find((c) => c.id === bought.id)!.paid).toBe(10);
    expect(back.world.cables[0].paid).toBe(0);
  });
});
