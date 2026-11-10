import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Port } from '../src/cable/cable';
import { guideOf } from '../src/cable/guide';
import { SIDE_RING_X } from '../src/cable/manager';
import { findRoute, laneKey, laneOffset, laneOffsets, laneOrder, NEAR, resample, routeLayout, routePath, smoothLayout } from '../src/cable/route';
import { createStartRoom, type Room } from '../src/view/room';

const newRoom = (): Room => createStartRoom(new THREE.Scene());

/** 시작 방의 케이블 3가닥 끝 포트 (0·1 = PDU → 스위치·서버 전원, 2 = 스위치 ↔ 서버 랜) */
const cableEnds = (room: Room) => room.world.cables.map((c) => ({ a: c.ends[0]!, b: c.ends[1]! }));
const lanEnds = (room: Room) => cableEnds(room)[2]!;
const ids = (gs: { id: string }[] | null) => gs?.map((g) => g.id);
const axisAligned = (p: readonly number[], q: readonly number[]) => [0, 1, 2].filter((k) => Math.abs(p[k]! - q[k]!) > 1e-9).length <= 1;

describe('가이드와 경로 찾기', () => {
  it('두 끝이 다 가까운 가로 매니저는 그것 하나, 직각으로만 꺾임', () => {
    const room = newRoom();
    const h = guideOf(room.install('cable-manager', 2)!)!; // 스위치 U1 · 서버 U3 사이
    const { a, b } = lanEnds(room);
    expect(Math.abs(a.pos[1] - h.a[1])).toBeLessThanOrEqual(NEAR);
    expect(findRoute(a, b, [h], h.id)).toEqual([h]);
    const pts = routeLayout(a, b, [h], [{ d: [0.007, -0.007] }]).pts; // 둥글게 하기 전 꺾은선
    for (let i = 2; i < pts.length - 1; i++) expect(axisAligned(pts[i - 1]!, pts[i]!), `seg ${i}`).toBe(true);
  });

  it('둥글게 한 경로는 급하게 꺾이지 않고, 포트 앞은 곧게 나옴 (1cm 이상)', () => {
    const room = newRoom();
    const h = guideOf(room.install('cable-manager', 2)!)!;
    const v = guideOf(room.addSide('cable-manager-v')!)!;
    for (const { a, b } of cableEnds(room)) {
      for (const seq of [[h], [v], [h, v]]) {
        const raw = routeLayout(a, b, seq);
        const sm = smoothLayout(raw);
        expect(sm.spans).toHaveLength(seq.length);
        const pts = resample(sm.pts, 300);
        let worst = 0;
        for (let i = 2; i < pts.length; i++) {
          const u = pts[i - 1]!.map((x, k) => x - pts[i - 2]![k]!), w = pts[i]!.map((x, k) => x - pts[i - 1]![k]!);
          const lu = Math.hypot(...u), lw = Math.hypot(...w);
          if (lu < 1e-6 || lw < 1e-6) continue;
          // 포트 6cm 안(커넥터 쪽)은 뺌 — PDU 콘센트는 매니저보다 뒤에 있어 거기서 좁게 되돌아 꺾일 수밖에 없음
          if (Math.hypot(...pts[i - 1]!.map((x, k) => x - a.pos[k]!)) < 0.06 || Math.hypot(...pts[i - 1]!.map((x, k) => x - b.pos[k]!)) < 0.06) continue;
          worst = Math.max(worst, Math.acos(Math.min(1, u.reduce((s, x, k) => s + x * w[k]!, 0) / (lu * lw))));
        }
        expect(worst, `seq ${seq.map((g) => g.axis)}`).toBeLessThan(Math.PI / 3); // 1cm마다 60° 미만 (안 둥글린 직각은 한 번에 90°)
        // 포트 앞: 포트 방향 그대로
        for (const [p, end] of [[a, sm.pts[1]!], [b, sm.pts[sm.pts.length - 2]!]] as const) {
          const d = end.map((x, k) => x - p.pos[k]!);
          const along = d.reduce((s, x, k) => s + x * p.dir[k]!, 0);
          expect(along).toBeGreaterThanOrEqual(0.01 - 1e-9);
          expect(Math.hypot(...d.map((x, k) => x - along * p.dir[k]!))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('가이드 목록에 놓은 가이드가 없으면 null', () => {
    const room = newRoom();
    const g = guideOf(room.install('cable-manager', 5)!)!;
    const { a, b } = cableEnds(room)[0]!;
    expect(findRoute(a, b, [g], 'nope')).toBeNull();
  });

  it('먼 가로 매니저 + 세로 매니저: 가로 → 세로로 이어지고, 먼 끝 가까이 가로 매니저도 끼움', () => {
    const room = newRoom();
    const far = guideOf(room.install('cable-manager', 20)!)!;
    const near = guideOf(room.install('cable-manager', 2)!)!;
    const v = guideOf(room.addSide('cable-manager-v')!)!;
    const top = room.install('server-entry', 21)!; // far 매니저 바로 위 서버
    const sw = room.devices.find((d) => d.def.id === 'switch-8')!;
    const a = top.ports.find((p) => p.kind === 'lan')! as Port;
    const b = sw.ports.find((p) => p.kind === 'lan' && !p.plugged)! as Port;
    expect(ids(findRoute(a, b, [far, near, v], far.id))).toEqual([far.id, v.id, near.id]);
    // 세로 매니저에 놓아도 같은 길
    expect(ids(findRoute(a, b, [far, near, v], v.id))).toEqual([far.id, v.id, near.id]);
    // 놓은 가이드가 b 쪽이면 순서도 a → b
    expect(ids(findRoute(a, b, [far, near, v], near.id))).toEqual([far.id, v.id, near.id]);
  });

  it('세로 매니저 없이 먼 가로 매니저: 그것 하나, 먼 끝은 랙 옆으로 늘어뜨림 (포트 x에서 곧장 수직으로 안 감)', () => {
    const room = newRoom();
    const h = guideOf(room.install('cable-manager', 20)!)!;
    const top = room.install('server-entry', 21)!;
    const sw = room.devices.find((d) => d.def.id === 'switch-8')!;
    const a = top.ports.find((p) => p.kind === 'lan')! as Port;
    const b = sw.ports.find((p) => p.kind === 'lan' && !p.plugged)! as Port;
    expect(findRoute(a, b, [h], h.id)).toEqual([h]);
    const pts = routePath(a, b, [h]);
    expect(pts.some((p) => Math.abs(p[0]) >= SIDE_RING_X - 1e-9)).toBe(true);
    // 가로 매니저 높이에서 b 높이까지 내려가는 구간은 다 랙 옆(|x| ≥ 매니저 끝)에서
    const hy = h.a[1], by = b.pos[1] + 0.05;
    for (const p of pts) if (p[1] < hy - 0.01 && p[1] > by) expect(Math.abs(p[0])).toBeGreaterThan(Math.abs(h.b[0]));
  });

  it('처진 선은 바닥 밑으로 안 내려감', () => {
    const room = newRoom();
    const v = guideOf(room.addSide('cable-manager-v')!)!;
    for (const { a, b } of cableEnds(room)) {
      for (const p of routePath(a, b, [v])) expect(p[1]).toBeGreaterThan(0);
    }
  });

  it('세로 매니저에만 놓으면 받침 없는 가로 구간이 아래로 처짐', () => {
    const room = newRoom();
    const v = guideOf(room.addSide('cable-manager-v')!)!;
    const { a, b } = lanEnds(room);
    expect(findRoute(a, b, [v], v.id)).toEqual([v]);
    const pts = routePath(a, b, [v]);
    const low = Math.min(a.pos[1], b.pos[1]);
    expect(Math.min(...pts.map((p) => p[1]))).toBeLessThan(low - 0.03);
  });

  it('laneOrder: 아래에서 드나드는 선이 아래 차선, 같은 쪽끼리는 오래 따라가는 선이 그 쪽에서 먼 차선', () => {
    const k = (side: number, len: number, at = 0) => ({ side, len, at });
    // 위에서 들어와 끝으로 나감(+1): 긴 선이 아래. 아래에서(-1): 긴 선이 위. 아래 무리가 먼저
    const keys = [k(1, 0.1), k(-1, 0.3), k(1, 0.3), k(-1, 0.1), k(0, 0, 0.2), k(0, 0, -0.1)];
    expect(laneOrder(keys)).toEqual([3, 1, 5, 4, 2, 0]);
  });

  it('위 포트들에서 내려와 같은 쪽 끝으로 가는 선들은 서로 안 가로지름 (먼저 들어온 선이 아래 차선)', () => {
    const room = newRoom();
    const h = guideOf(room.install('cable-manager', 20)!)!;
    const v = guideOf(room.addSide('cable-manager-v', 'rack-1', 1)!)!;
    const top = room.install('switch-8', 21)!;
    const low = room.install('server-entry', 10)!;
    const b = low.ports.find((p) => p.kind === 'lan')! as Port;
    const lans = top.ports.filter((p) => p.kind === 'lan').slice(0, 4) as Port[];
    const layouts = lans.map((a) => routeLayout(a, b, [h, v]));
    const keys = layouts.map((l) => laneKey(l, 0, h));
    for (const key of keys) expect(key.side).toBe(1); // 위에서 들어와 끝으로 나감
    const order = laneOrder(keys);
    // 차선이 아래부터: 오른쪽(세로 매니저)에서 먼 포트 = 왼쪽 포트부터
    const xs = order.map((i) => lans[i]!.pos[0]);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
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
