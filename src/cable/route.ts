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
export const STUB = 0.05;
/** 포트가 이만큼(높이 차) 안이면 가로 매니저에 위아래로 곧장 들어감 */
export const NEAR = 2.5 * U;
/** 받침 없는 가로 구간의 처짐: 가로 길이 × SAG_K (최대 SAG_MAX) */
export const SAG_K = 0.35;
export const SAG_MAX = 0.18;
/** 처진 선이 바닥에서 떨어질 최소 높이 m */
const FLOOR_GAP = 0.01;
/** 세로 매니저 없이 랙 옆으로 늘어뜨릴 때 바깥으로 불룩한 정도 m */
const BULGE = 0.035;
/**
 * 고정점까지 이 비율 이상 여유가 있어야 닿음 (딱 맞으면 물리가 떨림).
 * 직선 닿음(reach.ts)·트레이 경로 길이·바닥 칸 판정(floor.ts)이 같이 씀
 */
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

/**
 * 포트에서 곧게 나온 점. 곧장 들어갈 가로 가이드(g)가 STUB보다 가까이 포트 앞에 있으면 그 면에서 멈춤
 * (더 나갔다가 되돌아오지 않게 — PDU 콘센트는 장비 뒷면보다 뒤에 있음)
 */
function stubPoint(p: Port, g: Guide | null): Vec3 {
  let len = STUB;
  if (g && g.axis === 0) {
    const d = (g.a[0] - p.pos[0]) * p.dir[0] + (g.a[1] - p.pos[1]) * p.dir[1] + (g.a[2] - p.pos[2]) * p.dir[2];
    if (d > 1e-6 && d < STUB) len = d;
  }
  return [p.pos[0] + p.dir[0] * len, p.pos[1] + p.dir[1] * len, p.pos[2] + p.dir[2] * len];
}

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
    if (Math.abs(cur[i] - q[i]) < 1e-9) continue; // 부동소수 찌꺼기로 생기는 아주 짧은 꺾임은 건너뜀
    cur[i] = q[i];
    out.push([cur[0], cur[1], cur[2]]);
  }
  if (out.length === 0) out.push([q[0], q[1], q[2]]);
  else out[out.length - 1] = [q[0], q[1], q[2]];
  return out;
}

/**
 * 받침 없이 늘어지는 구간의 밀림: 구간 가운데에서 이만큼, 양 끝으로 갈수록 sin² 꼴로 0 (끝 기울기도 0 — 선이 뻣뻣해 끝에서 꺾이지 않음).
 * null = 곧은 구간
 */
export type Loose = Vec3 | null;

/** 붙는 길 한 토막: 앞 점(따로) → pts. offs[k] = 앞 점(또는 pts[k-1]) → pts[k] 구간의 밀림 */
interface Leg {
  pts: Vec3[];
  offs: Loose[];
}

const straight = (pts: Vec3[]): Leg => ({ pts, offs: pts.map(() => null) });

/** start → leg 를 거꾸로: leg 마지막 점에서 start까지 */
const reverseLeg = (start: Vec3, leg: Leg): Leg => ({ pts: [...leg.pts.slice(0, -1).reverse(), start], offs: [...leg.offs].reverse() });

/** p → q 처짐 (바닥 밑으로는 안 처짐 — 가장 낮은 점은 두 끝 중 낮은 쪽보다 처짐 이상 낮지 않음) */
function sag(p: Vec3, q: Vec3): Vec3 {
  const floor = Math.max(0, Math.min(p[1], q[1]) - FLOOR_GAP);
  return [0, -Math.min(SAG_MAX, SAG_K * Math.hypot(q[0] - p[0], q[2] - p[2]), floor), 0];
}

/** 가이드 g가 속한 랙의 옆(side 쪽) x — 랙 원점 기준 */
const sideX = (g: Guide, side: number) => g.origin[0] + side * SIDE_RING_X;

