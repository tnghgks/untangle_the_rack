import { describe, expect, it } from 'vitest';
import { STEP_SEC } from '../src/core/loop';
import type { Aabb } from '../src/cable/collide';
import { Rope } from '../src/cable/rope';

function run(rope: Rope, steps: number, boxes: Aabb[] = []): number {
  for (let i = 0; i < steps; i++) {
    rope.step(STEP_SEC, boxes);
    if (rope.sleeping) return i + 1;
  }
  return steps;
}

describe('Rope', () => {
  it('2m 케이블은 4cm 간격 51노드', () => {
    const r = new Rope(2);
    expect(r.n).toBe(51);
    expect(r.length).toBeCloseTo(2);
  });

  it('바닥에 떨어뜨리면 5초 안에 멈추고 바닥을 뚫지 않는다', () => {
    const r = new Rope(2);
    r.setFromPolyline([[-1, 0.5, 0], [1, 0.5, 0]]);
    const steps = run(r, 600);
    expect(r.sleeping).toBe(true);
    expect(steps * STEP_SEC).toBeLessThan(5);
    for (let i = 0; i < r.n; i++) expect(r.pos[i * 3 + 1]).toBeGreaterThanOrEqual(r.cfg.radius - 1e-4);
  });

  it('양 끝을 고정해 늘어뜨리면 길이를 유지한 채 멈춘다', () => {
    const r = new Rope(2);
    r.setFromPolyline([[-0.25, 1.5, 0], [0.25, 1.5, 0]]);
    r.pin(0, -0.25, 1.5, 0);
    r.pin(r.n - 1, 0.25, 1.5, 0);
    const steps = run(r, 900);
    expect(r.sleeping).toBe(true);
    expect(steps * STEP_SEC).toBeLessThan(8);
    expect(Math.abs(r.pathLength() / r.length - 1)).toBeLessThan(0.03);
    // 맨 아래는 대략 길이의 절반쯤 내려옴
    let minY = Infinity;
    for (let i = 0; i < r.n; i++) minY = Math.min(minY, r.pos[i * 3 + 1]);
    expect(minY).toBeLessThan(1.5 - 0.8);
  });

  it('상자 위로 떨어뜨리면 걸쳐서 멈추고 상자를 뚫지 않는다', () => {
    const box: Aabb = { min: [-0.25, 0.4, -0.3], max: [0.25, 0.6, 0.3] };
    const r = new Rope(2);
    r.setFromPolyline([[-1, 0.9, 0], [1, 0.9, 0]]);
    run(r, 900, [box]);
    const rad = r.cfg.radius;
    let onTop = 0;
    for (let i = 0; i < r.n; i++) {
      const [x, y, z] = [r.pos[i * 3], r.pos[i * 3 + 1], r.pos[i * 3 + 2]];
      const inside =
        x > box.min[0] + rad && x < box.max[0] - rad &&
        y > box.min[1] + rad && y < box.max[1] - rad &&
        z > box.min[2] + rad && z < box.max[2] - rad;
      expect(inside).toBe(false);
      if (y > box.max[1] && Math.abs(x) < box.max[0]) onTop++;
    }
    expect(onTop).toBeGreaterThan(5);
  });

  it('빠르게 떨어져도 얇은 판(2cm)을 뚫지 않는다', () => {
    const plate: Aabb = { min: [-2, 0.49, -2], max: [2, 0.51, 2] };
    const r = new Rope(1);
    r.setFromPolyline([[-0.5, 1.5, 0], [0.5, 1.5, 0]]);
    run(r, 600, [plate]);
    for (let i = 0; i < r.n; i++) expect(r.pos[i * 3 + 1]).toBeGreaterThan(0.5);
  });

  it('고정점에서 닿는 거리 밖으로 잡아끌면 목표를 줄이고 넘친 거리를 알려 준다', () => {
    const r = new Rope(2);
    r.setFromPolyline([[0, 1, 0], [2, 1, 0]]);
    r.pin(0, 0, 1, 0);
    r.grab(r.n - 1);
    const target: [number, number, number] = [5, 1, 0];
    const { overshoot, anchor } = r.clampToReach(target);
    expect(anchor).toBe(0);
    expect(overshoot).toBeGreaterThan(2.9);
    expect(Math.hypot(target[0], target[1] - 1, target[2])).toBeLessThanOrEqual(2);
    r.setGrabTarget(...target);
    run(r, 300);
    expect(r.pathLength() / r.length).toBeLessThan(1.03);
  });

  it('잡고 있는 동안은 잠들지 않고, 놓으면 다시 멈춘다', () => {
    const r = new Rope(1);
    r.setFromPolyline([[-0.5, 0.003, 0], [0.5, 0.003, 0]]);
    r.grab(10);
    run(r, 200);
    expect(r.sleeping).toBe(false);
    r.release();
    run(r, 600);
    expect(r.sleeping).toBe(true);
  });
});
