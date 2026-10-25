// 게임 상태 (저장 대상의 뿌리). Three.js에 의존하지 않는다.
// 장비·배선 상태는 Room(장비 엔티티)·power.ts(가동 판정)가 들고, 여기엔 돈과 구매 기록만.

import type { DeviceDefId } from '../data/catalog';

export interface GameState {
  money: number;
  /** 마지막으로 수익을 더한 시각 (Date.now ms). 저장하지 않음 — 불러온 시점부터 다시 쌓음 */
  lastTick: number;
  /** 장비별 구매 횟수 → 다음 가격. 시작 지급 장비는 세지 않는다 */
  bought: Partial<Record<DeviceDefId, number>>;
}

export function createGameState(now: number, money = 0): GameState {
  return { money, lastTick: now, bought: {} };
}

export function boughtCount(state: GameState, id: DeviceDefId): number {
  return state.bought[id] ?? 0;
}