/** 가로 가이드 위 점 e에서 세로 매니저 없이 랙 옆(side 쪽)으로 나가, p 높이까지 바깥으로 불룩하게 늘어뜨린 뒤 p로 처져 감 */
function hangLeg(g: Guide, e: Vec3, p: Vec3, side: number): Leg {
  const x = sideX(g, side);
  const s1: Vec3 = [x, e[1], e[2]], s2: Vec3 = [x, p[1], e[2]];
  return { pts: [s1, s2, p], offs: [null, [side * BULGE, 0, 0], sag(s2, p)] };
}

/** 가로 가이드에서 side 쪽 끝 */
const sideEnd = (g: Guide, side: number): Vec3 => {
  const e = side > 0 === g.a[0] > g.b[0] ? g.a : g.b;
  return [e[0], e[1], e[2]];
};

/** 포트 쪽에서 가이드에 붙는 길: 포트 스텁 p → ... → 가이드 위 점(마지막). direct = 가로 가이드에 위아래로 곧장 */
function attach(p: Vec3, g: Guide, direct: boolean, side: number): Leg {
  if (g.axis === 1) {
    const q = clampTo(g, [g.a[0], p[1], g.a[2]]);
    return { pts: [q], offs: [sag(p, q)] };
  }
  if (direct) return straight(approach(p, clampTo(g, p), g));
  // 트레이는 끝이 아니라 랙 옆 바로 위 점에서 늘어뜨림 (세로 매니저와 같은 x)
  const e = g.tray ? clampTo(g, [sideX(g, side), g.a[1], g.a[2]]) : sideEnd(g, side);
  return reverseLeg(e, hangLeg(g, e, p, side));
}

export interface RouteLayout {
  pts: Vec3[];
  /** k번째 가이드를 따라가는 구간의 [들어가는 점, 나가는 점] pts 인덱스 */
  spans: [number, number][];
  /** loose[i] = pts[i] → pts[i+1] 구간의 처짐 (smoothLayout이 펼침). 없으면 다 곧음 */
  loose?: Loose[];
}

const dy = (p: Port, g: Guide) => Math.abs(p.pos[1] - g.a[1]);

/**
 * 가이드 하나짜리 경로에서 가로 가이드에 곧장 들어가는 끝: 가까운(NEAR 안) 끝은 다, 둘 다 멀면 더 가까운 한쪽만.
 * 여러 가이드 경로에서는 끝의 가로 가이드에 늘 곧장
 */
function directEnds(a: Port, b: Port, seq: readonly Guide[]): [boolean, boolean] {
  const g = seq[0];
  // 트레이에 붙는 끝은 곧장 안 들어가고 늘 랙 옆으로 늘어뜨려 오름
  const last = seq[seq.length - 1];
  if (g?.tray || last?.tray) return [!g?.tray, !last?.tray];
  if (seq.length !== 1 || !g || g.axis !== 0) return [true, true];
  const da = dy(a, g), db = dy(b, g);
  return [da <= NEAR || da <= db, db <= NEAR || db < da];
}

/**
 * 늘어뜨리거나 세로 매니저로 갈 랙 옆: 경로의 세로 가이드 쪽, 없으면 곧장 안 들어가는 끝 포트 쪽 (+1 오른쪽 · -1 왼쪽).
 * 부호는 그 가이드의 랙 원점 기준
 */
function sideOf(a: Port, b: Port, seq: readonly Guide[], direct: readonly [boolean, boolean]): number {
  const v = seq.find((g) => g.axis === 1);
  const o = (v ?? seq[0])?.origin[0] ?? 0;
  const x = v ? v.a[0] - o : !direct[0] ? a.pos[0] - o : !direct[1] ? b.pos[0] - o : a.pos[0] - o + (b.pos[0] - o);
  return x < 0 ? -1 : 1;
}

/** 랙 원점 o에서 상대 랙(원점 to) 쪽 옆: 상대 x가 크면 +1(오른쪽), 작으면 -1(왼쪽), 같으면 포트 p의 x 쪽 */
function towardSide(o: Vec3, to: Vec3, p: Port): number {
  if (to[0] !== o[0]) return to[0] > o[0] ? 1 : -1;
  return p.pos[0] < o[0] ? -1 : 1;
}

