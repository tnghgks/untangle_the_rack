// 케이블 매니저 (GDD 5장): 랙 칸에 끼우는 1U 부품. 뒷면에 고리가 가로로 늘어서 있고, 고리에 건 선은 그 자리에 고정된다.
// Three.js에 의존하지 않는다 (헤드리스 테스트용). 거는 손은 벨크로와 같다 — 선을 끌어 고리에 대고 Space (view/manager.ts).
// 벨크로와 차이: 기둥(랙 양 끝)이 아니라 랙 가운데 아무 높이에나 고정점을 만든다. 대신 1U와 돈을 쓴다.
// 세로 매니저 (10-26): U를 안 쓰고 랙 옆 기둥 바깥에 세로로 고리가 늘어선 부품 — 레퍼런스 사진의 옆 덕트.
// 랙 폭 밖이라 걸린 선은 배기 통로에 안 들고, 남는 길이를 세로로 흘려 둘 자리가 된다.
// 고리에 건 것도 Tie (velcro.ts) — hook에 고리 id를 적어 기둥 띠와 구분한다. 한 고리에 여러 가닥.

import { events } from '../core/events';
import { RACK, U, uBottomY } from '../data/units';
import type { Cable } from './cable';
import type { Vec3 } from './collide';
import { canReach, untie, type Tie } from './velcro';

/** 장비 뒷면 z (device.ts BACK_Z와 같은 값) */
const BACK_Z = -(RACK.depth - 0.16) / 2 - 0.002;
/** 고리 중심이 뒷면에서 떨어진 거리 — 배기 통로(EXHAUST_GAP 0.1) 앞쪽이라 건 선은 막힘으로 안 셈 */
export const RING_OUT = 0.05;
export const RING_R = 0.018;
/** 고리 중심에서 이 거리 안의 마디를 건다 */
export const HOOK_CAPTURE = 0.05;
/** 든 선을 걸 때 앞 고정점부터 이 비율만큼만 늘어지게 (1이면 딱 직선 — 물리가 떨림) */
const TAUT = 1.03;
/** 팽팽하게 걸 때 고리 안에서 선이 지나는 방향으로 비켜 놓을 수 있는 한도 (고리 안지름 3.6cm 안) */
const RING_SLIDE = 0.02;
/** 한 고리에 여러 가닥이 겹치지 않게 조금씩 비켜 놓음 (선이 지나는 축에 수직인 두 방향) */
const SPREAD: [number, number][] = [[0, 0], [0.007, 0], [-0.007, 0], [0, 0.007], [0, -0.007], [0.006, 0.006], [-0.006, -0.006]];
/**
 * 세로 매니저 고리 중심: 기둥 바깥, PDU(x 0.315~0.365) 밖. z는 레일 뒤·기둥 앞 틈(−0.45 ~ −0.47) 줄 —
 * 포트에서 옆으로 나온 선이 그 틈으로 곧게 들어옴. 랙 폭(±0.3) 밖이라 걸린 선은 배기 통로에 안 듦
 */
export const SIDE_RING_X = 0.4;
export const SIDE_RING_Z = -0.46;

export interface Ring {
  /** `${deviceId}:ring${i}` */
  id: string;
  pos: Vec3;
  /** 선이 고리를 지나가는 축: 0 = x (가로 매니저), 1 = y (세로 매니저) */
  axis: 0 | 1;
}

/** 매니저 장비(아래쪽 U)의 고리들 */
export function ringsOf(deviceId: string, u: number, xs: readonly number[]): Ring[] {
  const y = uBottomY(u) + U / 2;
  return xs.map((x, i) => ({ id: `${deviceId}:ring${i}`, pos: [x, y, BACK_Z - RING_OUT], axis: 0 }));
}

/** 세로 매니저(옆면 side 0 왼쪽 · 1 오른쪽)의 고리들. ys = 고리 높이 */
export function sideRingsOf(deviceId: string, side: number, ys: readonly number[]): Ring[] {
  const x = side === 0 ? -SIDE_RING_X : SIDE_RING_X;
  return ys.map((y, i) => ({ id: `${deviceId}:ring${i}`, pos: [x, y, SIDE_RING_Z], axis: 1 }));
}

