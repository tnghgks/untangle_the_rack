import * as THREE from 'three';
import type { Cable, CableWorld } from '../cable/cable';
import { POST_INNER_X, tie, tieNear, untie, type Tie } from '../cable/velcro';
import { RACK } from '../data/units';
import { pickCable } from './pick';

// 벨크로 도구 (GDD 5장): 케이블을 클릭하면 가까운 뒷면 기둥을 따라 끌어올려 묶고, 묶인 곳 근처를 다시 클릭하면 푼다.
// 묶인 자리마다 기둥을 감는 띠 메시를 하나씩 둔다 (sync에서 묶음 목록과 맞춤).

const KIND_NAME = { lan: '랜선', power: '전원선' } as const;
const STRAP_COLOR = 0x2d6cdf;
const STRAP_H = 0.018;

export interface VelcroToolDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  world: CableWorld;
  /** 벨크로 도구가 골라져 있는지 */
  active(): boolean;
  /** 잠깐 띄우는 안내 */
  flash(text: string): void;
}

export interface VelcroTool {
  /** 띠 메시를 묶음 목록에 맞춤 (매 프레임) */
  sync(): void;
}

export function createVelcroTool({ canvas, camera, scene, world, active, flash }: VelcroToolDeps): VelcroTool {
  const strapGeo = new THREE.BoxGeometry(RACK.frame + 0.02, STRAP_H, RACK.frame + 0.006);
  const strapMat = new THREE.MeshStandardMaterial({ color: STRAP_COLOR, roughness: 0.9 });
  const straps = new Map<Tie, THREE.Mesh>();

  const click = (cable: Cable, node: number) => {
    const name = KIND_NAME[cable.kind];
    const near = tieNear(cable, node);
    if (near) {
      untie(cable, near);
      flash(`🔗 ${name} 벨크로를 풀었어요`);
      return;
    }
    const r = tie(cable, node);
    if (r === 'tied') flash(`🔗 ${name}을 기둥에 묶었어요 · 다시 클릭하면 풀기`);
    else if (r === 'end') flash('커넥터 바로 옆은 묶을 수 없어요 · 케이블 가운데를 클릭하세요');
    else flash('케이블이 짧아 기둥까지 닿지 않아요 · 다른 곳을 클릭하세요');
  };

  // 케이블 드래그와 같은 window 캡처 단계 — 도구가 벨크로일 때만 받는다
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0 || !active()) return;
      const pick = pickCable(world.cables, camera, e.clientX, e.clientY, canvas.getBoundingClientRect());
      if (!pick) return;
      e.preventDefault();
      click(pick.cable, pick.node);
    },
    { capture: true },
  );

  return {
    sync() {
      const live = new Set<Tie>();
      for (const c of world.cables) {
        for (const t of c.ties) {
          live.add(t);
          if (straps.has(t)) continue;
          const m = new THREE.Mesh(strapGeo, strapMat);
          // 기둥 중심과 묶인 점 사이 — 띠가 기둥과 케이블을 같이 감싼다
          const sx = Math.sign(t.pos[0]);
          m.position.set(sx * (POST_INNER_X + RACK.frame / 2 - 0.01), t.pos[1], t.pos[2]);
          scene.add(m);
          straps.set(t, m);
        }
      }
      for (const [t, m] of straps) {
        if (live.has(t)) continue;
        scene.remove(m);
        straps.delete(t);
      }
    },
  };
}
