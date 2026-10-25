import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type * as THREE from 'three';
import type { Cable, CableWorld } from '../cable/cable';
import { refreshPlugs } from '../cable/plug';
import { CableResize, type ResizeStatus } from '../cable/shorten';
import { pickCable } from './pick';

// 줄이기 도구 (GDD 6.4): 케이블을 누른 채 위로 끌면 줄고 아래로 끌면 늘어난다 (최대 처음 길이).
// 길이 변화는 물리 스텝마다 update(dt)에서 — 손보다 천천히 따라가고, 팽팽해지면 거기서 멈춘다.
// 팽팽해서 멈추면 끌기 기준점을 그 자리로 옮겨, 다시 아래로 끌자마자 늘어나게 한다.

/** 화면 1px당 길이 (m) — 400px 끌면 2m */
const M_PER_PX = 0.005;
const KIND_NAME = { lan: '랜선', power: '전원선' } as const;

export interface ShortenToolDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  controls: OrbitControls;
  world: CableWorld;
  /** 줄이기 도구가 골라져 있는지 */
  active(): boolean;
  /** 안내 줄 (null = 끔) */
  show(text: string | null): void;
}

interface Session {
  cable: Cable;
  job: CableResize;
  pointerId: number;
  start: number;
  baseLen: number;
  baseY: number;
  target: number;
  status: ResizeStatus;
}

export interface ShortenTool {
  /** 물리 스텝 직전에 */
  update(dt: number): void;
}

export function createShortenTool({ canvas, camera, controls, world, active, show }: ShortenToolDeps): ShortenTool {
  let s: Session | null = null;
  let lastY = 0;

  const label = () => {
    if (!s) return;
    const { rope } = s.cable;
    show(
      `${KIND_NAME[s.cable.kind]} ${rope.length.toFixed(2)}m / ${rope.maxLength.toFixed(1)}m · 위로 끌면 줄이기, 아래로 끌면 늘리기` +
        (s.status === 'taut' ? ' · 팽팽해요' : ''),
    );
  };

  const finish = (cancel: boolean) => {
    if (!s) return;
    if (cancel) {
      s.cable.rope.setLength(s.start);
      refreshPlugs(s.cable);
    }
    s.job.end();
    if (canvas.hasPointerCapture(s.pointerId)) canvas.releasePointerCapture(s.pointerId);
    s = null;
    controls.enabled = true;
    canvas.style.cursor = '';
    show(null);
  };

  // 케이블 드래그(drag.ts)와 같은 window 캡처 단계 — 도구가 줄이기일 때만 받는다
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0 || s || !active()) return;
      const pick = pickCable(world.cables, camera, e.clientX, e.clientY, canvas.getBoundingClientRect());
      if (!pick) return;
      controls.enabled = false;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 합성 이벤트 등 활성 포인터가 아니면 캡처 없이 진행
      }
      const { rope } = pick.cable;
      s = {
        cable: pick.cable, job: new CableResize(rope), pointerId: e.pointerId,
        start: rope.length, baseLen: rope.length, baseY: e.clientY, target: rope.length, status: 'done',
      };
      lastY = e.clientY;
      canvas.style.cursor = 'ns-resize';
      label();
    },
    { capture: true },
  );

  canvas.addEventListener('pointermove', (e) => {
    lastY = e.clientY;
    if (s) s.target = s.baseLen + (e.clientY - s.baseY) * M_PER_PX;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (s && e.pointerId === s.pointerId) finish(false);
  });
  canvas.addEventListener('pointercancel', () => finish(false));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') finish(true);
  });

  return {
    update(dt) {
      if (!s) return;
      const prev = s.cable.rope.length;
      s.status = s.job.step(s.target, dt);
      if (s.status === 'taut' && s.target < s.cable.rope.length) {
        s.baseLen = s.target = s.cable.rope.length;
        s.baseY = lastY;
      }
      if (s.cable.rope.length !== prev) refreshPlugs(s.cable);
      if (s.cable.rope.length !== prev || s.status === 'taut') label();
    },
  };
}