/**
 * 끝마다 따로 정한 옆. 트레이에 붙는 끝은 그 랙에서 상대 랙(경로 반대쪽 끝 트레이의 랙) 쪽, 그 밖엔 sideOf.
 * 트레이가 하나뿐이면 상대가 같은 랙이라 포트 x 쪽
 */
function endSides(a: Port, b: Port, seq: readonly Guide[], direct: readonly [boolean, boolean]): [number, number] {
  const s = sideOf(a, b, seq, direct);
  const trays = seq.filter((g) => g.tray);
  const first = seq[0], last = seq[seq.length - 1];
  const sa = first?.tray ? towardSide(first.origin, trays[trays.length - 1]!.origin, a) : s;
  const sb = last?.tray ? towardSide(last.origin, trays[0]!.origin, b) : s;
  return [sa, sb];
}

/** 경로에 트레이가 있나 (있으면 선 길이로 거름) */
export function hasTray(seq: readonly Guide[]): boolean {
  return seq.some((g) => g.tray);
}

/**
 * 꺾은선(꺾이는 점만): a → 스텁 → (붙는 길) 각 가이드 [들어가는 점 → 나가는 점] (가이드끼리는 직각으로) → (붙는 길) 스텁 → b.
 * 받침 없는 구간은 loose에 처짐만 적어 둠 — 모양은 smoothLayout이 만듦
 */
export function routeLayout(a: Port, b: Port, seq: readonly Guide[], lanes: readonly LaneOffset[] = []): RouteLayout {
  const gs = seq.map((g, k) => shifted(g, lanes[k]));
  const direct = directEnds(a, b, seq);
  const sa = stubPoint(a, direct[0] ? gs[0] ?? null : null);
  const sb = stubPoint(b, direct[1] ? gs[gs.length - 1] ?? null : null);
  const [sideA, sideB] = endSides(a, b, seq, direct);
  const pts: Vec3[] = [a.pos, sa];
  const loose: Loose[] = [null];
  const add = (leg: Leg) =>
    leg.pts.forEach((q, k) => {
      loose.push(leg.offs[k] ?? null);
      pts.push(q);
    });
  const spans: [number, number][] = [];
  const n = gs.length;
  // b 쪽 붙는 길 (b 스텁 → 가이드): 끝에 거꾸로 붙임
  const tail = n > 0 ? attach(sb, gs[n - 1]!, direct[1], sideB) : straight([sb]);
  let prev = sa;
  gs.forEach((g, k) => {
    if (k === 0) add(attach(sa, g, direct[0], sideA));
    else add(straight(approach(prev, clampTo(g, prev), g)));
    const i0 = pts.length - 1;
    const outP = k === n - 1 ? tail.pts[tail.pts.length - 1]! : clampTo(g, clampTo(gs[k + 1]!, pts[i0]!));
    add(straight([outP]));
    spans.push([i0, pts.length - 1]);
    prev = outP;
  });
  if (n > 0) add(reverseLeg(sb, tail));
  else add(straight([sb]));
  add(straight([b.pos]));
  return { pts, spans, loose };
}

/** 꺾임을 둥글게 하는 반지름 m (실제 선이 휘는 정도) */
export const BEND_R = 0.04;
/** 포트 앞 이만큼은 곧게 (커넥터·부트) — 첫·끝 꺾임이 여기를 못 먹음 */
const PLUG_STRAIGHT = 0.03;
const BEND_SEGS = 8;
/** 이보다 덜 꺾이면 그대로 */
const BEND_MIN = 0.17;
/** 처진 구간을 나누는 수 */
const LOOSE_SEGS = 16;

/**
 * 꺾이는 점마다 반지름 BEND_R의 곡선(2차 베지어)으로 둥글게. 한 구간은 양 끝 꺾임이 반씩 나눠 쓰고,
 * 포트 쪽 첫·끝 구간은 PLUG_STRAIGHT만 남기고 다 씀. 그다음 loose 구간을 처지게 펼침.
 * spans는 새 점 인덱스로 옮김 (꺾임 → 곡선 가운데)
 */
