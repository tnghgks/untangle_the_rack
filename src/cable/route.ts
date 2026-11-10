// 경로 찾기: 선을 가이드(매니저)에 올리면 포트 → 가이드들 → 포트로 이어지는 꺾은선을 정한다.
// Three.js에 의존하지 않는다 (헤드리스).
//
// 실제 랙처럼 위아래 이동은 랙 옆에서: 포트 → (그 높이에서 가로로) → 랙 옆 세로 매니저 → (목적지 높이에서 가로로) → 포트.
// 가로 매니저는 그 가로 구간을 받친다. 받침 없는 가로 구간은 아래로 늘어짐 → 가로 매니저를 들이게 유도.
// 가로 매니저 가까이(NEAR) 있는 포트만 짧게 위아래로 곧장 덕트에 들어감.

import { U } from '../data/units';
import type { Port, Route } from './cable';
import type { Vec3 } from './collide';
import type { Guide } from './guide';
import { SIDE_RING_X } from './manager';

/** 포트에서 곧게 나오는 길이 */
export const STUB = 0.03;
/** 포트가 이만큼(높이 차) 안이면 가로 매니저에 위아래로 곧장 들어감 */
export const NEAR = 2.5 * U;
/** 받침 없는 가로 구간의 처짐: 가로 길이 × SAG_K (최대 SAG_MAX) */
export const SAG_K = 0.35;
export const SAG_MAX = 0.18;
const SAG_SEGS = 12;
/** 처진 선이 바닥에서 떨어질 최소 높이 m */
const FLOOR_GAP = 0.01;
/** 세로 매니저 없이 랙 옆으로 늘어뜨릴 때 바깥으로 불룩한 정도 m */
const BULGE = 0.035;
const BULGE_SEGS = 8;

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

/** p → q 받침 없는 구간: 곧은 선에서 가운데가 아래로 처짐. p는 빼고 q까지 */
function sagLeg(p: Vec3, q: Vec3): Vec3[] {
  // 바닥(y 0) 밑으로는 안 처짐 — 4t(1-t) 꼴이라 가장 낮은 점은 두 끝 중 낮은 쪽보다 drop 이상 낮지 않음
  const floor = Math.max(0, Math.min(p[1], q[1]) - FLOOR_GAP);
  const drop = Math.min(SAG_MAX, SAG_K * Math.hypot(q[0] - p[0], q[2] - p[2]), floor);
  return Array.from({ length: SAG_SEGS }, (_, k) => {
    const t = (k + 1) / SAG_SEGS;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t - drop * 4 * t * (1 - t), p[2] + (q[2] - p[2]) * t] as Vec3;
  });
}

/**
 * 가로 가이드 끝 e에서 세로 매니저 없이 랙 옆(side 쪽)으로 나가 p 높이까지 늘어뜨린 뒤 p로 처져 감. e는 빼고 p까지
 */
function hangLeg(e: Vec3, p: Vec3, side: number): Vec3[] {
  const x = side * SIDE_RING_X;
  const out: Vec3[] = [[x, e[1], e[2]]];
  for (let k = 1; k <= BULGE_SEGS; k++) {
    const t = k / BULGE_SEGS;
    out.push([x + side * BULGE * Math.sin(Math.PI * t), e[1] + (p[1] - e[1]) * t, e[2]]);
  }
  out.push(...sagLeg(out[out.length - 1]!, p));
  return out;
}

/** 가로 가이드에서 side 쪽 끝 */
const sideEnd = (g: Guide, side: number): Vec3 => {
  const e = side > 0 === g.a[0] > g.b[0] ? g.a : g.b;
  return [e[0], e[1], e[2]];
};

/** 포트 쪽에서 가이드에 붙는 길: 포트 스텁 p → ... → 가이드 위 점(마지막). direct = 가로 가이드에 위아래로 곧장 */
function attach(p: Vec3, g: Guide, direct: boolean, side: number): Vec3[] {
  if (g.axis === 1) return sagLeg(p, clampTo(g, [g.a[0], p[1], g.a[2]]));
  if (direct) return approach(p, clampTo(g, p), g);
  const e = sideEnd(g, side);
  return [...hangLeg(e, p, side).reverse().slice(1), e];
}

export interface RouteLayout {
  pts: Vec3[];
  /** k번째 가이드를 따라가는 구간의 [들어가는 점, 나가는 점] pts 인덱스 */
  spans: [number, number][];
}

const dy = (p: Port, g: Guide) => Math.abs(p.pos[1] - g.a[1]);

