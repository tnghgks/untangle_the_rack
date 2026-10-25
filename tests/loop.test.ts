import { describe, expect, it } from 'vitest';
import { createStepper, MAX_CATCHUP, STEP_SEC } from '../src/core/loop';

describe('createStepper', () => {
  it('60Hz 스텝 단위로 나누고 나머지는 다음 프레임으로 넘긴다', () => {
    const s = createStepper();
    expect(s.advance(STEP_SEC * 2.5)).toBe(2);
    expect(s.alpha).toBeCloseTo(0.5);
    expect(s.advance(STEP_SEC * 0.5)).toBe(1);
  });

  it('숨긴 탭에서 돌아오면 최대 MAX_CATCHUP 스텝만 따라잡고 나머지를 버린다', () => {
    const s = createStepper();
    expect(s.advance(10)).toBe(MAX_CATCHUP);
    expect(s.alpha).toBe(0);
  });

  it('음수 dt는 무시한다', () => {
    const s = createStepper();
    expect(s.advance(-1)).toBe(0);
  });
});
