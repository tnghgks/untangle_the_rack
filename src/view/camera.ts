import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { events, type ViewMode } from '../core/events';
import { RACK_HEIGHT } from '../data/units';
import type { Vec3 } from '../cable/collide';

// 자유 회전은 항상 가능. 앞면/뒷면 버튼은 작업 시점으로 부드럽게 이동만 한다.
// 사용자가 직접 돌리기 시작하면 모드는 'free'로 돌아간다.

// 시점은 고른 랙(focus) 기준: 그 랙 원점 + 작업 높이를 보고, 앞면/뒷면은 그 랙 앞뒤 통로(aisle) 거리에 선다.

// 장비는 U1부터 위로 쌓이므로 랙 아래쪽 1/3 높이를 봐서 아래 U가 하단 툴바에 붙지 않게 한다
const WORK_Y = RACK_HEIGHT * 0.3;
const TWEEN_SEC = 0.6;
/** 자유 시점 처음 자리 (랙 원점 기준) */
const FREE_OFFSET = new THREE.Vector3(2.3, RACK_HEIGHT * 0.85, 2.8);

export interface Aisle {
  front: number;
  back: number;
}

export interface CameraRig {
  controls: OrbitControls;
  update(dtSec: number): void;
  /** 랙 자리 고르기: 지금 시점을 기억하고 center 위에서 내려다봄 */
  overview(center: Vec3): void;
  /** 기억한 시점으로 돌아감 (그새 focus가 불렸으면 그 랙 기준 자리로) */
  leaveOverview(): void;
  /** 이 랙을 봄: target을 origin + 작업 높이로, 카메라는 target과의 차이를 유지한 채 이동. 앞면/뒷면 프리셋도 이 랙 기준 */
  focus(origin: Vec3, aisle: Aisle): void;
}

export function createCameraRig(camera: THREE.PerspectiveCamera, dom: HTMLElement): CameraRig {
  /** 고른 랙 원점과 앞뒤 통로 거리 */
  const origin = new THREE.Vector3();
  let aisle: Aisle = { front: 2.7, back: 2.7 };
  const workTarget = () => origin.clone().add(new THREE.Vector3(0, WORK_Y, 0));
  const preset = (m: ViewMode) =>
    m === 'free'
      ? origin.clone().add(FREE_OFFSET)
      : origin.clone().add(new THREE.Vector3(0, WORK_Y, m === 'front' ? aisle.front : -aisle.back));

  camera.position.copy(preset('free'));
  const controls = new OrbitControls(camera, dom);
  controls.target.copy(workTarget());
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.4;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.495; // 바닥 아래로 못 내려감
  controls.screenSpacePanning = true;
  // 회전은 가운데 버튼, 팬은 오른쪽 버튼 또는 Shift+왼쪽. 왼쪽 드래그 회전은 없음 (10-25 플레이 피드백)
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  // OrbitControls는 "ROTATE 버튼 + Shift"를 팬으로 바꿔 주므로, Shift를 누른 왼쪽만 ROTATE로 넘긴다.
  // 장비 들기·케이블 잡기 캡처 리스너보다 먼저 등록돼 버튼 표만 바꾸고 이벤트는 그대로 흘려보냄
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target === dom && e.button === 0) controls.mouseButtons.LEFT = e.shiftKey ? THREE.MOUSE.ROTATE : null;
    },
    { capture: true },
  );
  // 가운데 버튼 자동 스크롤(Windows 브라우저) 막기
  dom.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault();
  });
  controls.update();

  let tween: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  /** 내려다보기 직전의 시점 (끝나면 비움) */
  let remembered: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  let mode: ViewMode = 'free';

  const setMode = (next: ViewMode) => {
    if (mode === next) return;
    mode = next;
    events.emit('view:changed', mode);
  };

  events.on('view:set', (next) => {
    tween = {
      fromPos: camera.position.clone(),
      toPos: preset(next),
      toTarget: workTarget(),
      fromTarget: controls.target.clone(),
      t: 0,
    };
    setMode(next);
  });

  controls.addEventListener('start', () => {
    tween = null;
    setMode('free');
  });

  const startTween = (toPos: THREE.Vector3, toTarget: THREE.Vector3) => {
    tween = { fromPos: camera.position.clone(), toPos, fromTarget: controls.target.clone(), toTarget, t: 0 };
  };

  return {
    controls,
    overview(center) {
      // 이미 내려다보는 중이면 처음 기억을 그대로 둠
      remembered ??= { pos: camera.position.clone(), target: controls.target.clone() };
      const c = new THREE.Vector3(...center);
      startTween(c.clone().add(new THREE.Vector3(0, 9, 6)), c);
    },
    leaveOverview() {
      if (!remembered) return;
      // 그새 focus가 불렸으면 remembered가 이미 그 랙 기준 자리로 바뀌어 있음
      startTween(remembered.pos, remembered.target);
      remembered = null;
    },
    focus(o, next) {
      origin.set(o[0], o[1], o[2]);
      aisle = { ...next };
      const to = workTarget();
      // 앞면/뒷면 시점이면 새 랙의 같은 프리셋으로, 자유 시점이면 target과의 차이를 그대로
      const place = (pos: THREE.Vector3, target: THREE.Vector3) =>
        mode === 'free' ? to.clone().add(pos.clone().sub(target)) : preset(mode);
      if (remembered) {
        // 내려다보는 중: 돌아갈 자리만 이 랙 기준으로 바꿔 둠 (leaveOverview가 거기로)
        remembered = { pos: place(remembered.pos, remembered.target), target: to };
        return;
      }
      // 이동 중이면 그 이동이 끝날 자리 기준 (예: leaveOverview 직후 새 랙 고르기)
      startTween(tween ? place(tween.toPos, tween.toTarget) : place(camera.position, controls.target), to);
    },
    update(dtSec) {
      if (tween) {
        tween.t = Math.min(1, tween.t + dtSec / TWEEN_SEC);
        const k = easeInOut(tween.t);
        camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
        if (tween.t >= 1) tween = null;
      }
      controls.update();
    },
  };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
