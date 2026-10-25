// 월드 단위는 미터. 원점은 랙 바닥 중앙, +Z가 앞면(카메라 기본 방향), +Y가 위.

export const U = 0.04445;
export const RACK_UNITS = 42;

export const RACK = {
  width: 0.6,
  depth: 1.0,
  /** 장비가 들어가는 19인치 레일 안쪽 폭 */
  railWidth: 0.4826,
  /** 바닥에서 첫 U까지 (받침대 높이) */
  baseHeight: 0.1,
  frame: 0.03,
} as const;

export const RACK_HEIGHT = RACK.baseHeight + RACK_UNITS * U + 0.08;

export const CABLE_DEFAULT_LENGTH = 2.0;

/** U 번호(1부터, 아래에서 위로)의 아랫면 Y 좌표 */
export function uBottomY(u: number): number {
  return RACK.baseHeight + (u - 1) * U;
}
