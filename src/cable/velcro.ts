// 벨크로 (GDD 5장, 10-25 결정): 케이블 한 점을 가까운 랙 뒷면 기둥에 묶는다. Three.js에 의존하지 않는다 (헤드리스 테스트용).
// 묶은 마디는 기둥 안쪽 면 옆에 고정(pin) → 남는 길이가 뒷면 바로 뒤에 매달려 배기 통로(thermal.ts)로 덜 삐져나온다.
// 무료·무제한. 묶은 곳을 다시 클릭하면 풀리고, 손으로 세게 당겨도 떨어진다 (drag.ts).
//
// 묶을 수 있는지: 묶을 자리에서 다른 고정점(꽂힌 끝·다른 벨크로)까지 거리가 그 사이 케이블 길이보다 멀면 못 묶는다
// (늘어나지 않는 케이블).

import { events } from '../core/events';
import { RACK, RACK_HEIGHT } from '../data/units';
import { endNode, type Cable } from './cable';
import type { Vec3 } from './collide';

export interface Tie {
  node: number;
  pos: Vec3;
}

/** 뒷면 기둥 중심 z (scene.ts createRack과 같은 자리) */
export const POST_Z = -(RACK.depth - RACK.frame) / 2;
/** 기둥 안쪽 면 |x| */
export const POST_INNER_X = RACK.width / 2 - RACK.frame;
/** 묶인 점이 기둥 안쪽 면에서 떨어진 거리 (케이블 반지름 + 여유) */
const TIE_GAP = 0.008;
/** 바닥·꼭대기 판과 겹치지 않게 */
const TIE_Y_MIN = 0.06;
const TIE_Y_MAX = RACK_HEIGHT - 0.05;
/** 이미 묶인 마디에서 이 마디 수 안을 클릭하면 풀기 */
export const TIE_PICK_NODES = 3;
/** 다른 고정점까지 이 비율 이상 여유가 있어야 묶임 (딱 맞으면 물리가 떨림) */
const REACH_SLACK = 1.02;
/** 묶을 높이를 고를 때 쓰는 닿는 거리 비율 — 남는 길이를 조금 남겨 팽팽하게 떨지 않게 */
const LIFT_REACH = 0.85;

export type TieResult = 'tied' | 'end' | 'taut';

/** 마디 i를 묶을 자리: 마디와 x 부호가 같은 쪽 기둥 안쪽 면에서, 케이블이 닿는 가장 높은 곳 (LIFT_REACH 여유).
 *  기둥을 따라 끌어올려 묶어야 남는 길이가 뒷면 바로 뒤에 매달린다 — 마디 높이 그대로 묶으면 바닥에 깔린 채 남음 (측정) */
export function tieSpot(cable: Cable, i: number): Vec3 {
  const p = cable.rope.pos;
  const x = (p[i * 3] < 0 ? -1 : 1) * (POST_INNER_X - TIE_GAP);
  const seg = cable.rope.cfg.segLen;
  const a = anchors(cable);
  if (a.length === 0) return [x, Math.min(TIE_Y_MAX, Math.max(TIE_Y_MIN, p[i * 3 + 1])), POST_Z];
  let y = TIE_Y_MAX;
  for (const { node, pos } of a) {
    const r = Math.abs(i - node) * seg * LIFT_REACH;
    const h = Math.hypot(x - pos[0], POST_Z - pos[2]);
    y = Math.min(y, h < r ? pos[1] + Math.sqrt(r * r - h * h) : pos[1]);
  }
  return [x, Math.max(TIE_Y_MIN, y), POST_Z];
}

/** 꽂힌 끝 마디와 벨크로 마디 (고정 위치, 마디 순) */
function anchors(cable: Cable): { node: number; pos: Vec3 }[] {
  const out: { node: number; pos: Vec3 }[] = cable.ties.map((t) => ({ node: t.node, pos: t.pos }));
  cable.ends.forEach((port, end) => {
    if (port) out.push({ node: endNode(cable, end as 0 | 1), pos: port.pos });
  });
  return out.sort((a, b) => a.node - b.node);
}

export function tieNear(cable: Cable, i: number): Tie | null {
  let best: Tie | null = null;
  for (const t of cable.ties) {
    if (Math.abs(t.node - i) <= TIE_PICK_NODES && (!best || Math.abs(t.node - i) < Math.abs(best.node - i))) best = t;
  }
  return best;
}

export function tie(cable: Cable, i: number, at: Vec3 = tieSpot(cable, i)): TieResult {
  const { rope } = cable;
  // 커넥터와 그 옆 마디는 꽂기가 쓰므로 안쪽만
  if (i < 2 || i > rope.n - 3 || rope.isPinned(i)) return 'end';
  const seg = rope.cfg.segLen;
  for (const a of anchors(cable)) {
    const d = Math.hypot(at[0] - a.pos[0], at[1] - a.pos[1], at[2] - a.pos[2]);
    if (d * REACH_SLACK > Math.abs(i - a.node) * seg) return 'taut';
  }
  rope.pin(i, at[0], at[1], at[2]);
  cable.ties.push({ node: i, pos: at });
  events.emit('cable:tied', { cableId: cable.id, node: i });
  return 'tied';
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