/** 장비의 고리 (매니저가 아니면 빈 목록) */
export function deviceRings(d: { id: string; u: number | null; side: number | null; def: { rings?: readonly number[] } }): Ring[] {
  if (!d.def.rings) return [];
  if (d.u !== null) return ringsOf(d.id, d.u, d.def.rings);
  return d.side === null ? [] : sideRingsOf(d.id, d.side, d.def.rings);
}

export function deviceOfHook(hook: string): string {
  return hook.slice(0, hook.lastIndexOf(':'));
}

/** 고리에 걸린 것들 */
export function hooksAt(cables: readonly Cable[], ringId: string): { cable: Cable; tie: Tie }[] {
  return cables.flatMap((cable) => cable.ties.filter((t) => t.hook === ringId).map((tie) => ({ cable, tie })));
}

/** 걸 수 있는 마디: 커넥터 쪽 두 마디가 아니고 아직 안 묶임 */
function canHook(cable: Cable, i: number): boolean {
  return i >= 2 && i <= cable.rope.n - 3 && !cable.rope.isPinned(i);
}

/** 고리 근처의 가장 가까운 마디 (커넥터 쪽 두 마디는 꽂기가 씀) */
function nearestNode(cable: Cable, at: Vec3): number {
  const { rope } = cable;
  const p = rope.pos;
  let best = -1, bestD = HOOK_CAPTURE;
  for (let i = 2; i <= rope.n - 3; i++) {
    if (!canHook(cable, i)) continue;
    const d = Math.hypot(p[i * 3] - at[0], p[i * 3 + 1] - at[1], p[i * 3 + 2] - at[2]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * 팽팽하게 걸 마디: 잡은 마디 양옆(선을 따라)의 가장 가까운 묶음(앞서 건 고리·벨크로) 중 고리에 더 가까운 것부터
 * 직선 거리 × TAUT만큼 떨어진 마디 — 잡은 쪽으로. 실제 케이블이 고리 속을 미끄러져 고리 사이가 곧게 펴지는 것을 흉내 냄
 * (남는 길이는 반대쪽 자유 구간으로). 꽂힌 포트는 기준으로 안 씀 — 포트 바로 위 고리에 걸면 포트 옆 마디가 들어가
 * 잡은 곳과 엉뚱한 데가 걸림 (10-26 플레이 피드백). 양옆에 묶음이 없으면 null (잡은 마디 그대로)
 */
function tautNode(cable: Cable, i: number, at: Vec3, axis: 0 | 1): { node: number; at: Vec3 } | null {
  const below = cable.ties.filter((t) => t.node < i).sort((a, b) => b.node - a.node)[0];
  const above = cable.ties.filter((t) => t.node > i).sort((a, b) => a.node - b.node)[0];
  let near: Tie | null = null, nearD = Infinity;
  for (const a of [below, above]) {
    if (!a) continue;
    const d = Math.hypot(at[0] - a.pos[0], at[1] - a.pos[1], at[2] - a.pos[2]);
    if (d < nearD) { nearD = d; near = a; }
  }
  if (!near) return null;
  const seg = cable.rope.cfg.segLen;
  const dir = Math.sign(i - near.node);
  // 마디 수가 정수라 남거나 모자란 길이는 고리 안에서 선이 지나는 방향(axis)으로 비켜 흡수 → 비킬 거리가 작은 쪽
  const dx0 = at[axis] - near.pos[axis];
  const r2 = nearD * nearD - dx0 * dx0;
  const shiftFor = (n: number) => {
    const want = (n * seg) / TAUT;
    return want * want > r2 ? Math.sign(dx0 || 1) * Math.sqrt(want * want - r2) - dx0 : Infinity;
  };
  const exact = (nearD * TAUT) / seg;
  const spans = [Math.floor(exact), Math.ceil(exact)].filter((n) => n >= 1);
  const span = spans.reduce((a, b) => (Math.abs(shiftFor(b)) < Math.abs(shiftFor(a)) ? b : a));
  const j = near.node + dir * span;
  const lo = Math.min(near.node, j), hi = Math.max(near.node, j);
  // 그 사이에 다른 묶음이 끼면 선이 그 묶음을 뚫고 지나가게 됨
  if (cable.ties.some((t) => t.node > lo && t.node < hi)) return null;
  if (!canHook(cable, j)) return null;
  const s = shiftFor(span);
  const shift = Number.isFinite(s) ? Math.max(-RING_SLIDE, Math.min(RING_SLIDE, s)) : 0;
  const shifted: Vec3 = [...at];
  shifted[axis] += shift;
  if (canReach(cable, j, shifted)) return { node: j, at: shifted };
  return canReach(cable, j, at) ? { node: j, at } : null;
}

/**
 * 잡은 마디 i에서 가까운 순으로, 고리 자리 at까지 닿는 마디. 양옆 고정점(꽂힌 끝·다른 묶음)은 넘지 않는다
 * (선이 그 고정점을 뚫고 지나가지 않게). 없으면 -1
 */
function slideNode(cable: Cable, i: number, at: Vec3): number {
  const ok = (j: number) => canHook(cable, j) && canReach(cable, j, at);
  // 한쪽이 막히면 그쪽은 더 안 봄
  let loIn = true, hiIn = true;
  for (let d = 0; loIn || hiIn; d++) {
    const lo = i - d, hi = i + d;
    loIn &&= lo >= 2 && !cable.rope.isPinned(lo);
    hiIn &&= hi <= cable.rope.n - 3 && !cable.rope.isPinned(hi);
    if (loIn && ok(lo)) return lo;
    if (hiIn && ok(hi)) return hi;
  }
  return -1;
}

/** 든 선: 팽팽하게 걸 수 있으면 그 마디, 아니면 잡은 곳에서 닿는 가장 가까운 마디 */
function heldNode(cable: Cable, i: number, at: Vec3, axis: 0 | 1): { node: number; at: Vec3 } {
  return tautNode(cable, i, at, axis) ?? { node: slideNode(cable, i, at), at };
}

/**
 * 고리에 닿아 있는 선을 모두 건다 (빈손 클릭). 닿지 않아 못 건 선도 알려 줌.
 * held: 손에 든 선과 잡은 마디 — 그 선만 건다 (같은 자리를 지나는 다른 선은 그대로, 10-26 플레이 피드백). 손이 고리에 붙어 있으니 마디가 아직 덜 따라왔어도 건다. 잡은 곳이 커넥터 쪽이라
 * 고리까지 안 닿으면 고리 속으로 선이 미끄러진 것처럼 닿는 가장 가까운 마디를 건다 (10-26 "끼우기 어렵다")
 */
export function hook(cables: readonly Cable[], ring: Ring, held?: { cable: Cable; node: number }): { hooked: Cable[]; taut: Cable[] } {
  const hooked: Cable[] = [], taut: Cable[] = [];
  let k = hooksAt(cables, ring.id).length;
  for (const cable of held ? [held.cable] : cables) {
    if (cable.ties.some((t) => t.hook === ring.id)) continue;
    const [a, b] = SPREAD[k % SPREAD.length];
    const spot: Vec3 = [...ring.pos];
    spot[ring.axis === 0 ? 1 : 0] += a;
    spot[2] += b;
    const { node, at } = held ? heldNode(cable, held.node, spot, ring.axis) : { node: nearestNode(cable, ring.pos), at: spot };
    if (node < 0 && !held) continue;
    if (node < 0 || !canReach(cable, node, at)) {
      taut.push(cable);
      continue;
    }
    cable.rope.pin(node, at[0], at[1], at[2]);
    cable.ties.push({ node, pos: at, hook: ring.id });
    events.emit('cable:tied', { cableId: cable.id, node });
    hooked.push(cable);
    k++;
  }
  return { hooked, taut };
}

/** 고리에서 모두 뺌. 뺀 가닥 수 */
export function unhook(cables: readonly Cable[], ringId: string): number {
  const all = hooksAt(cables, ringId);
  for (const { cable, tie } of all) untie(cable, tie);
  return all.length;
}

/** 매니저를 빼거나 팔 때: 그 고리들에 걸린 선을 모두 풂 */
export function releaseDevice(cables: readonly Cable[], deviceId: string): void {
  for (const cable of cables) {
    for (const t of cable.ties.filter((x) => x.hook && deviceOfHook(x.hook) === deviceId)) untie(cable, t);
  }
}
