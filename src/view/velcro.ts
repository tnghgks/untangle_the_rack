import * as THREE from 'three';
import type { CableWorld } from '../cable/cable';
import type { Vec3 } from '../cable/collide';
import {
  POST_HALF, POST_X, POST_Z, STRAP_Y_MAX, STRAP_Y_MIN, strap, strapNear, strapsOf, unstrap, type Post,
} from '../cable/velcro';
import { RACK } from '../data/units';
import type { CableDrag } from './drag';

// 벨크로 도구 (GDD 5장): 한 손으로 케이블을 뒷면 기둥에 대고, 다른 손으로 띠를 감는다.
// - 케이블 가운데를 끄는 중 커서가 기둥 위면 손이 기둥 겉면에 붙고(snap) 반투명 띠가 감길 자리를 보여 준다
// - 그 상태에서 Space 또는 오른쪽 클릭 → 그 높이에 띠를 감아 기둥에 닿은 선을 모두 묶고, 잡은 선을 놓는다
//   같은 높이에 이미 띠가 있으면 그 띠에 더 묶음 → 여러 가닥이 한 다발
// - 아무것도 안 든 채 기둥을 클릭: 감긴 띠면 풀기, 아니면 그 높이에 이미 닿아 있는 선을 묶기
// 기둥에 가만히 걸쳐 둘 수는 없다 (세로 기둥이라 놓으면 미끄러져 내림) — 그래서 든 채로 감는다.

const STRAP_COLOR = 0x2d6cdf;
const STRAP_H = 0.018;
/** 커서 광선이 기둥 중심에서 이만큼(수평) 안을 지나면 기둥을 가리킨 것으로 */
const POST_PICK = POST_HALF + 0.015;
/** 끄는 선이 붙는 자리: 기둥 중심에서 이만큼 (겉면 바로 밖) */
const SNAP_R = POST_HALF * Math.SQRT2 + 0.008;

export interface VelcroToolDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  world: CableWorld;
  /** 케이블 끌기 (만들어진 뒤에만 쓰므로 함수로) */
  drag(): CableDrag;
  /** 벨크로 도구가 골라져 있는지 */
  active(): boolean;
  /** 잠깐 띄우는 안내 */
  flash(text: string): void;
}

export interface VelcroTool {
  /** drag.ts snap: 끄는 중 커서가 기둥 위면 손이 붙을 자리. null = 다른 것(매니저 고리)이 먼저 붙음 */
  snap(ray: THREE.Ray | null): Vec3 | null;
  /** 띠 메시를 묶음 목록에 맞춤 + 미리보기·커서 (매 프레임) */
  sync(): void;
}

interface PostHit {
  post: Post;
  y: number;
  /** 기둥 중심에서 광선이 지나는 쪽 (수평 단위 벡터) */
  dx: number;
  dz: number;
}

