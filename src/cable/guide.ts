// 가이드: 케이블 매니저 고리들이 만드는 선분. 선이 이 선분을 따라 지난다.
// Three.js에 의존하지 않는다 (헤드리스).

import type { Vec3 } from './collide';
import { BACK_Z, RING_OUT, SIDE_RING_X, SIDE_RING_Z, deviceRings } from './manager';

export interface Guide {
  /** 매니저 장비 id */
  id: string;
  /** 0 = x를 따라(가로), 1 = y를 따라(세로) */
  axis: 0 | 1;
  a: Vec3;
  b: Vec3;
  /** 이 가이드가 속한 랙 id */
  rack: string;
  /** 그 랙 원점 (월드) */
  origin: Vec3;
  /** 랙 위 트레이 (랙 사이 긴 선이 지남) */
  tray?: true;
}

/** 매니저 장비의 가이드 (매니저가 아니면 null) */
export function guideOf(d: { id: string; u: number | null; side: number | null; def: { rings?: readonly number[] }; rack?: string; origin?: Vec3 }): Guide | null {
  const rings = deviceRings(d);
  if (rings.length === 0) return null;
  const rack = d.rack ?? 'rack-1';
  const origin: Vec3 = d.origin ?? [0, 0, 0];
  if (d.u !== null) {
    const xs = rings.map((r) => r.pos[0]);
    const y = rings[0]!.pos[1];
    const z = BACK_Z - RING_OUT;
    return { id: d.id, axis: 0, a: [Math.min(...xs), y, z], b: [Math.max(...xs), y, z], rack, origin };
  }
  const x = d.side === 0 ? -SIDE_RING_X : SIDE_RING_X;
  const ys = rings.map((r) => r.pos[1]);
  return { id: d.id, axis: 1, a: [x, Math.min(...ys), SIDE_RING_Z], b: [x, Math.max(...ys), SIDE_RING_Z], rack, origin };
}
