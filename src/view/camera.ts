import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { events, type ViewMode } from '../core/events';
import { RACK_HEIGHT } from '../data/units';

// 자유 회전은 항상 가능. 앞면/뒷면 버튼은 작업 시점으로 부드럽게 이동만 한다.
// 사용자가 직접 돌리기 시작하면 모드는 'free'로 돌아간다.

// 랙 중앙보다 조금 아래를 봐서 아래쪽 U가 하단 툴바에 가리지 않게 한다
const TARGET = new THREE.Vector3(0, RACK_HEIGHT * 0.42, 0);
const SNAP_DIST = 3.3;
const TWEEN_SEC = 0.6;

const PRESETS: Record<ViewMode, THREE.Vector3> = {
  front: new THREE.Vector3(0, RACK_HEIGHT * 0.42, SNAP_DIST),
  back: new THREE.Vector3(0, RACK_HEIGHT * 0.42, -SNAP_DIST),
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
