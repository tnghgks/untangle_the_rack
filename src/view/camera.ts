import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { events, type ViewMode } from '../core/events';
import { RACK_HEIGHT } from '../data/units';

// 자유 회전은 항상 가능. 앞면/뒷면 버튼은 작업 시점으로 부드럽게 이동만 한다.
// 사용자가 직접 돌리기 시작하면 모드는 'free'로 돌아간다.

// 장비는 U1부터 위로 쌓이므로 랙 아래쪽 1/3 높이를 봐서 아래 U가 하단 툴바에 붙지 않게 한다
const WORK_Y = RACK_HEIGHT * 0.3;
const TARGET = new THREE.Vector3(0, WORK_Y, 0);
const SNAP_DIST = 2.7;
const TWEEN_SEC = 0.6;

const PRESETS: Record<ViewMode, THREE.Vector3> = {
  front: new THREE.Vector3(0, WORK_Y, SNAP_DIST),
  back: new THREE.Vector3(0, WORK_Y, -SNAP_DIST),
  free: new THREE.Vector3(2.3, RACK_HEIGHT * 0.85, 2.8),
};

export interface CameraRig {
  controls: OrbitControls;
  update(dtSec: number): void;
}

export function createCameraRig(camera: THREE.PerspectiveCamera, dom: HTMLElement): CameraRig {
  camera.position.copy(PRESETS.free);
  const controls = new OrbitControls(camera, dom);
  controls.target.copy(TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.4;
  controls.maxDistance = 7;
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

  let tween: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; t: number } | null = null;
  let mode: ViewMode = 'free';

  const setMode = (next: ViewMode) => {
    if (mode === next) return;
    mode = next;
    events.emit('view:changed', mode);
  };

  events.on('view:set', (next) => {
    tween = {
      fromPos: camera.position.clone(),
      toPos: PRESETS[next].clone(),
      fromTarget: controls.target.clone(),
      t: 0,
    };
    setMode(next);
  });

  controls.addEventListener('start', () => {
    tween = null;
    setMode('free');
  });

  return {
    controls,
    update(dtSec) {
      if (tween) {
        tween.t = Math.min(1, tween.t + dtSec / TWEEN_SEC);
        const k = easeInOut(tween.t);
        camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
        controls.target.lerpVectors(tween.fromTarget, TARGET, k);
        if (tween.t >= 1) tween = null;
      }
      controls.update();
    },
  };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
