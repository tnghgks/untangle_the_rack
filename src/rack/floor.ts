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
/** 늘어뜨림·처짐·둥근 꺾임 여유 (Task 4 보증 테스트가 실제 경로보다 큼을 확인) */
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
