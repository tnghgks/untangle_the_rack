import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Cable, CableEnd } from '../cable/cable';
import { events } from '../core/events';
import { DEVICES, type DeviceDefId } from '../data/catalog';
import { RACK, RACK_HEIGHT, U } from '../data/units';
import type { Room } from '../view/room';
import { DEVICE_DEPTH, DEVICE_WIDTH, deviceCenterY, deviceHeight } from './device';
import { uFromCenterY } from './rack';

// 손에 든 장비: 커서가 가리키는 랙 면(카메라 쪽 앞/뒷면) 높이에 반투명 미리보기를 띄우고
// 좌클릭으로 끼운다. 들고 있는 동안 좌클릭은 카메라·케이블로 가지 않는다 (우클릭 팬·휠 줌은 그대로).
// 랙에서 뺀 장비(moving)를 들고 있다가 끼우지 않고 놓으면(Esc·다른 장비 들기) 원래 자리로 돌아간다.

const OK_COLOR = 0x3cff7a;
const BAD_COLOR = 0xff4a3c;
/** 랙 면에서 이만큼 벗어나면 미리보기를 숨김 */
const REACH_X = RACK.width;

export interface PlacementDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  room: Room;
  /** 빈 칸을 클릭함 → 새 장비는 돈을 내고, 뺀 장비(moving)는 그냥 끼움 */
  install(defId: DeviceDefId, u: number, moving: MovingDevice | null): void;
  /** 뺀 장비를 끼우지 않고 놓음 → 원래 자리로 */
  putBack(defId: DeviceDefId, moving: MovingDevice): void;
}

/** 랙에서 빼서 손에 든 장비 (같은 id로 다시 끼움) */
export interface MovingDevice {
  id: string;
  u: number;
  on: boolean;
  /** 끌어 옮길 때: 뺄 때 꽂혀 있던 케이블 — 끼운 뒤 닿으면 같은 포트에 다시 꽂음 */
  plugs?: { cable: Cable; end: CableEnd; portId: string }[];
}

export interface Placement {
  readonly held: DeviceDefId | null;
  /** 들고 있는 게 랙에서 뺀 장비면 그 정보 */
  readonly moving: MovingDevice | null;
  /** drag: 버튼을 누른 채 끌어 뺀 것 — 떼는 곳에 끼움 (deviceDrag.ts) */
  hold(defId: DeviceDefId, moving?: MovingDevice, drag?: boolean): void;
  cancel(): void;
  /** 매 프레임: 휠 줌·시점 이동에도 미리보기가 커서를 따라가게 */
  refresh(): void;
}

export function createPlacement({ canvas, camera, controls, room, install, putBack }: PlacementDeps): Placement {
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
  let moving: MovingDevice | null = null;
  let target: { u: number; ok: boolean } | null = null;
  /** 버튼을 누른 채 끌고 있음 (떼면 끼움) */
  let dragging = false;
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

  const setHeld = (next: DeviceDefId | null, nextMoving: MovingDevice | null = null) => {
    dragging = false;
    const back = held && moving ? { defId: held, moving } : null;
    held = next;
    moving = nextMoving;
    canvas.style.cursor = next ? 'copy' : '';
    update();
    events.emit('placement:held', next);
    if (back) putBack(back.defId, back.moving);
  };

  /** 커서 자리에 끼움. 칸이 안 맞으면 false (끌기 모드는 그대로 놓아 원래 자리로) */
  const drop = (x: number, y: number): boolean => {
    lastX = x;
    lastY = y;
    update();
    if (!held || !target?.ok) return false;
    // 빈손 먼저 → 설치 이벤트가 마지막에 와서 설치 안내가 남는다
    const defId = held;
    const m = moving;
    const { u } = target;
    moving = null;
    setHeld(null);
    install(defId, u, m);
    controls.enabled = true;
    return true;
  };

  // 케이블 드래그·OrbitControls보다 먼저 받아야 하므로 window 캡처 단계에서, 그보다 먼저 등록
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!held || dragging || e.target !== canvas || e.button !== 0) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      drop(e.clientX, e.clientY);
    },
    { capture: true },
  );
  // 끌기 모드(장비 몸체를 끌어 뺌): 버튼을 떼는 곳에 끼우고, 칸이 안 맞으면 원래 자리로
  window.addEventListener('pointerup', (e) => {
    if (!held || !dragging || e.button !== 0) return;
    dragging = false;
    controls.enabled = true;
    if (!drop(e.clientX, e.clientY)) setHeld(null);
  });

  canvas.addEventListener('pointermove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (held) update();
  });
  // 케이블 드래그의 pointermove(캔버스)가 커서를 덮어쓴 뒤에 다시 잡는다
  window.addEventListener('pointermove', (e) => {
    if (held && e.target === canvas) canvas.style.cursor = 'copy';
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && held) setHeld(null);
  });

  return {
    get held() {
      return held;
    },
    get moving() {
      return moving;
    },
    hold(defId, m, drag = false) {
      setHeld(defId, m ?? null);
      dragging = drag;
    },
    cancel() {
      if (held) setHeld(null);
    },
    refresh() {
      if (held) update();
    },
  };
}
