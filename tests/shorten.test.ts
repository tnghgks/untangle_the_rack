import { describe, expect, it } from 'vitest';
import { STEP_SEC } from '../src/core/loop';
import type { Aabb } from '../src/cable/collide';
import { Rope } from '../src/cable/rope';
import { CableResize, MIN_CABLE_LENGTH, type ResizeStatus } from '../src/cable/shorten';

/** target까지 줄이거나 늘림 (물리와 함께). 마지막 상태를 돌려줌 */
function resize(rope: Rope, target: number, boxes: Aabb[] = [], steps = 600) {
  const job = new CableResize(rope);
  let s: ResizeStatus = 'moving';
  for (let i = 0; i < steps; i++) {
    s = job.step(target, STEP_SEC);
    rope.step(STEP_SEC, boxes);
  }
  job.end();
  return s;
}

function pinned(x0: number, x1: number, y: number): Rope {
  const r = new Rope(2);
  r.setFromPolyline([[x0, y, 0], [x0, y - 0.7, 0], [x1, y - 0.7, 0], [x1, y, 0]]);
  r.pin(0, x0, y, 0);
  r.pin(r.n - 1, x1, y, 0);
  for (let i = 0; i < 300; i++) r.step(STEP_SEC, []);
  return r;
}

describe('줄이기 도구', () => {
  it('마디 수는 그대로, 간격만 바뀜', () => {
    const r = new Rope(2);
    r.setLength(1);
    expect(r.n).toBe(51);
    expect(r.length).toBeCloseTo(1);
    r.setLength(5);
    expect(r.length).toBeCloseTo(2);
  });

  it('양 끝이 꽂힌 케이블은 당긴 상태에서 멈춤 (끝 사이 거리보다 짧아지지 않음)', () => {
    const r = pinned(-0.25, 0.25, 1.5);
    const s = resize(r, MIN_CABLE_LENGTH);
    expect(s).toBe('taut');
    expect(r.length).toBeGreaterThan(0.45);
    expect(r.length).toBeLessThan(0.7);
  });

  it('상자를 돌아가는 케이블은 상자를 뚫지 않고 멈춤', () => {
    const box: Aabb = { min: [-0.1, 0, -0.3], max: [0.1, 0.8, 0.3] };
    const r = new Rope(2);
    r.setFromPolyline([[-0.3, 0.5, 0], [-0.3, 1.2, 0], [0.3, 1.2, 0], [0.3, 0.5, 0]]);
    r.pin(0, -0.3, 0.5, 0);
    r.pin(r.n - 1, 0.3, 0.5, 0);
    for (let i = 0; i < 300; i++) r.step(STEP_SEC, [box]);
    resize(r, MIN_CABLE_LENGTH, [box]);
    // 상자 위로 넘어가는 가장 짧은 길: 0.2 + 2 × √(0.2² + 0.3²) ≈ 0.92
    expect(r.length).toBeGreaterThan(0.85);
    const rad = r.cfg.radius;
    for (let i = 0; i < r.n; i++) {
      const [x, y] = [r.pos[i * 3], r.pos[i * 3 + 1]];
      const inside = x > box.min[0] + rad && x < box.max[0] - rad && y < box.max[1] - rad;
      expect(inside).toBe(false);
    }
  });

  it('줄인 뒤 다시 늘리면 처음 길이까지만', () => {
    const r = pinned(-0.25, 0.25, 1.5);
    resize(r, 1);
    expect(r.length).toBeCloseTo(1, 2);
    expect(resize(r, 3)).toBe('done');
    expect(r.length).toBeCloseTo(2, 5);
  });

  it('뽑힌 케이블은 최소 길이까지 줄어듦', () => {
    const r = new Rope(2);
    r.setFromPolyline([[-1, 0.01, 0], [1, 0.01, 0]]);
    resize(r, 0);
    expect(r.length).toBeCloseTo(MIN_CABLE_LENGTH, 5);
  });
});
