// 벨크로 (GDD 5장): 랙 뒷면 기둥에 띠를 감아, 그 높이에서 기둥에 걸쳐 있는 케이블을 묶는다. Three.js에 의존하지 않는다 (헤드리스 테스트용).
// 케이블을 기둥으로 옮기는 건 플레이어 손(drag.ts) — 띠는 이미 기둥에 닿아 있는 선만 잡는다 (10-25 결정: 직접 정리하는 맛).
// 한 띠가 여러 가닥을 다발로 묶는다. 띠 = 같은 기둥·같은 높이의 묶음(Tie)들 — 따로 저장하지 않고 묶음 자리로 묶어 본다.
// 무료·무제한. 띠를 다시 클릭하면 풀리고, 손으로 세게 당기면 그 케이블의 가장 가까운 묶음이 떨어진다 (drag.ts).
//
// 묶을 수 있는지: 묶을 자리에서 다른 고정점(꽂힌 끝·다른 묶음)까지 거리가 그 사이 케이블 길이보다 멀면 못 묶는다
// (늘어나지 않는 케이블).

import { events } from '../core/events';
import { RACK, RACK_HEIGHT } from '../data/units';
import { endNode, type Cable } from './cable';
import type { Vec3 } from './collide';

export interface Tie {
  node: number;
  pos: Vec3;
}

/** 뒷면 기둥: x 부호(-1 왼쪽, 1 오른쪽) */
export type Post = -1 | 1;

/** 뒷면 기둥 중심 (scene.ts createRack과 같은 자리) */
export const POST_X = (RACK.width - RACK.frame) / 2;
export const POST_Z = -(RACK.depth - RACK.frame) / 2;
export const POST_HALF = RACK.frame / 2;
/** 띠를 감을 수 있는 높이 (바닥·꼭대기 판과 겹치지 않게) */
export const STRAP_Y_MIN = 0.06;
export const STRAP_Y_MAX = RACK_HEIGHT - 0.05;
/** 띠가 잡는 범위: 기둥 중심에서 수평 거리, 띠 높이에서 위아래 */
export const STRAP_CAPTURE = 0.07;
export const STRAP_REACH_Y = 0.05;
/** 이미 감긴 띠에서 이 높이 차 안을 클릭하면 풀기 */
export const STRAP_PICK_Y = 0.03;
/** 묶인 선이 기둥 겉면에서 떨어진 거리 (반지름 밖 여유) */
const WRAP_GAP = 0.002;
/** 다른 고정점까지 이 비율 이상 여유가 있어야 묶임 (딱 맞으면 물리가 떨림) */
const REACH_SLACK = 1.02;

export interface Strap {
  key: string;
  post: Post;
  y: number;
  ties: { cable: Cable; tie: Tie }[];
}

export function strapKey(post: Post, y: number): string {
  return `${post}:${y.toFixed(3)}`;
}

function tieKey(t: Tie): string {
  return strapKey(t.pos[0] < 0 ? -1 : 1, t.pos[1]);
}

/** 꽂힌 끝 마디와 묶인 마디 (고정 위치) */
function anchors(cable: Cable): { node: number; pos: Vec3 }[] {
  const out: { node: number; pos: Vec3 }[] = cable.ties.map((t) => ({ node: t.node, pos: t.pos }));
  cable.ends.forEach((port, end) => {
    if (port) out.push({ node: endNode(cable, end as 0 | 1), pos: port.pos });
  });
  return out;
}

