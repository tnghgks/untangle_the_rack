import * as THREE from 'three';
import type { Vec3 } from '../cable/collide';
import { deviceRings, hook, hooksAt, unhook, type Ring } from '../cable/manager';
import type { CableDrag } from './drag';
import type { Room } from './room';

// 케이블 매니저 고리 (GDD 5장): 벨크로와 같은 손 — 케이블을 끌어 고리에 대면 손이 고리에 붙고,
// 든 채로 Space 또는 오른쪽 클릭으로 건다. 든 선만 걸림 — 같은 자리를 지나는 다른 선은 그대로. 한 고리에 여러 가닥을 하나씩 걸 수 있음.
// 빈손으로 고리를 클릭: 걸린 게 있으면 모두 빼기, 없으면 닿아 있는 선 걸기.
// 손·벨크로 도구 모두에서 쓴다 (따로 도구 없음). 케이블 끌기(drag.ts)보다 먼저 등록해야 고리 클릭을 가로챈다.

/** 커서 광선이 고리 중심에서 이 거리 안을 지나면 고리를 가리킨 것으로 — 가까이서 */
const RING_PICK = 0.03;
/** 멀리서: 시선 각도(라디안)로. 0.03 ≈ 기본 화각·창 높이 720px에서 26px (10-26 "고리가 끼우기 어렵다") */
const RING_PICK_ANGLE = 0.03;
const LIT = 0x2d6cdf;
const LIT_FULL = 0x5a3a12;

export interface ManagerToolDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  room: Room;
  drag(): CableDrag;
  /** 고리를 쓸 수 있는 도구인지 (손·벨크로) */
  active(): boolean;
  flash(text: string): void;
}

export interface ManagerTool {
  /** drag.ts snap: 끄는 중 커서가 고리 위면 손이 붙을 자리 */
  snap(ray: THREE.Ray): Vec3 | null;
  /** 고리 강조·커서 (매 프레임) */
  sync(): void;
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const at = new THREE.Vector3();

export function createManagerTool({ canvas, camera, room, drag, active, flash }: ManagerToolDeps): ManagerTool {
  const rings = (): Ring[] => room.devices.flatMap(deviceRings);

  /** 광선이 가장 가깝게(화면 각도로) 지나는 고리. 멀리서 봐도 화면에서 같은 크기만큼 잡히게 */
  const rayToRing = (ray: THREE.Ray): Ring | null => {
    let best: Ring | null = null, bestA = Infinity;
    for (const r of rings()) {
      at.set(r.pos[0], r.pos[1], r.pos[2]);
      const t = at.clone().sub(ray.origin).dot(ray.direction);
      if (t <= 0) continue;
      const d = ray.distanceToPoint(at);
      const a = d / t;
      if (d > Math.max(RING_PICK, t * RING_PICK_ANGLE) || a >= bestA) continue;
      best = r;
      bestA = a;
    }
    return best;
  };

  const pickAt = (x: number, y: number): Ring | null => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return rayToRing(raycaster.ray);
  };

  let hover: Ring | null = null;
  let holding: Ring | null = null;
  let hinted = false;

  const report = (hooked: number, taut: number) => {
    if (hooked) flash(`🧷 ${hooked}가닥을 고리에 걸었어요 · 고리를 클릭하면 빼기`);
    else if (taut) flash('케이블이 짧아 고리까지 닿지 않아요');
    else flash('고리에 닿은 케이블이 없어요 · 케이블을 끌어 고리에 대고 Space');
  };

  const hookHeld = (): boolean => {
    if (!active() || !holding || !drag().held()) return false;
    // 잡은 마디는 손이 고리에 붙어 있으니 아직 덜 따라왔어도 그 마디를 건다
    const r = hook(room.world.cables, holding, drag().held() ?? undefined);
    drag().drop();
    holding = null;
    report(r.hooked.length, r.taut.length);
    return true;
  };

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0 || !active() || drag().held()) return;
      const ring = pickAt(e.clientX, e.clientY);
      if (!ring) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const n = unhook(room.world.cables, ring.id);
      if (n) flash(`🧷 고리에서 뺐어요 (${n}가닥)`);
      else {
        const r = hook(room.world.cables, ring);
        report(r.hooked.length, r.taut.length);
      }
    },
    { capture: true },
  );
  // 왼쪽을 누른 채 오른쪽: pointerdown이 아니라 mousedown만 온다 (velcro.ts와 같음)
  window.addEventListener('mousedown', (e) => {
    if (e.button === 2 && hookHeld()) e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && hookHeld()) e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    hover = e.target === canvas && e.buttons === 0 && active() ? pickAt(e.clientX, e.clientY) : null;
  });
  canvas.addEventListener('pointerleave', () => (hover = null));

  const lit = new Set<THREE.MeshStandardMaterial>();

  return {
    snap(ray) {
      holding = active() ? rayToRing(ray) : null;
      if (!holding) return null;
      if (!hinted) {
        hinted = true;
        flash('🧷 Space 또는 오른쪽 클릭: 고리에 걸기');
      }
      return [...holding.pos];
    },

    sync() {
      if (!active()) hover = null;
      if (!active() || !drag().held()) holding = null;
      const target = holding ?? hover;
      for (const m of lit) m.emissive.setHex(0x000000);
      lit.clear();
      if (!target) return;
      for (const d of room.devices) {
        if (!d.def.rings) continue;
        d.group.traverse((o) => {
          if (o.userData.ringId !== target.id) return;
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
          // 빈손으로 걸린 고리 위 = 빼기 (주황), 그 밖엔 걸기 (파랑)
          const full = !holding && hooksAt(room.world.cables, target.id).length > 0;
          m.emissive.setHex(full ? LIT_FULL : LIT);
          lit.add(m);
        });
      }
      if (hover && !holding) canvas.style.cursor = 'pointer';
    },
  };
}
