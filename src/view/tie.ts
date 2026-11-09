import * as THREE from 'three';
import type { Vec3 } from '../cable/collide';
import type { Cable } from '../cable/cable';
import type { Guide } from '../cable/guide';
import { deviceRings } from '../cable/manager';
import { laneOffset, routePath } from '../cable/route';
import { events } from '../core/events';
import { playTie } from '../ui/sfx';
import { pickCable } from './pick';
import type { Room } from './room';

// 벨크로 도구 (2): 경로에 든 다발(가이드 위나 경로 선 위)을 클릭하면 그 가이드 구간을 묶는다.
// 연출: 선들이 TIE_ANIM_MS 동안 모이며 곧게 펴짐 → 검은 띠가 다발을 감싸며 커짐 + 반짝 + "탁".
// 띠는 Room 상태(route.tied)에서 다시 만든다 — 묶음·경로 빠짐·장비 빼기·불러오기 뒤 모두 같은 길.
// 묶을 때 화면에 글씨는 띄우지 않는다.

/** 모이며 곧게 펴지는 시간 */
export const TIE_ANIM_MS = 350;
/** 세로 가이드에서 띠 간격 m */
export const STRAP_SPACING = 0.15;
/** 띠가 감기며 커지는 시간 */
const STRAP_GROW_MS = 120;
/** 반짝 시간 */
const SPARKLE_MS = 200;
const STRAP_COLOR = 0x111111;
/** 띠 폭(가이드 축 방향) m */
const STRAP_WIDTH = 0.012;
/** 다발 겉면과 띠 사이 여유 m */
const STRAP_PAD = 0.002;
/** 가로 가이드: 다발 구간 끝에서 이만큼 밖의 고리까지 띠를 둠 m */
const RING_TOL = 0.005;

/** 띠 하나: 가운데, 감는 방향 크기, 다른 수직 방향 크기 */
export interface StrapSpot {
  center: Vec3;
  /** 가이드 축에 수직인 첫 방향(가로 가이드: y, 세로 가이드: x) 크기 m */
  wrap: number;
  /** z 방향 크기 m */
  depth: number;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * 그 가이드에 묶인 선들을 감쌀 띠 자리 (묶인 선이 없으면 빈 목록).
 * 차선은 room.relayout과 같은 규칙: 그 가이드를 지나는 경로 선 중 world.cables 순서상 k번째, 묶였으니 tight 1
 */
export function strapSpots(room: Room, guideId: string): StrapSpot[] {
  const guides = room.guides();
  const g = guides.find((x) => x.id === guideId);
  if (!g) return [];
  const byId = new Map(guides.map((x) => [x.id, x]));
  const passing = room.world.cables.filter((c) => c.route?.guides.includes(guideId));
  const ax = g.axis; // 가이드 축 좌표 (0: x, 1: y)
  const i0 = ax === 0 ? 1 : 0; // 감는 방향 좌표
  let lo = Infinity, hi = -Infinity;
  let min0 = Infinity, max0 = -Infinity, min1 = Infinity, max1 = -Infinity;
  let radius = 0;
  passing.forEach((c, k) => {
    const route = c.route!;
    const [a, b] = c.ends;
    if (!a || !b || !route.tied.includes(guideId)) return;
    const seq = route.guides.map((id) => byId.get(id));
    if (seq.some((x) => !x)) return;
    const gi = route.guides.indexOf(guideId);
    const pts = routePath(a, b, seq as Guide[]);
    const s0 = pts[2 + 2 * gi]![ax], s1 = pts[3 + 2 * gi]![ax];
    lo = Math.min(lo, s0, s1);
    hi = Math.max(hi, s0, s1);
    const r = c.rope.cfg.radius;
    radius = Math.max(radius, r);
    const { d } = laneOffset(k, 1, r);
    min0 = Math.min(min0, d[0]);
    max0 = Math.max(max0, d[0]);
    min1 = Math.min(min1, d[1]);
    max1 = Math.max(max1, d[1]);
  });
  if (lo > hi) return [];

  let along: number[];
  if (ax === 0) {
    const device = room.device(guideId);
    along = device ? deviceRings(device).map((r) => r.pos[0]).filter((x) => x >= lo - RING_TOL && x <= hi + RING_TOL) : [];
    if (along.length === 0) along = [(lo + hi) / 2];
  } else {
    const n = Math.floor((hi - lo) / STRAP_SPACING) + 1;
    const mid = (lo + hi) / 2;
    along = Array.from({ length: n }, (_, i) => mid + (i - (n - 1) / 2) * STRAP_SPACING);
  }
  const extra = 2 * (radius + STRAP_PAD);
  const wrap = max0 - min0 + extra;
  const depth = max1 - min1 + extra;
  return along.map((s) => {
    const center: Vec3 = [g.a[0], g.a[1], g.a[2] + (min1 + max1) / 2];
    center[ax] = s;
    center[i0] += (min0 + max0) / 2;
    return { center, wrap, depth };
  });
}

export interface TieToolDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  room: Room;
  guides: { rayToGuide(ray: THREE.Ray): Guide | null };
  /** 벨크로 도구가 골라져 있는지 */
  active(): boolean;
  /** 띠가 감긴 순간 (전력·HUD 갱신) */
  onTied(): void;
}

