// 공기 흐름과 스로틀링 (GDD 5장). Three.js에 의존하지 않는다 (헤드리스 테스트용).
// 배기 통로 상자(device.ts EXHAUST_ZONE) 안을 지나는 케이블 길이로 공기 흐름을 매기고, 막힌 만큼 수익을 깎는다.
// 이번 단계는 공기 흐름만 — 장비 발열·냉각 모듈은 상점 확장 때. 배율은 연속 0% ~ −50% (10-25 결정)
//
// 배기구 바로 앞(뒷면에서 EXHAUST_GAP 안쪽)은 세지 않는다: 뒷면에 붙어 지나가는 선(꽂힌 끝 근처·벨크로로 묶은 선)까지
// 세면 정리할수록 점수가 떨어진다. 남는 길이가 늘어진 선만 통로로 삐져나온다.

import type { Cable } from '../cable/cable';
import type { Aabb } from '../cable/collide';

/** 이만큼(m) 막히면 공기 흐름 0% */
export const FULL_BLOCK = 4;
/** 공기 흐름 0%일 때 수익 감소 비율 */
export const MAX_THROTTLE = 0.5;

/** 마디 사이 토막 중 가운데 점이 상자 안인 토막 길이의 합 (토막이 짧아 이 정도면 충분) */
export function lengthInBox(pos: ArrayLike<number>, n: number, box: Aabb): number {
  const { min, max } = box;
  let L = 0;
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * 3, b = i * 3;
    const mx = (pos[a] + pos[b]) / 2, my = (pos[a + 1] + pos[b + 1]) / 2, mz = (pos[a + 2] + pos[b + 2]) / 2;
    if (mx < min[0] || mx > max[0] || my < min[1] || my > max[1] || mz < min[2] || mz > max[2]) continue;
    L += Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
  }
  return L;
}

/** 통로를 막은 길이. 한쪽도 안 꽂힌 케이블(산 직후 바닥에 놓인 선)은 세지 않는다 */
export function blockedLength(cables: readonly Cable[], zone: Aabb): number {
  let L = 0;
  for (const c of cables) if (c.ends[0] || c.ends[1]) L += lengthInBox(c.rope.pos, c.rope.n, zone);
  return L;
}

/** 공기 흐름 0~1 */
export function airflowOf(blocked: number): number {
  return Math.min(1, Math.max(0, 1 - blocked / FULL_BLOCK));
}

/** 수익 배율 1 ~ 1 − MAX_THROTTLE */
export function incomeFactor(airflow: number): number {
  return 1 - MAX_THROTTLE * (1 - airflow);
}
