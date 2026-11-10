import * as THREE from 'three';
import type { Cable } from '../cable/cable';
import type { Guide } from '../cable/guide';
import { findRoute, routePath } from '../cable/route';
import type { CableDrag } from './drag';
import type { Room } from './room';

// 가이드에 끌어 놓기: 선 가운데를 끌다 커서가 케이블 매니저(가이드) 위에 오면 그 매니저를 밝히고
// 깔릴 경로를 점선으로 미리 보여 준다. 놓으면 그 가이드를 지나는 경로로 자리 잡는다 (room.routeCable).
// 양 끝이 다 꽂혀 있지 않으면 경로가 없어 매니저만 빨갛게 — 놓으면 잠깐 빨갛게 깜빡이고 선은 그 자리에서 다시 물리로.

const OK_GLOW = 0x2d6cdf;
const BAD_GLOW = 0x8a1c1c;
const PREVIEW_COLOR = 0x8cc8ff;
const FLASH_MS = 300;
/** 가이드 선분까지 이 거리(m) 안이면 위에 있는 것으로 — 멀수록 거리 × PICK_SLOPE 만큼 넓힘 */
const PICK_MIN = 0.04;
const PICK_SLOPE = 0.035;

export interface GuideToolDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  room: Room;
  drag(): CableDrag;
  /** 끌어 놓기를 받는 도구인지 */
  active(): boolean;
}

export interface GuideTool {
  /** 선 가운데를 끌다 놓음: 가이드 위면 경로에 올림. 처리했으면 true */
  onRelease(cable: Cable, ray: THREE.Ray): boolean;
  /** 매 프레임: 강조·점선 미리보기 */
  sync(): void;
  /** 광선이 지나는 가이드 (여럿이면 시선에서 각도가 가장 작은 것) */
  rayToGuide(ray: THREE.Ray): Guide | null;
}

export function createGuideTool({ canvas, camera, scene, room, drag, active }: GuideToolDeps): GuideTool {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const onRay = new THREE.Vector3();
  let lastX = 0;
  let lastY = 0;

  const preview = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: PREVIEW_COLOR, dashSize: 0.02, gapSize: 0.012, depthTest: false, transparent: true }),
  );
  preview.visible = false;
  preview.renderOrder = 20;
  preview.frustumCulled = false;
  scene.add(preview);
  /** 지금 미리보기가 그린 것 (선 id|가이드 id) — 바뀔 때만 다시 계산 */
  let previewKey = '';

  /** 밝힌 매니저 */
  let lit: { id: string; color: number; mats: THREE.MeshStandardMaterial[] } | null = null;
  /** 놓기 실패 깜빡임 */
  let flash: { id: string; until: number } | null = null;

  const managerMats = (id: string): THREE.MeshStandardMaterial[] => {
    const mats: THREE.MeshStandardMaterial[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.deviceId === id && o.material instanceof THREE.MeshStandardMaterial) mats.push(o.material);
    });
    return mats;
  };

  const light = (id: string | null, color = 0) => {
    if (lit && (lit.id !== id || lit.color !== color)) {
      for (const m of lit.mats) m.emissive.setHex(0x000000);
      lit = null;
    }
    if (!id || lit) return;
    lit = { id, color, mats: managerMats(id) };
    for (const m of lit.mats) m.emissive.setHex(color);
  };

  const hidePreview = () => {
    preview.visible = false;
    previewKey = '';
  };

  const rayToGuide = (ray: THREE.Ray): Guide | null => {
    let best: Guide | null = null;
    let bestAngle = Infinity;
    for (const g of room.guides()) {
      va.set(g.a[0], g.a[1], g.a[2]);
      vb.set(g.b[0], g.b[1], g.b[2]);
      const d = Math.sqrt(ray.distanceSqToSegment(va, vb, onRay));
      const t = ray.origin.distanceTo(onRay);
      if (d > Math.max(PICK_MIN, t * PICK_SLOPE)) continue;
      const angle = Math.atan2(d, t);
      if (angle < bestAngle) {
        bestAngle = angle;
        best = g;
      }
    }
    return best;
  };

  canvas.addEventListener('pointermove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
  });

  /** 선 가운데를 끄는 중이면 그 선 (커넥터를 끄는 중·들고 다니기는 아님) */
  const heldMiddle = (): Cable | null => {
    const h = drag().held();
    if (!h || h.node === 0 || h.node === h.cable.rope.n - 1) return null;
    return h.cable;
  };

  const sync = () => {
    const cable = active() ? heldMiddle() : null;
    let guide: Guide | null = null;
    if (cable) {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((lastX - rect.left) / rect.width) * 2 - 1, -((lastY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      guide = rayToGuide(raycaster.ray);
    }
    if (!cable || !guide) {
      hidePreview();
      if (flash && performance.now() < flash.until) light(flash.id, BAD_GLOW);
      else {
        flash = null;
        light(null);
      }
      return;
    }
    flash = null;
    const [a, b] = cable.ends;
    const seq = a && b ? findRoute(a, b, room.guides(), guide.id) : null;
    light(guide.id, seq ? OK_GLOW : BAD_GLOW);
    if (!seq || !a || !b) return hidePreview();
    const key = `${cable.id}|${guide.id}`;
    if (key !== previewKey) {
      previewKey = key;
      // 경로마다 꼭짓점 수가 달라 기하를 새로 만든다 (setFromPoints는 기존 버퍼 크기를 못 늘림)
      const pts = routePath(a, b, seq).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      preview.geometry.dispose();
      preview.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      preview.computeLineDistances();
    }
    preview.visible = true;
  };

  return {
    rayToGuide,
    sync,
    onRelease(cable, ray) {
      if (!active()) return false;
      const guide = rayToGuide(ray);
      if (!guide) return false;
      if (room.routeCable(cable, guide.id)) return true;
      flash = { id: guide.id, until: performance.now() + FLASH_MS };
      return false;
    },
  };
}
