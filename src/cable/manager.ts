// 케이블 매니저 (GDD 5장): 랙 칸에 끼우는 1U 부품. 뒷면에 고리가 가로로 늘어서 있다.
// Three.js에 의존하지 않는다 (헤드리스 테스트용). 여기는 고리 자리만 정한다 — 고리 메시는 rack/device.ts.
// 세로 매니저 (10-26): U를 안 쓰고 랙 옆 기둥 바깥에 세로로 고리가 늘어선 부품 — 레퍼런스 사진의 옆 덕트.
// 랙 폭 밖이라 남는 길이를 세로로 흘려 둘 자리가 된다.

import { RACK, U, uBottomY } from '../data/units';
import type { Vec3 } from './collide';

/** 장비 뒷면 z (device.ts BACK_Z와 같은 값) */
export const BACK_Z = -(RACK.depth - 0.16) / 2 - 0.002;
/** 고리 중심이 뒷면에서 떨어진 거리 */
export const RING_OUT = 0.05;
export const RING_R = 0.018;
/**
 * 세로 매니저 고리 중심: 기둥 바깥, PDU(x 0.315~0.365) 밖. z는 레일 뒤·기둥 앞 틈(−0.45 ~ −0.47) 줄 —
 * 포트에서 옆으로 나온 선이 그 틈으로 곧게 들어옴. 랙 폭(±0.3) 밖
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