/**
 * 가이드 하나짜리 경로에서 가로 가이드에 곧장 들어가는 끝: 가까운(NEAR 안) 끝은 다, 둘 다 멀면 더 가까운 한쪽만.
 * 여러 가이드 경로에서는 끝의 가로 가이드에 늘 곧장
 */
function directEnds(a: Port, b: Port, seq: readonly Guide[]): [boolean, boolean] {
  const g = seq[0];
  if (seq.length !== 1 || !g || g.axis !== 0) return [true, true];
  const da = dy(a, g), db = dy(b, g);
  return [da <= NEAR || da <= db, db <= NEAR || db < da];
}

/** 늘어뜨리거나 세로 매니저로 갈 랙 옆: 경로의 세로 가이드 쪽, 없으면 곧장 안 들어가는 끝 포트 쪽 (+1 오른쪽 · -1 왼쪽) */
function sideOf(a: Port, b: Port, seq: readonly Guide[], direct: readonly [boolean, boolean]): number {
  const v = seq.find((g) => g.axis === 1);
  const x = v ? v.a[0] : !direct[0] ? a.pos[0] : !direct[1] ? b.pos[0] : a.pos[0] + b.pos[0];
  return x < 0 ? -1 : 1;
}

/** 꺾은선: a → 스텁 → (붙는 길) 각 가이드 [들어가는 점 → 나가는 점] (가이드끼리는 직각으로) → (붙는 길) 스텁 → b */
export function routeLayout(a: Port, b: Port, seq: readonly Guide[], lanes: readonly LaneOffset[] = []): RouteLayout {
  const sa = stubPoint(a);
  const sb = stubPoint(b);
  const gs = seq.map((g, k) => shifted(g, lanes[k]));
  const direct = directEnds(a, b, seq);
  const side = sideOf(a, b, seq, direct);
  const pts: Vec3[] = [a.pos, sa];
  const spans: [number, number][] = [];
  const n = gs.length;
  // b 쪽 붙는 길 (b → 가이드 순서): 뒤집어 붙임
  const tail = n > 0 ? attach(sb, gs[n - 1]!, direct[1], side) : [];
  let prev = sa;
  gs.forEach((g, k) => {
    let inP: Vec3;
    if (k === 0) {
      pts.push(...attach(sa, g, direct[0], side));
      inP = pts[pts.length - 1]!;
    } else {
      inP = clampTo(g, prev);
      pts.push(...approach(prev, inP, g));
    }
    const i0 = pts.length - 1;
    const outP = k === n - 1 ? tail[tail.length - 1]! : clampTo(g, clampTo(gs[k + 1]!, inP));
    pts.push(outP);
    spans.push([i0, pts.length - 1]);
    prev = outP;
  });
  pts.push(...tail.reverse().slice(1));
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

/**
 * 놓은 가이드(dropped)를 지나는 경로 (a → b 순서). dropped가 guides에 없으면 null.
 * - 가로 가이드에 놓음: 두 끝이 다 가까우면 그것 하나. 아니면 세로 매니저(먼 끝 쪽에 가까운 것)를 거쳐
 *   먼 끝 가까이의 다른 가로 가이드까지 이어 줌. 세로 매니저가 없으면 그것 하나 (먼 끝은 랙 옆으로 늘어뜨림)
 * - 세로 가이드에 놓음: 양 끝 가까이의 가로 가이드가 있으면 앞뒤로 끼움 (없는 쪽은 늘어짐)
 */
export function findRoute(a: Port, b: Port, guides: readonly Guide[], dropped: string): Guide[] | null {
  const drop = guides.find((g) => g.id === dropped);
  if (!drop) return null;
  const nearestH = (p: Port, not?: Guide): Guide | null => {
    let best: Guide | null = null;
    for (const g of guides) {
      if (g.axis !== 0 || g === not || dy(p, g) > NEAR) continue;
      if (!best || dy(p, g) < dy(p, best)) best = g;
    }
    return best;
  };
  const pick = (xs: (Guide | null)[]) => xs.filter((g): g is Guide => g !== null);
  if (drop.axis === 1) {
    const ha = nearestH(a), hb = nearestH(b);
    return ha && ha === hb ? [drop] : pick([ha, drop, hb]);
  }
  const da = dy(a, drop), db = dy(b, drop);
  if (da <= NEAR && db <= NEAR) return [drop];
  const atA = da <= db;
  const far = atA ? b : a;
  let v: Guide | null = null;
  for (const g of guides) if (g.axis === 1 && (!v || Math.abs(g.a[0] - far.pos[0]) < Math.abs(v.a[0] - far.pos[0]))) v = g;
  if (!v) return [drop];
  const other = nearestH(far, drop);
  return atA ? pick([drop, v, other]) : pick([other, v, drop]);
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
