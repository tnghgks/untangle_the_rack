// 경로 찾기: 선을 가이드(매니저)에 올리면 포트 → 가이드들 → 포트로 이어지는 꺾은선을 정한다.
// Three.js에 의존하지 않는다 (헤드리스).

import type { Port } from './cable';
import type { Vec3 } from './collide';
import type { Guide } from './guide';

export const MAX_GUIDES = 3;
/** 가이드 밖 구간 길이에 붙는 점수 가중치 (가이드를 더 많이 지나는 경로가 이김) */
export const FREE_WEIGHT = 3;
/** 포트에서 곧게 나오는 길이 */
export const STUB = 0.03;
/** 길이 여유 배수 */
export const REACH_SLACK = 1.02;

/** 가이드 축에 수직인 두 방향 오프셋 m (가로 가이드: [y, z], 세로 가이드: [x, z]) */
export interface LaneOffset {
  d: [number, number];
}

const dist = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** 선분 g 위에서 p에 가장 가까운 점 */
function clampTo(g: Guide, p: Vec3): Vec3 {
  const ab: Vec3 = [g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - g.a[0]) * ab[0] + (p[1] - g.a[1]) * ab[1] + (p[2] - g.a[2]) * ab[2]) / len2));
  return [g.a[0] + ab[0] * t, g.a[1] + ab[1] * t, g.a[2] + ab[2] * t];
}

const stubPoint = (p: Port): Vec3 => [p.pos[0] + p.dir[0] * STUB, p.pos[1] + p.dir[1] * STUB, p.pos[2] + p.dir[2] * STUB];

/** 꺾은선: a → 스텁 → 각 가이드 [들어가는 점, 나가는 점] → 스텁 → b */
export function routePath(a: Port, b: Port, seq: readonly Guide[], lanes: readonly LaneOffset[] = []): Vec3[] {
  const sa = stubPoint(a);
  const sb = stubPoint(b);
  const pts: Vec3[] = [a.pos, sa];
  let prev = sa;
  seq.forEach((g, k) => {
    const inP = clampTo(g, prev);
    const next = k + 1 < seq.length ? clampTo(seq[k + 1]!, inP) : sb;
    const outP = clampTo(g, next);
    const off = lanes[k];
    if (off) {
      // 가이드 축에 수직인 두 방향: 가로 [y, z], 세로 [x, z]
      const i0 = g.axis === 0 ? 1 : 0;
      for (const p of [inP, outP]) {
        p[i0] += off.d[0];
        p[2] += off.d[1];
      }
    }
    pts.push(inP, outP);
    prev = outP;
  });
  pts.push(sb, b.pos);
  return pts;
}

export function pathLength(pts: readonly Vec3[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1]!, pts[i]!);
  return s;
}

/** 점수 = 전체 길이 + FREE_WEIGHT × 가이드 밖 구간 길이 (작을수록 좋음) */
export function routeScore(a: Port, b: Port, seq: readonly Guide[]): number {
  const pts = routePath(a, b, seq);
  // pts = [a, 스텁, (in, out)*, 스텁, b] — 가이드 밖 구간은 스텁 이후 out→다음 in 사이(인덱스 1→2, 3→4, ...)
  let free = 0;
  for (let i = 1; i < pts.length - 2; i += 2) free += dist(pts[i]!, pts[i + 1]!);
  return pathLength(pts) + FREE_WEIGHT * free;
}

/** dropped를 포함하는 서로 다른 가이드 1~MAX_GUIDES개의 모든 순서 */
function* sequences(guides: readonly Guide[], dropped: Guide): Generator<Guide[]> {
  const others = guides.filter((g) => g !== dropped);
  function* build(cur: Guide[], used: boolean[]): Generator<Guide[]> {
    if (cur.includes(dropped)) yield cur.slice();
    if (cur.length >= MAX_GUIDES) return;
    for (let i = 0; i < others.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(others[i]!);
      yield* build(cur, used);
      cur.pop();
      used[i] = false;
    }
    if (!cur.includes(dropped)) {
      cur.push(dropped);
      yield* build(cur, used);
      cur.pop();
    }
  }
  yield* build([], others.map(() => false));
}

/**
 * 놓은 가이드(dropped)를 포함하는 경로 중 maxLen 안에 드는 점수 최소를 고른다.
 * 하나도 없으면 길이를 무시하고 [dropped] 단독 (어디든 허용). dropped가 guides에 없으면 null
 */
export function findRoute(a: Port, b: Port, guides: readonly Guide[], dropped: string, maxLen: number): Guide[] | null {
  const drop = guides.find((g) => g.id === dropped);
  if (!drop) return null;
  let best: Guide[] | null = null;
  let bestScore = Infinity;
  for (const seq of sequences(guides, drop)) {
    if (pathLength(routePath(a, b, seq)) * REACH_SLACK > maxLen) continue;
    const s = routeScore(a, b, seq);
    if (s < bestScore) {
      bestScore = s;
      best = seq;
    }
  }
  return best ?? [drop];
}

/** k번째 차선 오프셋. 촘촘(tight=1)은 선이 맞닿게, 느슨(tight=0)은 0.014 간격. 4줄씩 쌓은 격자 */
export function laneOffset(k: number, tight: number, radius: number): LaneOffset {
  const gap = 0.014 + (2 * radius + 0.001 - 0.014) * tight;
  const col = k % 4;
  const row = Math.floor(k / 4);
  return { d: [(col - 1.5) * gap, row * gap] };
}
