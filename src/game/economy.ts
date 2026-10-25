// 가격 성장·수익·구매 차감. Three.js에 의존하지 않는다 (헤드리스 테스트용).

import { PRICE_GROWTH, type DeviceDef } from '../data/catalog';
import type { GameState } from './state';

/** bought번 산 뒤의 다음 가격 (원 단위 반올림). 시작 지급 장비는 bought에 세지 않는다 */
export function priceOf(def: DeviceDef, bought: number): number {
  return Math.round(def.price * PRICE_GROWTH ** bought);
}

/** 회수 시간(초): 가격 ÷ 초당 수익. 수익 없는 장비는 Infinity */
export function paybackSec(def: DeviceDef, bought = 0): number {
  return def.incomePerSec > 0 ? priceOf(def, bought) / def.incomePerSec : Infinity;
}

/**
 * 실제 시간(Date.now) 기준으로 밀린 수익을 더한다 → 백그라운드 탭·프레임 끊김과 무관 (GDD 3.2).
 * setInterval(250)과 렌더 루프 양쪽에서 불러도 같은 시간을 두 번 세지 않는다
 */
export function tick(state: GameState, now: number, incomePerSec: number): void {
  const dt = now - state.lastTick;
  if (dt <= 0) return;
  state.money += (incomePerSec * dt) / 1000;
  state.lastTick = now;
}

/** 돈이 충분하면 빼고 true */
export function spend(state: GameState, price: number): boolean {
  if (state.money < price) return false;
  state.money -= price;
  return true;
}

/** 판매 환급 비율 (10-25 결정: 산 값의 50%) */
export const SELL_RATE = 0.5;

/**
 * 장비 판매: 마지막으로 산 가격의 SELL_RATE를 돌려주고 다음 가격을 한 단계 내림. 돌려준 돈을 돌려준다.
 * 산 기록이 없으면(시작 지급 장비만 남음) 0원
 */
export function sellDevice(state: GameState, def: DeviceDef): number {
  const n = state.bought[def.id] ?? 0;
  if (n <= 0) return 0;
  const refund = Math.round(priceOf(def, n - 1) * SELL_RATE);
  state.bought[def.id] = n - 1;
  state.money += refund;
  return refund;
}

/** 케이블 판매: 낸 값(paid)의 SELL_RATE. 시작 배선은 0원 */
export function sellCable(state: GameState, paid: number): number {
  const refund = paid * SELL_RATE;
  state.money += refund;
  return refund;
}