export function smoothLayout(raw: RouteLayout, r = BEND_R): RouteLayout {
  // 0) 겹친 점(길이 0 구간)을 뺌 — 그 자리 꺾임도 둥글게 하려고
  const pts: Vec3[] = [];
  const loose: Loose[] = [];
  const idx: number[] = [];
  let next: Loose = null; // 마지막 남긴 점에서 나가는 구간의 처짐
  raw.pts.forEach((p, i) => {
    const last = pts[pts.length - 1];
    if (last && dist(last, p) < 1e-6) {
      idx.push(pts.length - 1);
      next = raw.loose?.[i] ?? next;
      return;
    }
    if (last) loose.push(next);
    idx.push(pts.length);
    pts.push(p);
    next = raw.loose?.[i] ?? null;
  });
  const spans = raw.spans.map(([i, j]): [number, number] => [idx[i]!, idx[j]!]);
  const n = pts.length;
  // 1) 꺾임마다 곧은 구간을 얼마나 먹는지 (t = 꺾는 점에서 곡선 시작까지)
  const t = pts.map(() => 0);
  const budget = (len: number, end: boolean) => (end ? len - Math.min(PLUG_STRAIGHT, len / 2) : len / 2);
  for (let i = 1; i < n - 1; i++) {
    const p = pts[i]!, a = pts[i - 1]!, b = pts[i + 1]!;
    const la = dist(a, p), lb = dist(b, p);
    if (la < 1e-9 || lb < 1e-9) continue;
    const cos = ((a[0] - p[0]) * (b[0] - p[0]) + (a[1] - p[1]) * (b[1] - p[1]) + (a[2] - p[2]) * (b[2] - p[2])) / (la * lb);
    const theta = Math.acos(Math.max(-1, Math.min(1, cos))); // 두 구간 사이 각 (π = 곧음)
    if (Math.PI - theta < BEND_MIN) continue;
    const ti = Math.min(r / Math.tan(theta / 2), budget(la, i === 1), budget(lb, i === n - 2));
    if (ti >= 1e-4) t[i] = ti;
  }
  // 2) 펼치기
  const out: Vec3[] = [pts[0]!];
  const map = [0];
  const along = (p: Vec3, q: Vec3, d: number): Vec3 => {
    const l = dist(p, q);
    return [p[0] + ((q[0] - p[0]) / l) * d, p[1] + ((q[1] - p[1]) / l) * d, p[2] + ((q[2] - p[2]) / l) * d];
  };
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]!, p = pts[i]!;
    const off = loose?.[i - 1];
    if (off) {
      const len = dist(a, p);
      const from = t[i - 1]! / len, to = 1 - t[i]! / len;
      for (let k = 1; k < LOOSE_SEGS; k++) {
        const u = from + ((to - from) * k) / LOOSE_SEGS;
        // 둥근 꺾임 사이 곧은 부분에서만 처짐 (꺾임 끝에서 0). 꺾임이 구간을 거의 다 먹었으면 그만큼 덜 처짐
        const w = (to - from) * Math.sin((Math.PI * k) / LOOSE_SEGS) ** 2;
        out.push([a[0] + (p[0] - a[0]) * u + off[0] * w, a[1] + (p[1] - a[1]) * u + off[1] * w, a[2] + (p[2] - a[2]) * u + off[2] * w]);
      }
    }
    if (i === n - 1 || t[i] === 0) {
      map.push(out.length);
      out.push(p);
      continue;
    }
    const b = pts[i + 1]!;
    const p1 = along(p, a, t[i]!), p2 = along(p, b, t[i]!);
    map.push(out.length + BEND_SEGS / 2);
    for (let k = 0; k <= BEND_SEGS; k++) {
      const s = k / BEND_SEGS, w0 = (1 - s) * (1 - s), w1 = 2 * (1 - s) * s, w2 = s * s;
      out.push([p1[0] * w0 + p[0] * w1 + p2[0] * w2, p1[1] * w0 + p[1] * w1 + p2[1] * w2, p1[2] * w0 + p[2] * w1 + p2[2] * w2]);
    }
  }
  return { pts: out, spans: spans.map(([i, j]) => [map[i]!, map[j]!]) };
}

