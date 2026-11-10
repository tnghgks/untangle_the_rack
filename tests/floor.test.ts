import { describe, expect, it } from 'vitest';
import { RACK_HEIGHT } from '../src/data/units';
import { aisleAt, cellOrigin, reachableCells, trayGuide, worstUplinkLength } from '../src/rack/floor';

const has = (cells: readonly (readonly [number, number])[], c: readonly [number, number]) => cells.some((x) => x[0] === c[0] && x[1] === c[1]);

describe('바닥 칸', () => {
  it('첫 랙 원점은 월드 원점', () => {
    expect(cellOrigin([0, 0])).toEqual([0, 0, 0]);
    expect(cellOrigin([2, -1])).toEqual([2, 0, -2]);
  });

  it('트레이는 칸 폭만큼, 옆 칸 트레이와 끝이 맞닿음', () => {
    const t1 = trayGuide({ id: 'rack-1', cell: [0, 0] });
    const t2 = trayGuide({ id: 'rack-2', cell: [1, 0] });
    expect(t1.b[0]).toBe(t2.a[0]);
    expect(t1.a[1]).toBeGreaterThan(RACK_HEIGHT);
    expect(t1.tray).toBe(true);
  });

  it('바로 옆 칸은 초록, 랙 있는 칸·바닥 밖은 아님', () => {
    const g = reachableCells([{ id: 'rack-1', cell: [0, 0] }]);
    expect(has(g, [1, 0])).toBe(true);
    expect(has(g, [-1, 0])).toBe(true);
    expect(has(g, [0, 1])).toBe(true);
    expect(has(g, [0, 0])).toBe(false);
    expect(has(g, [8, 0])).toBe(false);
  });

  it('너무 먼 칸은 초록 아님', () => {
    const g = reachableCells([{ id: 'rack-1', cell: [0, 0] }]);
    expect(has(g, [7, 0])).toBe(false);
    expect(has(g, [0, 4])).toBe(false);
  });

  it('체인: 새 랙 옆 칸도 초록', () => {
    const g = reachableCells([{ id: 'rack-1', cell: [0, 0] }, { id: 'rack-2', cell: [4, 0] }]);
    expect(has(g, [6, 0])).toBe(worstUplinkLength([4, 0], [6, 0]) * 1.02 <= 10);
  });

  it('통로: 앞(z+1)·뒤(z−1) 칸에 랙이 있으면 좁게, 옆 칸은 상관없음', () => {
    const racks = [{ id: 'rack-1', cell: [0, 0] as const }];
    expect(aisleAt(racks, [0, 0])).toEqual({ front: 2.7, back: 2.7 });
    const more = [...racks, { id: 'rack-2', cell: [0, 1] as const }, { id: 'rack-3', cell: [1, -1] as const }];
    expect(aisleAt(more, [0, 0])).toEqual({ front: 1.3, back: 2.7 });
    expect(aisleAt(more, [0, 1])).toEqual({ front: 2.7, back: 1.3 });
  });
});
