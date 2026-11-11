// 바닥 칸: 랙을 놓을 수 있는 격자와 랙 위 트레이, 긴 LAN 케이블이 닿는 칸 판정.
// Three.js에 의존하지 않는다 (헤드리스 테스트용).

import { REACH_SLACK } from '../cable/route';
import type { Vec3 } from '../cable/collide';
import type { Guide } from '../cable/guide';
import { SIDE_RING_X, SIDE_RING_Z } from '../cable/manager';
import { LONG_LAN_LENGTH, RACK_HEIGHT, U, uBottomY } from '../data/units';

/** (x칸, z칸) */
export type Cell = readonly [number, number];

export const CELL_X = 1.0;
export const CELL_Z = 2.0;
export const FLOOR_MIN = -7;
export const FLOOR_MAX = 7;

export interface RackPlace {
  id: string;
  cell: Cell;
}

export function cellOrigin(cell: Cell): Vec3 {
  return [cell[0] * CELL_X, 0, cell[1] * CELL_Z];
}

/** 월드 좌표가 속한 칸 (반올림) */
export function cellAt(x: number, z: number): Cell {
  return [Math.round(x / CELL_X), Math.round(z / CELL_Z)];
}

export function inFloor(cell: Cell): boolean {
  return cell.every((c) => c >= FLOOR_MIN && c <= FLOOR_MAX);
}

export const TRAY_Y = RACK_HEIGHT + 0.06;
/** 세로 매니저에서 트레이로 z 이동 없이 곧장 오르게 */
export const TRAY_Z = SIDE_RING_Z;

export const trayId = (rackId: string) => `${rackId}:tray`;

/** 랙 위 트레이: 칸 폭만큼 x로 뻗어 옆 칸 트레이와 끝이 맞닿는다 */
export function trayGuide(r: RackPlace): Guide {
  const o = cellOrigin(r.cell);
  return {
    id: trayId(r.id),
    axis: 0,
    a: [o[0] - CELL_X / 2, TRAY_Y, o[2] + TRAY_Z],
    b: [o[0] + CELL_X / 2, TRAY_Y, o[2] + TRAY_Z],
    rack: r.id,
    origin: o,
    tray: true,
  };
}

export { LONG_LAN_LENGTH };

/** U1 포트 → 트레이 오름 */
const CLIMB = TRAY_Y - (uBottomY(1) + U / 2);
/** 24포트 스위치 맨 끝 포트(x −0.2) → 반대쪽 랙 옆 */
const SIDE_RUN = SIDE_RING_X + 0.2;
/**
 * 늘어뜨림·처짐·둥근 꺾임 여유. 어림값이라 모든 포트 쌍의 실제 경로보다 늘 크지는 않음 —
 * 매니저 없이 (0,±2) 칸에선 어떤 포트 쌍은 실제 9.673m > worstUplinkLength 9.569m.
 * 그 칸은 칸 판정(worst × REACH_SLACK = 9.76m ≤ 10)에 남는 여유 덕에 닿을 뿐 (9.673 × REACH_SLACK = 9.87m ≤ 10).
 * 먼 쪽 세로 매니저 때문에 넘치면 findRoute가 매니저를 빼고 다시 맞춤.
 * 보증 테스트(uplinkRoute.test.ts '초록 칸 가장자리')는 먼 끝 포트 쌍만 확인
 */
const SAG_ALLOW = 0.4;

/** 두 칸의 랙을 잇는 케이블의 최악 경로 길이 */
export function worstUplinkLength(a: Cell, b: Cell): number {
  return 2 * CLIMB + 2 * SIDE_RUN + SAG_ALLOW + Math.abs(a[0] - b[0]) * CELL_X + Math.abs(a[1] - b[1]) * CELL_Z;
}

/** 새 랙을 놓을 수 있는 칸: 바닥 안, 랙 없는 칸 중 어떤 랙에든 케이블이 닿는 칸 */
export function reachableCells(racks: readonly RackPlace[], cableLen = LONG_LAN_LENGTH): Cell[] {
  const out: Cell[] = [];
  for (let x = FLOOR_MIN; x <= FLOOR_MAX; x++) {
    for (let z = FLOOR_MIN; z <= FLOOR_MAX; z++) {
      const c: Cell = [x, z];
      if (racks.some((r) => r.cell[0] === x && r.cell[1] === z)) continue;
      if (racks.some((r) => worstUplinkLength(r.cell, c) * REACH_SLACK <= cableLen)) out.push(c);
    }
  }
  return out;
}

export function canPlaceRack(racks: readonly RackPlace[], cell: Cell): boolean {
  return reachableCells(racks).some((c) => c[0] === cell[0] && c[1] === cell[1]);
}

/** 작업 시점 거리 m: 앞뒤 칸이 비었으면 넉넉히, 그 칸에 랙이 있으면 두 랙 사이 통로 안 */
export const AISLE_OPEN = 2.7;
export const AISLE_NARROW = 1.3;

/** 그 칸 랙의 앞(z+1)·뒤(z−1) 통로에서 카메라를 둘 거리 (모든 랙은 +z를 봄) */
export function aisleAt(racks: readonly RackPlace[], cell: Cell): { front: number; back: number } {
  const taken = (z: number) => racks.some((r) => r.cell[0] === cell[0] && r.cell[1] === z);
  return { front: taken(cell[1] + 1) ? AISLE_NARROW : AISLE_OPEN, back: taken(cell[1] - 1) ? AISLE_NARROW : AISLE_OPEN };
}