/** 꺾은선 위를 호 길이로 고르게 m개 점 (양 끝 포함) */
export function resample(pts: readonly Vec3[], m: number): Vec3[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const total = cum[cum.length - 1]!;
  const out: Vec3[] = [];
  let seg = 0;
  for (let i = 0; i < m; i++) {
    const d = m === 1 ? 0 : (total * i) / (m - 1);
    while (seg < pts.length - 2 && cum[seg + 1]! < d) seg++;
    const span = cum[seg + 1]! - cum[seg]!;
    const u = span > 1e-9 ? (d - cum[seg]!) / span : 0;
    const a = pts[seg]!, b = pts[Math.min(seg + 1, pts.length - 1)]!;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
  }
  return out;
}

/** 실제 선 모양 (둥근 꺾임·처짐까지) */
export function routePath(a: Port, b: Port, seq: readonly Guide[], lanes: readonly LaneOffset[] = []): Vec3[] {
  return smoothLayout(routeLayout(a, b, seq, lanes)).pts;
}

export function pathLength(pts: readonly Vec3[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1]!, pts[i]!);
  return s;
}

/**
 * 놓은 가이드(dropped)를 지나는 경로 (a → b 순서). dropped가 guides에 없으면 null.
 * 같은 랙: 그 랙 매니저만(트레이 빼고) 씀 — 트레이에 놓으면 null.
 * - 가로 가이드에 놓음: 두 끝이 다 가까우면 그것 하나. 아니면 세로 매니저(먼 끝 쪽에 가까운 것)를 거쳐
 *   먼 끝 가까이의 다른 가로 가이드까지 이어 줌. 세로 매니저가 없으면 그것 하나 (먼 끝은 랙 옆으로 늘어뜨림)
 * - 세로 가이드에 놓음: 양 끝 가까이의 가로 가이드가 있으면 앞뒤로 끼움 (없는 쪽은 늘어짐)
 * 다른 랙: crossRoute 후보 중 maxLen에 맞는 첫 경로. 실제 선 모양 길이 × REACH_SLACK가 maxLen을 넘으면 그 후보는 버림
 */
export function findRoute(a: Port, b: Port, guides: readonly Guide[], dropped: string, maxLen = Infinity): Guide[] | null {
  if (a.rack !== b.rack) {
    for (const seq of crossRoutes(a, b, guides, dropped)) {
      if (pathLength(routePath(a, b, seq)) * REACH_SLACK <= maxLen) return seq;
    }
    return null;
  }
  const own = guides.filter((g) => g.rack === a.rack && !g.tray);
  const drop = own.find((g) => g.id === dropped);
  if (!drop) return null;
  const nearestH = (p: Port, not?: Guide): Guide | null => nearestHOf(p, own, not);
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
  for (const g of own) if (g.axis === 1 && (!v || Math.abs(g.a[0] - far.pos[0]) < Math.abs(v.a[0] - far.pos[0]))) v = g;
  if (!v) return [drop];
  const other = nearestH(far, drop);
  return atA ? pick([drop, v, other]) : pick([other, v, drop]);
}

/** p 높이에서 NEAR 안 가장 가까운 가로 가이드 (not 빼고) */
function nearestHOf(p: Port, guides: readonly Guide[], not?: Guide): Guide | null {
  let best: Guide | null = null;
  for (const g of guides) {
    if (g.axis !== 0 || g === not || dy(p, g) > NEAR) continue;
    if (!best || dy(p, g) < dy(p, best)) best = g;
  }
  return best;
}

/**
 * 다른 랙 사이 경로: [hA, vA, a 랙 트레이, (같은 줄이면) 사이 랙 트레이들(x 순), b 랙 트레이, vB, hB] 중 있는 것.
 * h = 그 랙 가로 매니저 중 포트에서 NEAR 안 가장 가까운 것, v = 그 랙 세로 매니저 중 상대 랙 쪽 옆(없으면 반대쪽).
 * 후보 순서: 다 있는 것 → 세로 매니저(vA·vB) 뺀 것 → 가로 매니저(hA·hB)까지 뺀 것. 놓은 가이드(dropped)는 늘 남김
 * (먼 쪽 세로 매니저를 타면 초록 칸에서도 길이를 넘을 수 있어서). 두 랙 중 한쪽 트레이가 없거나 dropped가 경로에 없으면 빈 목록
 */