export interface TieTool {
  /** 매 프레임: 모이기·띠 커지기·반짝 */
  sync(dtSec: number): void;
  /** 벨크로 도구로 이 화면 좌표 위에 묶을 다발이 있으면 'pointer' (커서는 hover.ts가 씀) */
  cursorAt(clientX: number, clientY: number): string | null;
}

interface Strap {
  guideId: string;
  mesh: THREE.Mesh;
}

interface Anim {
  guideId: string;
  /** 지난 시간 ms */
  t: number;
  /** 묶을 선 (클릭 때 그 가이드를 지나면서 아직 안 묶인 선) — 실제 묶기는 모이기가 끝날 때 */
  pending: Cable[];
  /** 이 가이드에 이미 띠가 있었음 → 띠는 그대로 두고(숨기지 않음) 커지는 연출 없이 반짝만 */
  hadStraps: boolean;
  /** 모이기가 끝나 묶었음 (띠가 감기는 중) */
  strapped: boolean;
}

interface Sparkle {
  sprite: THREE.Sprite;
  t: number;
}

/** 반짝 텍스처: 가운데가 밝은 둥근 빛 (한 번만 만듦) */
function sparkleTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,240,180,0.9)');
  grad.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

export function createTieTool({ canvas, camera, scene, room, guides, active, onTied }: TieToolDeps): TieTool {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vp = new THREE.Vector3();
  const onSeg = new THREE.Vector3();
  const line = new THREE.Line3();
  const strapMat = new THREE.MeshStandardMaterial({ color: STRAP_COLOR, roughness: 0.9 });
  let sparkleTex: THREE.Texture | null = null;
  let straps: Strap[] = [];
  const anims = new Map<string, Anim>();
  let sparkles: Sparkle[] = [];
  /** 띠를 Room 상태에서 다시 만들어야 함 (처음 = 불러온 저장의 묶음) */
  let dirty = true;

  const markDirty = () => {
    dirty = true;
  };
  // 묶음·경로 빠짐·장비 빼기가 띠를 바꿈. 경로에 듦·장비 끼우기는 차선·구간이 바뀌어서
  // (옮긴 장비는 끼운 뒤 routeWith로 경로가 되살아나는데 이벤트가 없음 → 다음 프레임에 다시 만듦)
  events.on('cable:tied', markDirty);
  events.on('cable:unrouted', markDirty);
  events.on('device:removed', markDirty);
  events.on('cable:routed', markDirty);
  events.on('device:installed', markDirty);

  const rebuild = () => {
    dirty = false;
    for (const s of straps) {
      s.mesh.removeFromParent();
      s.mesh.geometry.dispose();
    }
    straps = [];
    for (const g of room.guides()) {
      for (const spot of strapSpots(room, g.id)) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(spot.wrap, spot.depth, STRAP_WIDTH), strapMat);
        // 로컬 x = 감는 방향, y = z, z = 가이드 축
        const basis = g.axis === 0
          ? new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
          : new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
        mesh.quaternion.setFromRotationMatrix(basis);
        mesh.position.set(spot.center[0], spot.center[1], spot.center[2]);
        // 처음 묶은 가이드의 띠만 0에서 커짐 (이미 있던 띠는 연출 중에도 그대로)
        const anim = anims.get(g.id);
        if (anim?.strapped && !anim.hadStraps) mesh.scale.x = growOf(anim);
        mesh.visible = mesh.scale.x > 0;
        scene.add(mesh);
        straps.push({ guideId: g.id, mesh });
      }
    }
  };

  const growOf = (a: Anim) => easeOut(Math.min(1, (a.t - TIE_ANIM_MS) / STRAP_GROW_MS));

  const sparkleAt = (p: THREE.Vector3) => {
    sparkleTex ??= sparkleTexture();
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sparkleTex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    sprite.position.copy(p);
    sprite.renderOrder = 30;
    scene.add(sprite);
    sparkles.push({ sprite, t: 0 });
  };

  const rayAt = (clientX: number, clientY: number): THREE.Ray => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  };

  /** 커서 아래 다발의 가이드: 가이드 위면 그 가이드, 경로 선 위면 그 선 경로의 가이드 중 맞은 마디에서 가장 가까운 것 */
  const targetAt = (clientX: number, clientY: number): Guide | null => {
    const all = room.guides();
    const passes = (g: Guide) => room.world.cables.some((c) => c.route?.guides.includes(g.id));
    const onGuide = guides.rayToGuide(rayAt(clientX, clientY));
    if (onGuide && passes(onGuide)) return onGuide;
    const pick = pickCable(room.world.cables, camera, clientX, clientY, canvas.getBoundingClientRect());
    const route = pick?.cable.route;
    if (!pick || !route) return null;
    const p = pick.cable.rope.pos;
    vp.set(p[pick.node * 3]!, p[pick.node * 3 + 1]!, p[pick.node * 3 + 2]!);
    let best: Guide | null = null;
    let bestD = Infinity;
    for (const id of route.guides) {
      const g = all.find((x) => x.id === id);
      if (!g) continue;
      line.set(va.set(g.a[0], g.a[1], g.a[2]), vb.set(g.b[0], g.b[1], g.b[2]));
      const d = line.closestPointToPoint(vp, true, onSeg).distanceTo(vp);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return best;
  };

  /** 그 가이드를 지나면서 아직 그 가이드에서 안 묶인 선 */
  const untiedOn = (guideId: string): Cable[] =>
    room.world.cables.filter((c) => c.route?.guides.includes(guideId) && !c.route.tied.includes(guideId));

  // 케이블 끌기보다 먼저 받아야 하므로 window 캡처 단계 (main.ts에서 케이블 끌기 앞에 등록).
  // 묶을 다발이 아니면 그대로 흘려보내 손처럼 끌 수 있다
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0 || !active()) return;
      const g = targetAt(e.clientX, e.clientY);
      if (!g) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // 연출 중이거나 이미 다 묶인 다발이면 아무 일 없음 (끌기도 시작하지 않음)
      if (anims.has(g.id)) return;
      const pending = untiedOn(g.id);
      if (pending.length === 0) return;
      anims.set(g.id, { guideId: g.id, t: 0, pending, hadStraps: strapSpots(room, g.id).length > 0, strapped: false });
    },
    { capture: true },
  );

  return {
    cursorAt(clientX, clientY) {
      return active() && targetAt(clientX, clientY) ? 'pointer' : null;
    },
    sync(dtSec) {
      const dtMs = dtSec * 1000;
      for (const a of [...anims.values()]) {
        a.t += dtMs;
        if (!a.strapped) {
          // 연출 중에 매니저가 빠졌거나 묶을 선이 모두 경로에서 빠짐 → 소리·보상 없이 조용히 그만
          const still = untiedOn(a.guideId);
          if (!room.guides().some((g) => g.id === a.guideId) || !a.pending.some((c) => still.includes(c))) {
            anims.delete(a.guideId);
            continue;
          }
          if (a.t < TIE_ANIM_MS) {
            // 아직 안 묶인 선만 모임 (이미 묶인 선은 relayout이 늘 tight 1로)
            room.relayout(a.guideId, new Map([[a.guideId, easeOut(a.t / TIE_ANIM_MS)]]));
            continue;
          }
          // 모이기 끝: 이제 묶음 → 전력 감소·띠·반짝·소리·HUD가 같은 순간에
          a.strapped = true;
          if (room.tieGuide(a.guideId).length === 0) {
            anims.delete(a.guideId);
            continue;
          }
          rebuild();
          for (const s of straps) if (s.guideId === a.guideId) sparkleAt(s.mesh.position);
          playTie();
          onTied();
        }
        if (a.hadStraps) {
          anims.delete(a.guideId);
          continue;
        }
        const k = growOf(a);
        for (const s of straps) {
          if (s.guideId !== a.guideId) continue;
          s.mesh.scale.x = k;
          s.mesh.visible = k > 0;
        }
        if (k >= 1) anims.delete(a.guideId);
      }
      if (dirty) rebuild();

      sparkles = sparkles.filter((s) => {
        s.t += dtMs;
        const k = s.t / SPARKLE_MS;
        if (k >= 1) {
          s.sprite.removeFromParent();
          s.sprite.material.dispose();
          return false;
        }
        const size = 0.04 + 0.05 * k;
        s.sprite.scale.set(size, size, 1);
        s.sprite.material.opacity = 1 - k;
        return true;
      });
    },
  };
}

