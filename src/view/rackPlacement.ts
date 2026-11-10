import * as THREE from 'three';
import { canPlaceRack, cellAt, cellOrigin, CELL_X, CELL_Z, reachableCells, type Cell } from '../rack/floor';
import { RACK_HEIGHT } from '../data/units';
import type { CameraRig } from './camera';
import type { Room } from './room';

// 랙 자리 고르기: 바닥에 초록 칸(케이블이 닿는 빈 칸)을 깔고, 커서 칸에 반투명 랙 상자를 보여준다.
// 왼쪽 클릭은 window 캡처 단계에서 먼저 받아 다른 입력(장비 들기·케이블)에 안 넘긴다. Esc·cancel()로 끝냄.

export interface RackPlacementDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  room: Room;
  rig: CameraRig;
  /** 초록 칸을 골랐을 때 (돈 내기·세우기). 끝내기는 이쪽에서 */
  place(cell: Cell): void;
}

export interface RackPlacement {
  readonly active: boolean;
  start(): void;
  cancel(): void;
}

const GREEN = 0x3cff7a;
const RED = 0xff4a4a;
const MARGIN = 0.06;

export function createRackPlacement({ canvas, camera, scene, room, rig, place }: RackPlacementDeps): RackPlacement {
  let active = false;
  let marks: THREE.Group | null = null;
  let ghost: THREE.Mesh | null = null;
  let allowed = new Set<string>();
  const key = (c: Cell) => `${c[0]},${c[1]}`;

  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const cellAtPointer = (e: PointerEvent | MouseEvent): Cell | null => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(floor, hit) ? cellAt(hit.x, hit.z) : null;
  };

  const showGhost = (cell: Cell | null) => {
    if (!ghost) return;
    ghost.visible = cell !== null;
    if (!cell) return;
    const o = cellOrigin(cell);
    ghost.position.set(o[0], o[1] + RACK_HEIGHT / 2, o[2]);
    (ghost.material as THREE.MeshBasicMaterial).color.setHex(allowed.has(key(cell)) ? GREEN : RED);
  };

  const onMove = (e: PointerEvent) => {
    if (e.target === canvas) showGhost(cellAtPointer(e));
  };
  // 캡처 리스너는 등록 순서대로 불리므로 다른 입력보다 먼저 받으려면 처음(만들 때)에 한 번만 걸고 active로 거른다
  const onDown = (e: PointerEvent) => {
    if (!active) return;
    if (e.target !== canvas || e.button !== 0 || e.shiftKey) return; // Shift+왼쪽은 카메라 회전
    e.preventDefault();
    e.stopImmediatePropagation();
    const cell = cellAtPointer(e);
    if (!cell || !canPlaceRack(room.racks, cell)) return;
    end();
    place(cell);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    end();
  };

  function end() {
    if (!active) return;
    active = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('keydown', onKey, { capture: true });
    for (const obj of [marks, ghost]) {
      if (!obj) continue;
      scene.remove(obj);
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    marks = ghost = null;
    rig.leaveOverview();
  }

  window.addEventListener('pointerdown', onDown, { capture: true });

  return {
    get active() {
      return active;
    },
    start() {
      if (active) return;
      active = true;
      const cells = reachableCells(room.racks);
      allowed = new Set(cells.map(key));
      marks = new THREE.Group();
      const tileGeo = new THREE.PlaneGeometry(CELL_X - MARGIN, CELL_Z - MARGIN).rotateX(-Math.PI / 2);
      const tileMat = new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.35, depthWrite: false });
      for (const c of cells) {
        const o = cellOrigin(c);
        const m = new THREE.Mesh(tileGeo, tileMat);
        m.position.set(o[0], 0.003, o[2]);
        marks.add(m);
      }
      scene.add(marks);
      ghost = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, RACK_HEIGHT, 1.0),
        new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.4, depthWrite: false }),
      );
      ghost.visible = false;
      scene.add(ghost);
      // 칸 한가운데를 중심으로 내려다봄
      const xs = [...room.racks.map((r) => r.cell[0]), ...cells.map((c) => c[0])];
      const zs = [...room.racks.map((r) => r.cell[1]), ...cells.map((c) => c[1])];
      const mid = cellOrigin([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]);
      rig.overview(mid);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('keydown', onKey, { capture: true });
    },
    cancel: end,
  };
}