/** 광선이 가리키는 뒷면 기둥과 높이 (가장 앞의 것) */
function rayToPost(ray: THREE.Ray): PostHit | null {
  const { origin: o, direction: d } = ray;
  const dd = d.x * d.x + d.z * d.z;
  if (dd < 1e-9) return null;
  let best: (PostHit & { t: number }) | null = null;
  for (const post of [-1, 1] as const) {
    const px = post * POST_X;
    // 광선을 바닥 평면에 내려 기둥 축(수직선)에 가장 가까운 점
    const t = -((o.x - px) * d.x + (o.z - POST_Z) * d.z) / dd;
    if (t <= 0) continue;
    const hx = o.x + d.x * t - px, hz = o.z + d.z * t - POST_Z;
    const h = Math.hypot(hx, hz);
    const py = o.y + d.y * t;
    if (h > POST_PICK || py < STRAP_Y_MIN || py > STRAP_Y_MAX || (best && t >= best.t)) continue;
    // 축을 정통으로 지나면 카메라 쪽으로
    const [dx, dz] = h > 1e-4 ? [hx / h, hz / h] : [-d.x / Math.sqrt(dd), -d.z / Math.sqrt(dd)];
    best = { post, y: py, dx, dz, t };
  }
  return best;
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export function createVelcroTool({ canvas, camera, scene, world, drag, active, flash }: VelcroToolDeps): VelcroTool {
  const strapGeo = new THREE.BoxGeometry(RACK.frame + 0.018, STRAP_H, RACK.frame + 0.018);
  const strapMat = new THREE.MeshStandardMaterial({ color: STRAP_COLOR, roughness: 0.9 });
  const ghost = new THREE.Mesh(
    strapGeo,
    new THREE.MeshStandardMaterial({ color: STRAP_COLOR, roughness: 0.9, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  ghost.visible = false;
  scene.add(ghost);
  const straps = new Map<string, THREE.Mesh>();
  const place = (m: THREE.Mesh, post: Post, y: number) => m.position.set(post * POST_X, y, POST_Z);

  /** 빈손으로 커서를 올린 기둥 자리 (커서는 sync에서 매 프레임 덮어씀 — hover.ts와 등록 순서에 상관없게) */
  let hover: { post: Post; y: number; near: boolean } | null = null;
  /** 끄는 선이 붙은 기둥 자리 */
  let holding: PostHit | null = null;
  let hinted = false;

  const pickAt = (x: number, y: number): PostHit | null => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return rayToPost(raycaster.ray);
  };

  /** 띠를 감을 높이: 근처에 감긴 띠가 있으면 그 높이 (다발) */
  const strapY = (post: Post, y: number) => strapNear(world.cables, post, y)?.y ?? y;

  const report = (tied: number, taut: number) => {
    if (tied) flash(`🔗 ${tied}가닥을 묶었어요 · 띠를 클릭하면 풀기`);
    else if (taut) flash('케이블이 짧아 거기까지 닿지 않아요 · 더 낮은 곳에 감아 보세요');
    else flash('기둥에 닿은 케이블이 없어요 · 케이블을 끌어 기둥 위에 대고 Space');
  };

  /** 든 채로 감기 (Space·오른쪽 클릭) */
  const wrapHeld = (): boolean => {
    if (!active() || !holding || !drag().held()) return false;
    const { post, y } = holding;
    const r = strap(world.cables, post, strapY(post, y));
    drag().drop();
    holding = null;
    report(r.tied.length, r.taut.length);
    return true;
  };

  // 빈손 클릭: 케이블 끌기(drag.ts)보다 먼저 등록돼야 함 — 기둥을 가리키면 여기서 끝낸다
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0 || !active() || drag().held()) return;
      const hit = pickAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const near = strapNear(world.cables, hit.post, hit.y);
      if (near) {
        unstrap(near);
        flash(`🔗 벨크로를 풀었어요 (${near.ties.length}가닥)`);
      } else {
        const r = strap(world.cables, hit.post, hit.y);
        report(r.tied.length, r.taut.length);
      }
      hover = { post: hit.post, y: hit.y, near: strapNear(world.cables, hit.post, hit.y) !== null };
    },
    { capture: true },
  );
  // 왼쪽을 누른 채 오른쪽을 누르면 pointerdown이 아니라 mousedown만 온다 (코드 버튼)
  window.addEventListener('mousedown', (e) => {
    if (e.button === 2 && wrapHeld()) e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && wrapHeld()) e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    const hit = e.target === canvas && e.buttons === 0 && active() ? pickAt(e.clientX, e.clientY) : null;
    hover = hit && { post: hit.post, y: hit.y, near: strapNear(world.cables, hit.post, hit.y) !== null };
  });
  canvas.addEventListener('pointerleave', () => (hover = null));

  return {
    snap(ray) {
      holding = active() && ray ? rayToPost(ray) : null;
      if (!holding) return null;
      if (!hinted) {
        hinted = true;
        flash('🔗 Space 또는 오른쪽 클릭: 여기에 벨크로 감기');
      }
      const { post, y, dx, dz } = holding;
      return [post * POST_X + dx * SNAP_R, y, POST_Z + dz * SNAP_R];
    },

    sync() {
      if (!active()) hover = null;
      if (!active() || !drag().held()) holding = null;
      // 든 채로 기둥에 대면 감길 자리(근처 띠가 있으면 그 띠), 빈손이면 커서 자리 — 감긴 띠 위면 풀기 커서만
      if (holding) {
        place(ghost, holding.post, strapY(holding.post, holding.y));
        ghost.visible = true;
      } else {
        ghost.visible = hover !== null && !hover.near;
        if (hover) {
          place(ghost, hover.post, hover.y);
          canvas.style.cursor = hover.near ? 'pointer' : 'copy';
        }
      }
      const live = new Set<string>();
      for (const s of strapsOf(world.cables)) {
        live.add(s.key);
        if (straps.has(s.key)) continue;
        const m = new THREE.Mesh(strapGeo, strapMat);
        place(m, s.post, s.y);
        scene.add(m);
        straps.set(s.key, m);
      }
      for (const [key, m] of straps) {
        if (live.has(key)) continue;
        scene.remove(m);
        straps.delete(key);
      }
    },
  };
}
