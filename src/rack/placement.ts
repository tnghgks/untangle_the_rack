import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { events } from '../core/events';
import { DEVICES, type DeviceDefId } from '../data/catalog';
import { RACK, RACK_HEIGHT, U } from '../data/units';
import type { Room } from '../view/room';
import { DEVICE_DEPTH, DEVICE_WIDTH, deviceCenterY, deviceHeight } from './device';
import { uFromCenterY } from './rack';

// 손에 든 장비: 커서가 가리키는 랙 면(카메라 쪽 앞/뒷면) 높이에 반투명 미리보기를 띄우고
// 좌클릭으로 끼운다. 들고 있는 동안 좌클릭은 카메라·케이블로 가지 않는다 (우클릭 팬·휠 줌은 그대로).

const OK_COLOR = 0x3cff7a;
const BAD_COLOR = 0xff4a3c;
/** 랙 면에서 이만큼 벗어나면 미리보기를 숨김 */
const REACH_X = RACK.width;

export interface PlacementDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  room: Room;
  /** 빈 칸을 클릭함 → 돈을 내고 끼움 */
  install(defId: DeviceDefId, u: number): void;
}

export interface Placement {
  readonly held: DeviceDefId | null;
  hold(defId: DeviceDefId): void;
  cancel(): void;
}

export function createPlacement({ canvas, camera, controls, room, install }: PlacementDeps): Placement {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const mat = new THREE.MeshBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.35, depthWrite: false });
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  ghost.visible = false;
  ghost.renderOrder = 10;
  room.rack.add(ghost);

  let held: DeviceDefId | null = null;
  let target: { u: number; ok: boolean } | null = null;
  let lastX = 0;
  let lastY = 0;

  const update = () => {
    target = null;
    ghost.visible = false;
    if (!held) return;
    const def = DEVICES[held];
    const rect = canvas.getBoundingClientRect();
    ndc.set(((lastX - rect.left) / rect.width) * 2 - 1, -((lastY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // 카메라가 있는 쪽 장비 면
    const faceZ = camera.position.z >= 0 ? DEVICE_DEPTH / 2 : -DEVICE_DEPTH / 2;
    plane.set(new THREE.Vector3(0, 0, 1), -faceZ);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    if (Math.abs(hit.x) > REACH_X || hit.y < 0 || hit.y > RACK_HEIGHT + 0.2) return;
    const u = uFromCenterY(hit.y, def.sizeU, RACK.baseHeight, U, room.slots.units);
    const ok = room.slots.canPlace(u, def.sizeU);
    target = { u, ok };
    ghost.scale.set(DEVICE_WIDTH + 0.004, deviceHeight(def.sizeU) + 0.004, DEVICE_DEPTH + 0.004);
    ghost.position.set(0, deviceCenterY(u, def.sizeU), 0);
    mat.color.setHex(ok ? OK_COLOR : BAD_COLOR);
    ghost.visible = true;
  };

  const setHeld = (next: DeviceDefId | null) => {
    held = next;
    canvas.style.cursor = next ? 'copy' : '';
    update();
    events.emit('placement:held', next);
  };

  // 케이블 드래그·OrbitControls보다 먼저 받아야 하므로 window 캡처 단계에서, 그보다 먼저 등록
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!held || e.target !== canvas || e.button !== 0) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      lastX = e.clientX;
      lastY = e.clientY;
      update();
      if (!target?.ok) return;
      // 빈손 먼저 → 설치 이벤트가 마지막에 와서 설치 안내가 남는다
      const defId = held;
      const { u } = target;
      setHeld(null);
      install(defId, u);
      controls.enabled = true;
    },
    { capture: true },
  );

  canvas.addEventListener('pointermove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (held) update();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && held) setHeld(null);
  });

  return {
    get held() {
      return held;
    },
    hold(defId) {
      setHeld(defId);
    },
    cancel() {
      if (held) setHeld(null);
    },
  };
}
