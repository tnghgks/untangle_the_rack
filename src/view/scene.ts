import * as THREE from 'three';
import type { Aabb } from '../cable/collide';
import { THEME_COLOR } from '../data/catalog';
import type { RackTheme } from '../game/bonus';
import { RACK, RACK_HEIGHT, RACK_UNITS, U, uBottomY } from '../data/units';
import { CELL_X, TRAY_Y, TRAY_Z } from '../rack/floor';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
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

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, resize };
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

/** 42U 오픈 프레임 랙: 기둥 4개, 위·아래 판, 앞뒤 19인치 레일. 옆판은 배선이 보이도록 생략. 랙 원점 기준 */
export function createRackMesh(): THREE.Group {
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

/** 트레이 치수 m: 깊이(z), 바닥판 두께, 옆 벽 높이·두께 */
const TRAY = { depth: 0.12, plate: 0.004, wall: 0.03, wallT: 0.004 };

/**
 * 랙 위 트레이: 바닥판 + 양 옆(앞뒤 z) 낮은 벽. 랙 원점 기준 TRAY_Y·TRAY_Z, 폭 CELL_X (옆 칸 트레이와 맞닿음).
 * 메시마다 userData.deviceId = trayId — 가이드 밝힘용. 충돌 상자 아님
 */
export function createTrayMesh(trayId: string): THREE.Group {
  const g = new THREE.Group();
  g.name = trayId;
  // 매니저처럼 트레이마다 재질 하나 (밝힘이 emissive를 바꿈)
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.6, roughness: 0.5 });
  const part = (w: number, h: number, d: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(0, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.deviceId = trayId;
    g.add(m);
  };
  // 바닥판 윗면이 가이드 선(TRAY_Y)보다 조금 아래
  const floorY = TRAY_Y - 0.008;
  part(CELL_X, TRAY.plate, TRAY.depth, floorY - TRAY.plate / 2, TRAY_Z);
  for (const s of [1, -1]) part(CELL_X, TRAY.wall, TRAY.wallT, floorY + TRAY.wall / 2, TRAY_Z + s * (TRAY.depth / 2 - TRAY.wallT / 2));
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

/** 테마 띠 밝기: 전용 · 꽉 찬 전용 */
const BAND_GLOW = { theme: 0.35, full: 1 };

/**
 * 랙 테마 띠: 위 가로판 앞·뒷면에 얇은 판 두 장 (재질 하나 공유, 랙마다 따로). 처음엔 숨김. 충돌 상자 아님.
 * 색·밝기는 setThemeBand가 테마가 바뀔 때만 바꿈
 */
export function createThemeBand(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'theme-band';
  const { width: W, depth: D, frame: F } = RACK;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const geo = new THREE.BoxGeometry(W - 2 * F, F * 0.5, 0.004);
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, RACK_HEIGHT - F / 2, s * (D / 2 + 0.003));
    g.add(m);
  }
  g.visible = false;
  return g;
}

/** 테마 없음 → 숨김. 있으면 그 종류 색, 꽉 찼으면 더 밝게 */
export function setThemeBand(band: THREE.Group, theme: RackTheme | null): void {
  band.visible = theme !== null;
  if (!theme) return;
  const mat = (band.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  mat.color.setHex(THEME_COLOR[theme.kind]);
  mat.emissive.setHex(THEME_COLOR[theme.kind]);
  mat.emissiveIntensity = theme.full ? BAND_GLOW.full : BAND_GLOW.theme;
}
