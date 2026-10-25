import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCable, type Cable, type Port } from '../src/cable/cable';
import { tie, tieNear, untie } from '../src/cable/velcro';
import { STEP_SEC } from '../src/core/loop';
import { parseSave, SAVE_VERSION, type SaveData } from '../src/game/save';
import { createStartRoom, restoreRoom, type Room } from '../src/view/room';

/** 가장 뒤로 늘어진 마디 (플레이어가 클릭할 만한 곳) */
function backmost(c: Cable): number {
  const p = c.rope.pos;
  let best = 2;
  for (let i = 2; i < c.rope.n - 2; i++) if (p[i * 3 + 2] < p[best * 3 + 2]) best = i;
  return best;
}

function settled(): Room {
  const room = createStartRoom(new THREE.Scene(), new THREE.Group());
  for (let i = 0; i < 240; i++) room.world.step(STEP_SEC);
  return room;
}

function port(id: string, x: number): Port {
  return { id, kind: 'lan', pos: [x, 0.2, -0.42], dir: [0, 0, -1], plugged: null };
}

describe('벨크로', () => {
  it('시작 상태에서 늘어진 곳을 묶으면 기둥을 따라 올라가 공기 흐름이 회복', () => {
    const room = settled();
    room.updatePower(Date.now());
    expect(room.airflow).toBeLessThan(0.8);
    for (const c of room.world.cables) {
      expect(tie(c, backmost(c))).toBe('tied');
      // 바닥에 깔린 채 묶으면 효과가 없으므로 위로 끌어올림
      expect(c.ties[0].pos[1]).toBeGreaterThan(0.5);
    }
    for (let i = 0; i < 600; i++) room.world.step(STEP_SEC);
    room.updatePower(Date.now());
    expect(room.airflow).toBeGreaterThan(0.9);
  });

  it('커넥터 옆은 못 묶고, 기둥까지 닿지 않으면 팽팽하다고 거절', () => {
    const c = createCable('c', 'lan', 2, 0);
    const p = port('p', -0.05);
    c.rope.setFromPolyline([[-0.05, 0.2, -0.42], [0.6, 0.2, -0.42], [0.6, 0.2, -1.6]]);
    c.ends[0] = p;
    expect(tie(c, 1)).toBe('end');
    expect(tie(c, c.rope.n - 2)).toBe('end');
    // 포트에서 3마디(12cm)인 점(x > 0)을 오른쪽 기둥(30cm 넘게)까지 끌어올 수 없음
    expect(tie(c, 3)).toBe('taut');
    expect(c.ties).toHaveLength(0);
  });

  it('묶인 곳 근처를 다시 고르면 풀림', () => {
    const room = settled();
    const c = room.world.cables[0];
    const i = backmost(c);
    tie(c, i);
    expect(c.rope.isPinned(i)).toBe(true);
    const t = tieNear(c, i + 2)!;
    expect(t.node).toBe(i);
    untie(c, t);
    expect(c.ties).toHaveLength(0);
    expect(c.rope.isPinned(i)).toBe(false);
  });

  it('세게 당기면 넘친 고정점이 벨크로로 잡힘 (drag.ts가 벨크로를 뗌)', () => {
    const room = settled();
    const c = room.world.cables[0];
    const i = backmost(c);
    tie(c, i);
    c.rope.grab(i + 5);
    const { overshoot, anchor } = c.rope.clampToReach([0, 1.5, -1.5]);
    expect(overshoot).toBeGreaterThan(0.15);
    expect(anchor).toBe(i);
    c.rope.release();
  });

  it('저장하고 불러와도 묶인 자리 그대로', () => {
    const room = settled();
    const c = room.world.cables[1];
    const i = backmost(c);
    tie(c, i);
    const at = c.ties[0].pos;
    const data: SaveData = { v: SAVE_VERSION, money: 0, bought: {}, ...room.snapshot() };
    const parsed = parseSave(JSON.stringify(data))!;
    expect(parsed).not.toBeNull();
    const back = restoreRoom(new THREE.Scene(), new THREE.Group(), parsed).world.cables[1];
    expect(back.ties).toHaveLength(1);
    expect(back.ties[0].node).toBe(i);
    expect(back.ties[0].pos[1]).toBeCloseTo(at[1], 2);
    expect(back.rope.isPinned(i)).toBe(true);
    expect(parseSave(JSON.stringify({ ...data, cables: [{ ...data.cables[1], ties: [{ node: 'x', pos: [0, 0] }] }] }))).toBeNull();
  });
});
