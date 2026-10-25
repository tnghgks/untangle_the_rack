import * as THREE from 'three';
import type { Aabb } from '../cable/collide';
import { RACK, RACK_HEIGHT, RACK_UNITS, U, uBottomY } from '../data/units';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rack: THREE.Group;
  resize(): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171c);
  scene.fog = new THREE.Fog(0x14171c, 8, 18);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 50);

  addLights(scene);
  scene.add(createFloor());

  const rack = createRack();
  scene.add(rack);

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, rack, resize };
}

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x20242a, 0.9));

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = key.shadow.camera;
  s.left = -2; s.right = 2; s.top = 3; s.bottom = -1; s.near = 0.5; s.far = 12;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x6fa8ff, 0.6);
  rim.position.set(-3, 2.5, -3);
  scene.add(rim);

  // 뒷면 배선 작업용 보조광 (그림자 없음)
  const back = new THREE.DirectionalLight(0xfff4e6, 0.9);
  back.position.set(1.5, 3, -3.5);
  scene.add(back);
}

function createFloor(): THREE.Group {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  const grid = new THREE.GridHelper(30, 50, 0x3a414c, 0x30363f);
  grid.position.y = 0.001;
  g.add(grid);
  return g;
}

const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, metalness: 0.6, roughness: 0.45 });
const railMat = new THREE.MeshStandardMaterial({ color: 0x8a919c, metalness: 0.8, roughness: 0.35 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.solid = true; // 케이블 충돌 상자
  return m;
}

/** 42U 오픈 프레임 랙: 기둥 4개, 위·아래 판, 앞뒤 19인치 레일. 옆판은 배선이 보이도록 생략. */
function createRack(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'rack';
  const { width: W, depth: D, frame: F, railWidth } = RACK;
  const H = RACK_HEIGHT;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(F, H, F, frameMat, sx * (W - F) / 2, H / 2, sz * (D - F) / 2));
    }
  }
  g.add(box(W, F, D, frameMat, 0, F / 2 + 0.02, 0));
  g.add(box(W, F, D, frameMat, 0, H - F / 2, 0));

  // 장비를 거는 레일 (앞뒤 각 2개)
  const railH = RACK_UNITS * U;
  const railY = uBottomY(1) + railH / 2;
  for (const sx of [-1, 1]) {
    for (const z of [D / 2 - 0.06, -D / 2 + 0.06]) {
      g.add(box(0.015, railH, 0.02, railMat, sx * (railWidth / 2 + 0.008), railY, z));
    }
  }
  return g;
}

/** 장비 몸체 깊이 (앞뒤 레일 사이). 뒷면 z = -DEVICE_DEPTH / 2 */
export const DEVICE_DEPTH = RACK.depth - 0.16;

/** M2 카탈로그 전까지 쓰는 자리표시 장비: 상자 + 앞면 LED */
export function createPlaceholderDevice(name: string, u: number, sizeU: number, color: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const h = sizeU * U - 0.002;
  const d = DEVICE_DEPTH;
  const body = box(RACK.railWidth - 0.01, h, d, new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.5 }), 0, 0, 0);
  g.add(body);

  // 앞면 LED (전원 켜짐 표시)
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.004, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x3cff7a }),
  );
  led.position.set(RACK.railWidth / 2 - 0.03, 0, d / 2 + 0.002);
  g.add(led);

  g.position.set(0, uBottomY(u) + h / 2 + 0.001, 0);
  return g;
}

/** userData.solid 메시들의 월드 경계 상자 → 케이블 충돌용 */
export function collectColliders(root: THREE.Object3D): Aabb[] {
  root.updateMatrixWorld(true);
  const out: Aabb[] = [];
  const b = new THREE.Box3();
  root.traverse((o) => {
    if (!o.userData.solid) return;
    b.setFromObject(o);
    out.push({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
  });
  return out;
}
