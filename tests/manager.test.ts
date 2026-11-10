import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { deviceRings, ringsOf, type Ring } from '../src/cable/manager';
import { STEP_SEC } from '../src/core/loop';
import { DEVICES } from '../src/data/catalog';
import { RACK } from '../src/data/units';
import { updatePower } from '../src/game/power';
import type { Device } from '../src/rack/device';
import { createStartRoom, type Room } from '../src/view/room';

const steps = (room: Room, n: number) => {
  for (let i = 0; i < n; i++) room.world.step(STEP_SEC);
};

/** 시작 방 + U15에 매니저 */
function withManager(u = 15): { room: Room; manager: Device; rings: Ring[] } {
  const room = createStartRoom(new THREE.Scene(), new THREE.Group());
  const manager = room.install('cable-manager', u)!;
  steps(room, 240);
  return { room, manager, rings: ringsOf(manager.id, u, DEVICES['cable-manager'].rings!) };
}

describe('케이블 매니저', () => {
  it('전기를 안 먹고 수익도 없음', () => {
    const { room, manager } = withManager();
    room.updatePower(Date.now());
    expect(manager.power.status).toBe('off');
    expect(manager.ports).toHaveLength(0);
    expect(updatePower([manager.power], new Map(), 0).incomePerSec).toBe(0);
  });

  it('고리가 가로로 늘어서고 랙 뒷면 밖에 있음', () => {
    const { rings } = withManager();
    expect(rings.length).toBeGreaterThan(3);
    for (const r of rings) expect(r.axis).toBe(0);
    expect(rings[1].pos[0]).toBeGreaterThan(rings[0].pos[0]);
    expect(rings[0].pos[2]).toBeLessThan(-RACK.depth / 2 + 0.2);
  });
});

describe('세로 케이블 매니저', () => {
  function withSide(): { room: Room; manager: Device; rings: Ring[] } {
    const room = createStartRoom(new THREE.Scene(), new THREE.Group());
    const manager = room.addSide('cable-manager-v')!;
    steps(room, 240);
    return { room, manager, rings: deviceRings(manager) };
  }

  it('PDU와 옆면 자리가 따로 — 왼쪽에 PDU가 있어도 왼쪽에 달림, 두 개까지', () => {
    const { room, manager } = withSide();
    expect(manager.side).toBe(0);
    expect(room.freePduSide()).toBe(1);
    expect(room.addSide('cable-manager-v')!.side).toBe(1);
    expect(room.freeSide('cable-manager-v')).toBeNull();
    expect(room.freePduSide()).toBe(1);
  });

  it('고리가 세로로 늘어서고 랙 폭 밖', () => {
    const { rings } = withSide();
    expect(rings.length).toBeGreaterThan(5);
    for (const r of rings) {
      expect(r.axis).toBe(1);
      expect(Math.abs(r.pos[0])).toBeGreaterThan(RACK.width / 2);
    }
    expect(rings[1].pos[1]).toBeGreaterThan(rings[0].pos[1]);
  });

  it('판매로만 뺄 수 있음', () => {
    const { room, manager } = withSide();
    expect(room.remove(manager)).toBe(false);
    expect(room.remove(manager, true)).toBe(true);
  });
});
