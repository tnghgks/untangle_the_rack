import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { guideOf } from '../src/cable/guide';
import { FREE_WEIGHT, findRoute, laneOffset, laneOffsets, pathLength, REACH_SLACK, routePath, routeScore } from '../src/cable/route';
import { createStartRoom, type Room } from '../src/view/room';

const newRoom = (): Room => createStartRoom(new THREE.Scene(), new THREE.Group());

/** 시작 방의 케이블 3가닥 끝 포트 */
const cableEnds = (room: Room) => room.world.cables.map((c) => ({ a: c.ends[0]!, b: c.ends[1]! }));

describe('가이드와 경로 찾기', () => {
  it('시작 방 3가닥 모두 U2·U5·U10·U15 매니저로 경로가 나옴', () => {
    for (const u of [2, 5, 10, 15]) {
      const room = newRoom();
      const g = guideOf(room.install('cable-manager', u)!)!;
      const ends = cableEnds(room);
      expect(ends).toHaveLength(3);
      for (const { a, b } of ends) expect(findRoute(a, b, [g], g.id, 2.0)).toEqual([g]);
    }
  });

  it('U40 매니저도 경로가 나옴 (2m 넘는 경로라도)', () => {
    const room = newRoom();
    const g = guideOf(room.install('cable-manager', 40)!)!;
    for (const { a, b } of cableEnds(room)) expect(findRoute(a, b, [g], g.id, 2.0)).toEqual([g]);
    // 적어도 한 가닥은 2m를 넘음 → 길이를 무시하는 대체 경로로 나온 것
    const over = cableEnds(room).filter(({ a, b }) => pathLength(routePath(a, b, [g])) * REACH_SLACK > 2);
    expect(over.length).toBeGreaterThan(0);
  });

  it('가이드 목록에 놓은 가이드가 없으면 null', () => {
    const room = newRoom();
    const g = guideOf(room.install('cable-manager', 5)!)!;
    const { a, b } = cableEnds(room)[0]!;
    expect(findRoute(a, b, [g], 'nope', 2.0)).toBeNull();
  });

  it('2m 안 경로가 있으면 그쪽을 고름', () => {
    const room = newRoom();
    const near = guideOf(room.install('cable-manager', 5)!)!;
    const far = guideOf(room.install('cable-manager', 40)!)!;
    for (const { a, b } of cableEnds(room)) {
      const r = findRoute(a, b, [near, far], near.id, 2.0)!;
      expect(r.map((g) => g.id)).not.toContain(far.id);
    }
  });

  it('경로는 포트에서 시작해 포트에서 끝남', () => {
    const room = newRoom();
    const g = guideOf(room.install('cable-manager', 5)!)!;
    for (const { a, b } of cableEnds(room)) {
      const pts = routePath(a, b, [g]);
      expect(pts[0]).toEqual(a.pos);
      expect(pts[pts.length - 1]).toEqual(b.pos);
      expect(pathLength(pts) * 1.02).toBeLessThanOrEqual(2);
    }
  });

  it('경로는 직각으로만 꺾임 (대각선 구간 없음, 차선이 있어도)', () => {
    const room = newRoom();
    const h = guideOf(room.install('cable-manager', 10)!)!;
    const v = guideOf(room.addSide('cable-manager-v')!)!;
    const lane = { d: [0.007, -0.007] as [number, number] };
    for (const { a, b } of cableEnds(room)) {
      for (const seq of [[h], [v], [h, v], [v, h]]) {
        const pts = routePath(a, b, seq, seq.map(() => lane));
        // 포트 → 스텁 구간(첫·끝)은 포트 방향 그대로라 빼고 검사
        for (let i = 2; i < pts.length - 1; i++) {
          const p = pts[i - 1]!, q = pts[i]!;
          const moved = [0, 1, 2].filter((k) => Math.abs(p[k]! - q[k]!) > 1e-9);
          expect(moved.length, `seq=${seq.map((g) => g.axis)} seg ${i}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('세로 매니저가 있어도 가로 단독보다 점수가 나쁘지 않은 경로를 고름', () => {
    const room = newRoom();
    const h = guideOf(room.install('cable-manager', 20)!)!;
    const v = guideOf(room.addSide('cable-manager-v')!)!;
    expect(v.axis).toBe(1);
    expect(FREE_WEIGHT).toBe(3);
    for (const { a, b } of cableEnds(room)) {
      const r = findRoute(a, b, [h, v], h.id, 2.0)!;
      expect(r.map((g) => g.id)).toContain(h.id);
      expect(routeScore(a, b, r)).toBeLessThanOrEqual(routeScore(a, b, [h]) + 1e-9);
    }
  });

  it('laneOffset 차선끼리 안 겹침', () => {
    const radius = 0.003;
    const ls = Array.from({ length: 8 }, (_, k) => laneOffset(k, 1, radius));
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const d = Math.hypot(ls[i]!.d[0] - ls[j]!.d[0], ls[i]!.d[1] - ls[j]!.d[1]);
        expect(d).toBeGreaterThanOrEqual(0.006);
      }
    }
  });

  it('차선 줄은 랙에서 먼 쪽(-z)으로 쌓임', () => {
    for (let k = 0; k < 4; k++) expect(laneOffset(k, 1, 0.003).d[1]).toBe(0);
    expect(laneOffset(4, 1, 0.003).d[1]).toBeLessThan(0);
    expect(laneOffset(8, 0, 0.003).d[1]).toBeLessThan(laneOffset(4, 0, 0.003).d[1]);
  });

  it('laneOffsets: 묶인 선(앞)과 안 묶인 선(뒤)이 섞여도 어떤 tight에서든 안 겹침', () => {
    for (const maxR of [0.003, 0.004]) {
      for (let n = 1; n <= 9; n++) {
        for (let tied = 0; tied <= n; tied++) {
          for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
            const ls = laneOffsets(n, tied, t, maxR);
            expect(ls).toHaveLength(n);
            for (let i = 0; i < n; i++) {
              for (let j = i + 1; j < n; j++) {
                const d = Math.hypot(ls[i]!.d[0] - ls[j]!.d[0], ls[i]!.d[1] - ls[j]!.d[1]);
                expect(d, `n=${n} tied=${tied} t=${t} ${i}-${j}`).toBeGreaterThanOrEqual(2 * maxR);
              }
            }
          }
        }
      }
    }
    // 다 묶이면 (또는 tight 1이면) 그냥 촘촘한 격자
    expect(laneOffsets(5, 2, 1, 0.004)).toEqual(Array.from({ length: 5 }, (_, k) => laneOffset(k, 1, 0.004)));
    expect(laneOffsets(5, 0, 0.3, 0.004)).toEqual(Array.from({ length: 5 }, (_, k) => laneOffset(k, 0.3, 0.004)));
  });
});
