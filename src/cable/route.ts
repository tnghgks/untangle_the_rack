// 경로 찾기: 선을 가이드(매니저)에 올리면 포트 → 가이드들 → 포트로 이어지는 꺾은선을 정한다.
// Three.js에 의존하지 않는다 (헤드리스).

import type { Port, Route } from './cable';
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

/** 차선만큼 옮긴 가이드 (가이드 축에 수직인 두 방향: 가로 [y, z], 세로 [x, z]) */
function shifted(g: Guide, off: LaneOffset | undefined): Guide {
  if (!off) return g;
  const i0 = g.axis === 0 ? 1 : 0;
  const mv = (p: Vec3): Vec3 => {
    const q: Vec3 = [p[0], p[1], p[2]];
    q[i0] += off.d[0];
    q[2] += off.d[1];
    return q;
  };
  return { ...g, a: mv(g.a), b: mv(g.b) };
}

/**
 * p에서 가이드 g 위 점 q까지 한 축씩 직각으로: z(랙 앞뒤) → 가이드에 수직 → 가이드 축.
 * 꺾이는 점들을 돌려줌, 마지막은 늘 q
 */
function approach(p: Vec3, q: Vec3, g: Guide): Vec3[] {
  const cur: Vec3 = [p[0], p[1], p[2]];
  const out: Vec3[] = [];
  for (const i of [2, g.axis === 0 ? 1 : 0, g.axis]) {
    if (cur[i] === q[i]) continue;
    cur[i] = q[i];
    out.push([cur[0], cur[1], cur[2]]);
  }
  if (out.length === 0) out.push([q[0], q[1], q[2]]);
  return out;
}

export interface RouteLayout {
  pts: Vec3[];
  /** k번째 가이드를 따라가는 구간의 [들어가는 점, 나가는 점] pts 인덱스 */
  spans: [number, number][];
}

/** 꺾은선: a → 스텁 → (직각으로 꺾어) 각 가이드 [들어가는 점 → 나가는 점] → (직각으로) 스텁 → b */
export function routeLayout(a: Port, b: Port, seq: readonly Guide[], lanes: readonly LaneOffset[] = []): RouteLayout {
  const sa = stubPoint(a);
  const sb = stubPoint(b);
  const gs = seq.map((g, k) => shifted(g, lanes[k]));
  const pts: Vec3[] = [a.pos, sa];
  const spans: [number, number][] = [];
  let prev = sa;
  gs.forEach((g, k) => {
    const inP = clampTo(g, prev);
    const next = k + 1 < gs.length ? clampTo(gs[k + 1]!, inP) : sb;
    const outP = clampTo(g, next);
    pts.push(...approach(prev, inP, g));
    const i0 = pts.length - 1;
    pts.push(outP);
    spans.push([i0, pts.length - 1]);
    prev = outP;
  });
  const last = gs[gs.length - 1];
  // 나갈 때는 b 쪽에서 들어오는 것과 같은 꺾임을 거꾸로
  if (last) pts.push(...approach(sb, prev, last).reverse().slice(1));
  pts.push(sb, b.pos);
  return { pts, spans };
}

export function routePath(a: Port, b: Port, seq: readonly Guide[], lanes: readonly LaneOffset[] = []): Vec3[] {
  return routeLayout(a, b, seq, lanes).pts;
}

export function pathLength(pts: readonly Vec3[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1]!, pts[i]!);
  return s;
}

/** 점수 = 전체 길이 + FREE_WEIGHT × 가이드 밖 구간 길이 (작을수록 좋음) */
export function routeScore(a: Port, b: Port, seq: readonly Guide[]): number {
  const { pts, spans } = routeLayout(a, b, seq);
  const total = pathLength(pts);
  // 가이드 밖 = 스텁 사이 전체 − 가이드를 따라가는 구간
  let free = total - dist(pts[0]!, pts[1]!) - dist(pts[pts.length - 2]!, pts[pts.length - 1]!);
  for (const [i, j] of spans) free -= dist(pts[i]!, pts[j]!);
  return total + FREE_WEIGHT * free;
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

/** 느슨할 때(tight 0) 차선 간격 m */
export const LOOSE_GAP = 0.014;
/** 한 줄의 차선 수 */
const LANE_COLS = 4;

/**
 * k번째 차선 오프셋. 4줄씩 쌓은 격자이고, 줄은 -z(랙·장비 뒷면에서 먼 쪽)로 늘어남.
 * 간격: 촘촘(tight=1)은 가장 굵은 선끼리 맞닿게(2 × maxRadius + 1mm), 느슨(tight=0)은 LOOSE_GAP.
 * maxRadius = 그 가이드를 지나는 선 중 가장 굵은 선의 반지름 (한 가이드에 격자 하나)
 */
export function laneOffset(k: number, tight: number, maxRadius: number): LaneOffset {
  const gap = LOOSE_GAP + (2 * maxRadius + 0.001 - LOOSE_GAP) * tight;
  const col = k % LANE_COLS;
  const row = Math.floor(k / LANE_COLS);
  return { d: [(col - (LANE_COLS - 1) / 2) * gap, 0 - row * gap] }; // 0 - : 첫 줄을 -0 아닌 0으로
}

/**
 * 한 가이드를 지나는 선 n가닥의 차선. 앞의 tiedCount가닥은 묶인 선(늘 촘촘), 나머지는 안 묶인 선(tight).
 * 안 묶인 선은 묶인 다발 뒤 차선을 이어 쓰고, 느슨한 만큼(1 - tight) 다발에서 -z로 LOOSE_GAP 비켜 서로 파고들지 않음.
 * tight 1이 되면 다 묶인 격자와 같은 자리 → 묶는 순간 선이 튀지 않음
 */
export function laneOffsets(n: number, tiedCount: number, tight: number, maxRadius: number): LaneOffset[] {
  const away = tiedCount > 0 ? (1 - tight) * LOOSE_GAP : 0;
  return Array.from({ length: n }, (_, k) => {
    if (k < tiedCount) return laneOffset(k, 1, maxRadius);
    const off = laneOffset(k, tight, maxRadius);
    off.d[1] -= away;
    return off;
  });
}

/** 정리 정도 0..1: 경로의 가이드 중 묶인 비율 (경로 없으면 0) */
export function tidyDegree(r: Route | null): number {
  return r ? r.tied.filter((g) => r.guides.includes(g)).length / r.guides.length : 0;
}
