import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Cable } from '../src/cable/cable';
import { guideOf } from '../src/cable/guide';
import { createStartRoom } from '../src/view/room';
import { STRAP_SPACING, strapSpots } from '../src/view/tie';

const newRoom = () => createStartRoom(new THREE.Scene());
const node = (c: Cable, i: number) => [c.rope.pos[i * 3]!, c.rope.pos[i * 3 + 1]!, c.rope.pos[i * 3 + 2]!] as const;

describe('벨크로 띠 자리', () => {
  it('묶인 선이 없으면 띠 없음', () => {
    const room = newRoom();
    const g = guideOf(room.install('cable-manager', 5)!)!;
    expect(strapSpots(room, g.id)).toEqual([]);
    for (const c of room.world.cables) room.routeCable(c, g.id);
    expect(strapSpots(room, g.id)).toEqual([]); // 경로에만 들고 안 묶음
    expect(strapSpots(room, 'nope')).toEqual([]);
  });

  it('가로 가이드: 다발 구간 안의 고리 자리마다, 묶인 선 마디를 모두 감쌈', () => {
    const room = newRoom();
    const device = room.install('cable-manager', 5)!;
    const g = guideOf(device)!;
    for (const c of room.world.cables) room.routeCable(c, g.id);
    room.tieGuide(g.id);
    const spots = strapSpots(room, g.id);
    expect(spots.length).toBeGreaterThan(0);
    const rings = device.def.rings!;
    for (const s of spots) {
      expect(rings.some((x) => Math.abs(x - s.center[0]) < 1e-9)).toBe(true);
      // 띠 자리 x에서 가장 가까운 마디가 띠 단면 안에 듦
      for (const c of room.world.cables) {
        // 띠 자리 x 근처(2cm) 마디 중 띠 단면 중심에 가장 가까운 것 (포트에서 위아래로 들어오는 마디도 근처에 있을 수 있음)
        let best: ReturnType<typeof node> | null = null;
        let left = false, right = false;
        const off = (p: ReturnType<typeof node>) => Math.hypot(p[1] - s.center[1], p[2] - s.center[2]);
        for (let i = 0; i < c.rope.n; i++) {
          const p = node(c, i);
          if (Math.abs(p[0] - s.center[0]) > 0.02 || off(p) > 0.03) continue;
          if (p[0] <= s.center[0]) left = true;
          if (p[0] >= s.center[0]) right = true;
          if (!best || off(p) < off(best)) best = p;
        }
        if (!best || !left || !right) continue; // 이 고리 자리를 가로질러 지나지 않는 선 (근처에서 위아래로 빠지기만 함)
        expect(Math.abs(best[1] - s.center[1])).toBeLessThan(s.wrap / 2);
        expect(Math.abs(best[2] - s.center[2])).toBeLessThan(s.depth / 2);
      }
    }
  });

  it('세로 가이드: 다발이 지나는 구간에 STRAP_SPACING 간격', () => {
    const room = newRoom();
    const h = guideOf(room.install('cable-manager', 5)!)!;
    const v = guideOf(room.addSide('cable-manager-v')!)!;
    const c = room.world.cables[2]!;
    expect(room.routeWith(c, [h.id, v.id], [])).toBe(true);
    expect(strapSpots(room, v.id)).toEqual([]);
    room.tieGuide(v.id);
    const spots = strapSpots(room, v.id);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      expect(Math.abs(s.center[0] - v.a[0])).toBeLessThan(0.03); // 차선만큼 비킴
      expect(s.center[1]).toBeGreaterThanOrEqual(v.a[1] - 1e-9);
      expect(s.center[1]).toBeLessThanOrEqual(v.b[1] + 1e-9);
    }
    for (let i = 1; i < spots.length; i++) expect(spots[i]!.center[1] - spots[i - 1]!.center[1]).toBeCloseTo(STRAP_SPACING, 9);
    expect(strapSpots(room, h.id)).toEqual([]); // 가로 구간은 안 묶음
  });

  it('경로에서 빠지면 띠 자리도 사라짐', () => {
    const room = newRoom();
    const g = guideOf(room.install('cable-manager', 5)!)!;
    for (const c of room.world.cables) room.routeCable(c, g.id);
    room.tieGuide(g.id);
    expect(strapSpots(room, g.id).length).toBeGreaterThan(0);
    for (const c of room.world.cables) room.unroute(c);
    expect(strapSpots(room, g.id)).toEqual([]);
  });
});
