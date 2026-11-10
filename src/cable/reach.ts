// 케이블이 닿는 거리: 늘어나지 않는 케이블이라 꽂힌 끝에서 그 마디까지의 직선거리가 사이 케이블 길이를 넘을 수 없다.
// Three.js에 의존하지 않는다 (헤드리스 테스트용).

import { endNode, type Cable } from './cable';
import type { Vec3 } from './collide';

/** 고정점까지 이 비율 이상 여유가 있어야 닿음 (딱 맞으면 물리가 떨림) */
export const REACH_SLACK = 1.02;

/** 마디 i를 at에 둘 수 있나: 꽂힌 끝까지 직선거리 × 1.02 ≤ 마디 차 × 마디 길이 */
export function canReach(cable: Cable, i: number, at: Vec3): boolean {
  const seg = cable.rope.cfg.segLen;
  return cable.ends.every((port, end) => {
    if (!port) return true;
    const a = port.pos;
    return Math.hypot(at[0] - a[0], at[1] - a[1], at[2] - a[2]) * REACH_SLACK <= Math.abs(i - endNode(cable, end as 0 | 1)) * seg;
  });
}
