import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Cable } from '../src/cable/cable';
import { POST_X, POST_Z, strap, strapNear, strapsOf, unstrap, type Post } from '../src/cable/velcro';
import { STEP_SEC } from '../src/core/loop';
import { parseSave, SAVE_VERSION, type SaveData } from '../src/game/save';
import { createStartRoom, restoreRoom, type Room } from '../src/view/room';

/** 가장 뒤로 늘어진 마디 (플레이어가 잡을 만한 곳) */
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

const steps = (room: Room, n: number) => {
  for (let i = 0; i < n; i++) room.world.step(STEP_SEC);
};

/** 플레이어처럼: 늘어진 곳을 손으로 잡아 기둥 바로 뒤 높이 y로 끌어다 대고 띠를 감은 뒤 놓음 */
function routeAndStrap(room: Room, c: Cable, post: Post, y: number) {
  c.rope.grab(backmost(c));
  const target: [number, number, number] = [post * POST_X, y, POST_Z - 0.03];
  for (let i = 0; i < 180; i++) {
    const t: [number, number, number] = [...target];
    c.rope.clampToReach(t);
    c.rope.setGrabTarget(t[0], t[1], t[2]);
    room.world.step(STEP_SEC);
  }
  const r = strap(room.world.cables, post, y);
  c.rope.release();
  return r;
}

describe('벨크로', () => {
  it('기둥에 걸쳐 두지 않은 선은 띠가 잡지 않음', () => {
    const room = settled();
    expect(strap(room.world.cables, -1, 0.8).tied).toHaveLength(0);
    expect(strapsOf(room.world.cables)).toHaveLength(0);
  });

  it('손으로 기둥에 끌어다 대고 띠를 감으면 공기 흐름이 회복', () => {
    const room = settled();
    room.updatePower(Date.now());
    expect(room.airflow).toBeLessThan(0.8);
    for (const c of room.world.cables) expect(routeAndStrap(room, c, -1, 0.8).tied).toContain(c);
    steps(room, 600);
    room.updatePower(Date.now());
    expect(room.airflow).toBeGreaterThan(0.9);
  });

  it('한 띠가 기둥에 모인 여러 가닥을 다발로 묶고, 다시 고르면 다 풀림', () => {
    const room = settled();
    const [a, b] = room.world.cables;
    // 둘 다 같은 자리에 걸쳐 놓은 뒤 한 번에 감기
    const held: [Cable, number][] = [];
    for (const c of [a, b]) {
      const node = backmost(c);
      c.rope.grab(node);
      for (let i = 0; i < 180; i++) {
        const t: [number, number, number] = [-POST_X, 0.7, POST_Z - 0.03];
        c.rope.clampToReach(t);
        c.rope.setGrabTarget(t[0], t[1], t[2]);
        room.world.step(STEP_SEC);
      }
      c.rope.release();
      // 다음 선을 가져오는 동안 흘러내리지 않게 놓은 자리에 잠깐 붙잡아 둠
      const p = c.rope.pos;
      c.rope.pin(node, p[node * 3], p[node * 3 + 1], p[node * 3 + 2]);
      held.push([c, node]);
    }
    for (const [c, node] of held) c.rope.unpin(node);
    const r = strap(room.world.cables, -1, 0.7);
    expect(r.tied).toEqual(expect.arrayContaining([a, b]));
    const s = strapNear(room.world.cables, -1, 0.71)!;
    expect(s.ties.length).toBeGreaterThanOrEqual(2);
    unstrap(s);
    expect(a.ties).toHaveLength(0);
    expect(b.ties).toHaveLength(0);
  });

  it('세게 당기면 넘친 고정점이 묶음으로 잡힘 (drag.ts가 묶음을 뗌)', () => {
    const room = settled();
    const c = room.world.cables[0];
    routeAndStrap(room, c, -1, 0.8);
    const node = c.ties[0].node;
    c.rope.grab(node + 5);
    const { overshoot, anchor } = c.rope.clampToReach([0, 1.5, -1.5]);
    expect(overshoot).toBeGreaterThan(0.15);
    expect(anchor).toBe(node);
    c.rope.release();
  });

  it('저장하고 불러와도 띠가 그대로', () => {
    const room = settled();
    const c = room.world.cables[1];
    routeAndStrap(room, c, 1, 0.9);
    const node = c.ties[0].node;
    const data: SaveData = { v: SAVE_VERSION, money: 0, bought: {}, ...room.snapshot() };
    const parsed = parseSave(JSON.stringify(data))!;
    expect(parsed).not.toBeNull();
    const back = restoreRoom(new THREE.Scene(), new THREE.Group(), parsed);
    const s = strapsOf(back.world.cables);
    expect(s).toHaveLength(1);
    expect(s[0].post).toBe(1);
    expect(s[0].y).toBeCloseTo(0.9, 2);
    expect(back.world.cables[1].rope.isPinned(node)).toBe(true);
    expect(parseSave(JSON.stringify({ ...data, cables: [{ ...data.cables[1], ties: [{ node: 'x', pos: [0, 0] }] }] }))).toBeNull();
  });
});
