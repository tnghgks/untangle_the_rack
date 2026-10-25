// 가격 성장. Three.js에 의존하지 않는다 (헤드리스 테스트용).
// M3에서 수익 계산(Date.now 차이)·구매 차감을 여기에 붙인다.

import { PRICE_GROWTH, type DeviceDef } from '../data/catalog';

/** bought번 산 뒤의 다음 가격 (원 단위 반올림). 시작 지급 장비는 bought에 세지 않는다 */
export function priceOf(def: DeviceDef, bought: number): number {
  return Math.round(def.price * PRICE_GROWTH ** bought);
}

/** 회수 시간(초): 가격 ÷ 초당 수익. 수익 없는 장비는 Infinity */
export function paybackSec(def: DeviceDef, bought = 0): number {
  return def.incomePerSec > 0 ? priceOf(def, bought) / def.incomePerSec : Infinity;
}