/** 띠 자리(post, y)에 걸쳐 있는 마디 중 가장 가까운 것과 묶일 자리. 없으면 null */
export function captureNode(cable: Cable, post: Post, y: number): { node: number; at: Vec3 } | null {
  const { rope } = cable;
  const p = rope.pos;
  const cx = post * POST_X;
  let best = -1, bestD = Infinity;
  // 커넥터와 그 옆 마디는 꽂기가 쓰므로 안쪽만
  for (let i = 2; i <= rope.n - 3; i++) {
    if (rope.isPinned(i)) continue;
    const dy = Math.abs(p[i * 3 + 1] - y);
    const h = Math.hypot(p[i * 3] - cx, p[i * 3 + 2] - POST_Z);
    if (dy > STRAP_REACH_Y || h > STRAP_CAPTURE) continue;
    const d = Math.hypot(h, dy);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return null;
  // 기둥 겉면으로 당겨 붙임 — 기둥 중심에서 마디 쪽 수평 방향
  let dx = p[best * 3] - cx, dz = p[best * 3 + 2] - POST_Z;
  const h = Math.hypot(dx, dz);
  if (h < 1e-6) { dx = 0; dz = -1; } else { dx /= h; dz /= h; }
  const r = POST_HALF * Math.SQRT2 + rope.cfg.radius + WRAP_GAP;
  return { node: best, at: [cx + dx * r, y, POST_Z + dz * r] };
}

function canReach(cable: Cable, i: number, at: Vec3): boolean {
  const seg = cable.rope.cfg.segLen;
  return anchors(cable).every((a) =>
    Math.hypot(at[0] - a.pos[0], at[1] - a.pos[1], at[2] - a.pos[2]) * REACH_SLACK <= Math.abs(i - a.node) * seg);
}

/** 기둥 post의 높이 y에 띠를 감음. 걸쳐 있던 케이블을 묶고, 닿지 않아 못 묶은 케이블도 알려 줌 */
export function strap(cables: readonly Cable[], post: Post, y: number): { tied: Cable[]; taut: Cable[] } {
  const tied: Cable[] = [], taut: Cable[] = [];
  y = Math.min(STRAP_Y_MAX, Math.max(STRAP_Y_MIN, y));
  const key = strapKey(post, y);
  for (const cable of cables) {
    // 이미 이 띠에 묶인 선은 그대로 (옆 마디를 또 묶지 않게)
    if (cable.ties.some((t) => tieKey(t) === key)) continue;
    const hit = captureNode(cable, post, y);
    if (!hit) continue;
    if (!canReach(cable, hit.node, hit.at)) {
      taut.push(cable);
      continue;
    }
    const { node, at } = hit;
    cable.rope.pin(node, at[0], at[1], at[2]);
    cable.ties.push({ node, pos: at });
    events.emit('cable:tied', { cableId: cable.id, node });
    tied.push(cable);
  }
  return { tied, taut };
}

/** 감긴 띠 목록 (같은 기둥·높이의 묶음끼리) */
export function strapsOf(cables: readonly Cable[]): Strap[] {
  const map = new Map<string, Strap>();
  for (const cable of cables) {
    for (const tie of cable.ties) {
      const key = tieKey(tie);
      let s = map.get(key);
      if (!s) map.set(key, (s = { key, post: tie.pos[0] < 0 ? -1 : 1, y: tie.pos[1], ties: [] }));
      s.ties.push({ cable, tie });
    }
  }
  return [...map.values()];
}

/** 기둥 post의 높이 y 근처에 감긴 띠 */
export function strapNear(cables: readonly Cable[], post: Post, y: number): Strap | null {
  let best: Strap | null = null;
  for (const s of strapsOf(cables)) {
    if (s.post !== post || Math.abs(s.y - y) > STRAP_PICK_Y) continue;
    if (!best || Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
  }
  return best;
}

export function unstrap(s: Strap): void {
  for (const { cable, tie } of s.ties) untie(cable, tie);
}

export function untie(cable: Cable, t: Tie): void {
  const k = cable.ties.indexOf(t);
  if (k < 0) return;
  cable.ties.splice(k, 1);
  cable.rope.unpin(t.node);
  events.emit('cable:untied', { cableId: cable.id, node: t.node });
}

export function tieAt(cable: Cable, node: number): Tie | undefined {
  return cable.ties.find((t) => t.node === node);
}

/** 불러오기: 저장된 자리 그대로 묶음 (닿는 거리 검사 없이 — 저장된 모양이 이미 맞음) */
export function restoreTie(cable: Cable, t: Tie): boolean {
  const { rope } = cable;
  if (t.node < 2 || t.node > rope.n - 3 || rope.isPinned(t.node)) return false;
  rope.pin(t.node, t.pos[0], t.pos[1], t.pos[2]);
  cable.ties.push({ node: t.node, pos: [t.pos[0], t.pos[1], t.pos[2]] });
  return true;
}