function crossRoutes(a: Port, b: Port, guides: readonly Guide[], dropped: string): Guide[][] {
  const trayOf = (rack: string) => guides.find((g) => g.tray && g.rack === rack);
  const tA = trayOf(a.rack), tB = trayOf(b.rack);
  if (!tA || !tB) return [];
  const ends = (p: Port, tray: Guide, other: Guide): (Guide | null)[] => {
    const own = guides.filter((g) => g.rack === p.rack && !g.tray);
    const side = towardSide(tray.origin, other.origin, p);
    const vs = own.filter((g) => g.axis === 1);
    const onSide = (s: number) => vs.find((g) => (g.a[0] - tray.origin[0] < 0 ? -1 : 1) === s) ?? null;
    return [nearestHOf(p, own), onSide(side) ?? onSide(-side)];
  };
  const [hA, vA] = ends(a, tA, tB);
  const [hB, vB] = ends(b, tB, tA);
  const [xa, xb] = [tA.origin[0], tB.origin[0]];
  const between = tA.origin[2] === tB.origin[2]
    ? guides
        .filter((g) => g.tray && g !== tA && g !== tB && g.origin[2] === tA.origin[2] && g.origin[0] > Math.min(xa, xb) && g.origin[0] < Math.max(xa, xb))
        .sort((g, h) => (xb > xa ? g.origin[0] - h.origin[0] : h.origin[0] - g.origin[0]))
    : [];
  const full = [hA, vA, tA, ...between, tB, vB, hB].filter((g): g is Guide => !!g);
  if (!full.some((g) => g.id === dropped)) return [];
  const without = (seq: Guide[], xs: (Guide | null)[]) => seq.filter((g) => g.id === dropped || !xs.includes(g));
  const noV = without(full, [vA, vB]);
  const noVH = without(noV, [hA, hB]);
  const out = [full];
  for (const s of [noV, noVH]) if (s.length < out[out.length - 1]!.length) out.push(s);
  return out;
}

/** 한 가이드를 지나는 선 하나의 모양 (차선 순서용) */
export interface LaneKey {
  /** 들어올 때·나갈 때 가이드에 수직인 축(가로 y · 세로 x)에서 온 쪽 부호 합 (-2..2). 가이드 끝으로 드나들면 0 */
  side: number;
  /** 가이드를 따라 간 길이 */
  len: number;
  /** 들어오는 점의 가이드 축 좌표 */
  at: number;
}

/** routeLayout(차선 없이)의 k번째 가이드 구간에서 그 선의 LaneKey */
export function laneKey({ pts, spans }: RouteLayout, k: number, g: Guide): LaneKey {
  const [i0, i1] = spans[k]!;
  const perp = g.axis === 0 ? 1 : 0;
  const from = (n: Vec3 | undefined, p: Vec3) => {
    const d = n ? n[perp] - p[perp] : 0;
    return Math.abs(d) < 1e-6 ? 0 : Math.sign(d);
  };
  return { side: from(pts[i0 - 1], pts[i0]!) + from(pts[i1 + 1], pts[i1]!), len: dist(pts[i0]!, pts[i1]!), at: pts[i0]![g.axis] };
}

/**
 * 서로 가로지르지 않는 차선 순서 (차선 0 = 가이드에 수직인 축에서 가장 낮은 쪽).
 * 아래(−)에서 드나드는 선이 아래 차선, 위(+)에서 드나드는 선이 위 차선.
 * 같은 쪽에서 드나드는 선끼리는 가이드를 오래 따라가는 선이 그 쪽에서 먼 차선 — 짧은 선이 긴 선을 안 넘음.
 * 돌려주는 값: 차선 순서대로 keys의 인덱스
 */
export function laneOrder(keys: readonly LaneKey[]): number[] {
  return keys
    .map((_, i) => i)
    .sort((i, j) => {
      const p = keys[i]!, q = keys[j]!;
      if (p.side !== q.side) return p.side - q.side;
      if (p.side > 0) return q.len - p.len;
      if (p.side < 0) return p.len - q.len;
      return p.at - q.at;
    });
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
