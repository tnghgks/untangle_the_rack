import { describe, expect, it } from 'vitest';
import { RackSlots, uFromCenterY } from '../src/rack/rack';
import { RACK, U, uBottomY } from '../src/data/units';

describe('RackSlots', () => {
  it('빈 칸에만 끼우고 겹치면 거부', () => {
    const r = new RackSlots();
    expect(r.place('a', 1, 1)).toBe(true);
    expect(r.place('b', 1, 1)).toBe(false);
    expect(r.place('c', 2, 2)).toBe(true);
    expect(r.canPlace(3, 1)).toBe(false);
    expect(r.occupant(3)).toBe('c');
    expect(r.freeUnits).toBe(39);
  });

  it('랙 범위 밖은 거부', () => {
    const r = new RackSlots();
    expect(r.canPlace(0, 1)).toBe(false);
    expect(r.canPlace(42, 1)).toBe(true);
    expect(r.canPlace(41, 4)).toBe(false);
    expect(r.canPlace(1.5, 1)).toBe(false);
  });

  it('빼면 다시 빈 칸', () => {
    const r = new RackSlots();
    r.place('g', 5, 4);
    r.remove('g');
    expect(r.canPlace(5, 4)).toBe(true);
  });

  it('firstFree는 아래부터, 큰 장비는 연속 빈 칸', () => {
    const r = new RackSlots();
    r.place('a', 1, 1);
    r.place('b', 3, 1);
    expect(r.firstFree(1)).toBe(2);
    expect(r.firstFree(2)).toBe(4);
  });

  it('nearestFree는 원하는 칸에서 가장 가까운 곳', () => {
    const r = new RackSlots();
    r.place('a', 10, 3); // 10~12
    expect(r.nearestFree(11, 1)).toBe(9);
    expect(r.nearestFree(13, 1)).toBe(13);
    expect(r.nearestFree(11, 2)).toBe(13);
    expect(r.nearestFree(10, 2)).toBe(8);
  });

  it('가득 차면 null', () => {
    const r = new RackSlots(4);
    r.place('a', 1, 4);
    expect(r.firstFree(1)).toBeNull();
    expect(r.nearestFree(2, 1)).toBeNull();
  });
});

describe('uFromCenterY', () => {
  it('장비 중심 높이 → 아래쪽 U', () => {
    for (const [u, size] of [[1, 1], [7, 2], [20, 4], [42, 1]] as const) {
      const y = uBottomY(u) + (size * U) / 2;
      expect(uFromCenterY(y, size, RACK.baseHeight, U)).toBe(u);
    }
  });

  it('랙 밖 높이는 끝 칸으로', () => {
    expect(uFromCenterY(-1, 1, RACK.baseHeight, U)).toBe(1);
    expect(uFromCenterY(5, 4, RACK.baseHeight, U)).toBe(39);
  });
});
