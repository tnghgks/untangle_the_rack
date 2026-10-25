import * as THREE from 'three';
import type { Cable, CableEnd } from '../cable/cable';

// 케이블은 반지름 3~4mm라 레이캐스트로는 잡기 어렵다 → 노드를 화면에 투영해
// 화면 픽셀 거리로 가장 가까운 선분을 고른다.

export interface CablePick {
  cable: Cable;
  node: number;
  /** 끝(커넥터) 근처를 잡았으면 그 끝 */
  end: CableEnd | null;
}

const PICK_PX = 10;
/** 끝에서 이 마디 수 안쪽을 잡으면 커넥터를 잡은 것으로 */
const END_NODES = 1;

const v = new THREE.Vector3();

export function pickCable(
  cables: readonly Cable[],
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
  rect: DOMRect,
): CablePick | null {
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  let best: CablePick | null = null;
  let bestPx = PICK_PX;

  for (const cable of cables) {
    const { pos, n } = cable.rope;
    let px = 0, py = 0, pValid = false;
    for (let i = 0; i < n; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(camera);
      const sx = ((v.x + 1) / 2) * rect.width;
      const sy = ((1 - v.y) / 2) * rect.height;
      const valid = v.z > -1 && v.z < 1;
      if (i > 0 && valid && pValid) {
        // 화면상 선분까지 거리
        const ex = sx - px, ey = sy - py;
        const ee = ex * ex + ey * ey;
        const t = ee > 1e-6 ? Math.min(1, Math.max(0, ((mx - px) * ex + (my - py) * ey) / ee)) : 0;
        const d = Math.hypot(px + ex * t - mx, py + ey * t - my);
        if (d < bestPx) {
          bestPx = d;
          const node = t < 0.5 ? i - 1 : i;
          const end: CableEnd | null = node <= END_NODES ? 0 : node >= n - 1 - END_NODES ? 1 : null;
          best = { cable, node, end };
        }
      }
      px = sx; py = sy; pValid = valid;
    }
  }
  return best;
}
