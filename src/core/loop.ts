// 60Hz 고정 스텝 시뮬 + 렌더 분리.
// 숨긴 탭에서 돌아오면 물리는 최대 MAX_CATCHUP 스텝만 따라잡고 나머지 시간은 버린다.
// (수익은 프레임과 무관하게 Date.now 차이로 따로 계산 — economy.ts)

export const STEP_SEC = 1 / 60;
export const MAX_CATCHUP = 4;

export interface Stepper {
  /** 경과 시간(초)을 넣으면 이번 프레임에 돌릴 스텝 수를 돌려준다. */
  advance(dtSec: number): number;
  /** 다음 스텝까지 남은 비율 0..1 (렌더 보간용). */
  readonly alpha: number;
}

export function createStepper(step = STEP_SEC, maxSteps = MAX_CATCHUP): Stepper {
  let acc = 0;
  return {
    advance(dtSec) {
      acc += Math.max(0, dtSec);
      // 부동소수 오차로 경계에서 스텝이 하나 빠지지 않도록 작은 여유를 둔다
      let steps = Math.floor(acc / step + 1e-9);
      if (steps > maxSteps) {
        steps = maxSteps;
        acc = 0;
      } else {
        acc -= steps * step;
      }
      return steps;
    },
    get alpha() {
      return acc / step;
    },
  };
}

export interface LoopHandlers {
  update(dtSec: number): void;
  render(alpha: number): void;
}

export function startLoop({ update, render }: LoopHandlers): () => void {
  const stepper = createStepper();
  let last = performance.now();
  let raf = 0;

  const frame = (now: number) => {
    const steps = stepper.advance((now - last) / 1000);
    last = now;
    for (let i = 0; i < steps; i++) update(STEP_SEC);
    render(stepper.alpha);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => cancelAnimationFrame(raf);
}
