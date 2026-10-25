// 줄이기 도구의 길이 변화 (GDD 6.4). Three.js에 의존하지 않는다 (헤드리스 테스트용).
// 목표 길이 쪽으로 스텝마다 RESIZE_SPEED만큼 다가간다. 늘리기는 처음 지급 길이(maxLength)까지.
// 무료, 뽑아도 길이 유지 (10-25 결정).
//
// 하한 = 당긴 상태의 경로 길이. 경로가 늘어난 양(경로 − 쉬는 길이)으로는 판정이 안 된다 —
// 매달린 케이블은 중력으로, 상자에 걸친 케이블은 충돌과 길이 제약의 밀고 당김으로 늘 몇~십몇 cm 늘어나 있다.
// 대신 쉬는 길이를 WINDOW만큼 줄였는데 경로가 그 PATH_FOLLOW 비율도 안 줄면 팽팽한 것으로 본다.
// 팽팽하면 쉬는 길이를 그때 경로 길이로 되돌려 케이블이 계속 당기며 떨지 않게 한다.

import type { Rope } from './rope';

export const MIN_CABLE_LENGTH = 0.2;
/** 초당 길이 변화 (m) */
export const RESIZE_SPEED = 0.6;
const WINDOW = 0.03;
const PATH_FOLLOW = 0.4;
/** 감는 동안 제약 반복 횟수 (한 가닥뿐이라 비용이 작다) */
const RESIZE_ITERATIONS = 24;

export type ResizeStatus = 'moving' | 'done' | 'taut';

/** 줄이기 한 번(누르고 있는 동안). 감는 동안은 마찰을 끄고 반복을 늘린다 → end()로 되돌림 */
export class CableResize {
  private readonly iterations: number;
  private refRest = 0;
  private refPath = 0;
  /** 팽팽해진 길이. 목표가 이보다 길어질 때까지 더 줄이지 않음 */
  private tautAt = -Infinity;

  constructor(readonly rope: Rope) {
    this.iterations = rope.cfg.iterations;
    rope.slip = true;
    rope.cfg.iterations = RESIZE_ITERATIONS;
    this.mark();
  }

  private mark(): void {
    this.refRest = this.rope.length;
    this.refPath = this.rope.pathLength();
  }

  step(target: number, dt: number): ResizeStatus {
    const { rope } = this;
    const want = Math.max(MIN_CABLE_LENGTH, Math.min(rope.maxLength, target));
    const cur = rope.length;
    if (want < cur && want <= this.tautAt + 1e-6) return 'taut';
    const diff = want - cur;
    if (Math.abs(diff) < 1e-4) {
      this.mark();
      return 'done';
    }
    if (diff > 0) {
      this.tautAt = -Infinity;
      this.mark();
    } else if (this.refRest - cur >= WINDOW) {
      const path = rope.pathLength();
      if (this.refPath - path < (this.refRest - cur) * PATH_FOLLOW) {
        rope.setLength(path);
        this.tautAt = rope.length;
        this.mark();
        return 'taut';
      }
      this.mark();
    }
    const max = RESIZE_SPEED * dt;
    rope.setLength(cur + Math.max(-max, Math.min(max, diff)));
    return Math.abs(diff) <= max ? 'done' : 'moving';
  }

  end(): void {
    this.rope.slip = false;
    this.rope.cfg.iterations = this.iterations;
    this.rope.wake();
  }
}
