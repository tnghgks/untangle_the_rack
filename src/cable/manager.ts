// 케이블 매니저 (GDD 5장): 랙 칸에 끼우는 1U 부품. 뒷면에 고리가 가로로 늘어서 있고, 고리에 건 선은 그 자리에 고정된다.
// Three.js에 의존하지 않는다 (헤드리스 테스트용). 거는 손은 벨크로와 같다 — 선을 끌어 고리에 대고 Space (view/manager.ts).
// 벨크로와 차이: 기둥(랙 양 끝)이 아니라 랙 가운데 아무 높이에나 고정점을 만든다. 대신 1U와 돈을 쓴다.
// 고리에 건 것도 Tie (velcro.ts) — hook에 고리 id를 적어 기둥 띠와 구분한다. 한 고리에 여러 가닥.

import { events } from '../core/events';
import { RACK, U, uBottomY } from '../data/units';
import type { Cable } from './cable';
import type { Vec3 } from './collide';
import { canReach, untie, type Tie } from './velcro';

/** 장비 뒷면 z (device.ts BACK_Z와 같은 값) */
const BACK_Z = -(RACK.depth - 0.16) / 2 - 0.002;
/** 고리 중심이 뒷면에서 떨어진 거리 — 배기 통로(EXHAUST_GAP 0.1) 앞쪽이라 건 선은 막힘으로 안 셈 */
export const RING_OUT = 0.05;
export const RING_R = 0.018;
/** 고리 중심에서 이 거리 안의 마디를 건다 */
export const HOOK_CAPTURE = 0.05;
/** 한 고리에 여러 가닥이 겹치지 않게 (y, z) 조금씩 비켜 놓음 */
const SPREAD: [number, number][] = [[0, 0], [0.007, 0], [-0.007, 0], [0, 0.007], [0, -0.007], [0.006, 0.006], [-0.006, -0.006]];

export interface Ring {
  /** `${deviceId}:ring${i}` */
  id: string;
  pos: Vec3;
}

/** 매니저 장비(아래쪽 U)의 고리들 */
export function ringsOf(deviceId: string, u: number, xs: readonly number[]): Ring[] {
  const y = uBottomY(u) + U / 2;
  return xs.map((x, i) => ({ id: `${deviceId}:ring${i}`, pos: [x, y, BACK_Z - RING_OUT] }));
}

export function deviceOfHook(hook: string): string {
  return hook.slice(0, hook.lastIndexOf(':'));
}

/** 고리에 걸린 것들 */
export function hooksAt(cables: readonly Cable[], ringId: string): { cable: Cable; tie: Tie }[] {
  return cables.flatMap((cable) => cable.ties.filter((t) => t.hook === ringId).map((tie) => ({ cable, tie })));
}

/** 고리 근처의 가장 가까운 마디 (커넥터 쪽 두 마디는 꽂기가 씀) */
function nearestNode(cable: Cable, at: Vec3): number {
  const { rope } = cable;
  const p = rope.pos;
  let best = -1, bestD = HOOK_CAPTURE;
  for (let i = 2; i <= rope.n - 3; i++) {
    if (rope.isPinned(i)) continue;
    const d = Math.hypot(p[i * 3] - at[0], p[i * 3 + 1] - at[1], p[i * 3 + 2] - at[2]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** 고리에 닿아 있는 선을 모두 건다. 닿지 않아 못 건 선도 알려 줌 */
export function hook(cables: readonly Cable[], ring: Ring): { hooked: Cable[]; taut: Cable[] } {
  const hooked: Cable[] = [], taut: Cable[] = [];
  let k = hooksAt(cables, ring.id).length;
  for (const cable of cables) {
    if (cable.ties.some((t) => t.hook === ring.id)) continue;
    const node = nearestNode(cable, ring.pos);
    if (node < 0) continue;
    const [dy, dz] = SPREAD[k % SPREAD.length];
    const at: Vec3 = [ring.pos[0], ring.pos[1] + dy, ring.pos[2] + dz];
    if (!canReach(cable, node, at)) {
      taut.push(cable);
      continue;
    }
    cable.rope.pin(node, at[0], at[1], at[2]);
    cable.ties.push({ node, pos: at, hook: ring.id });
    events.emit('cable:tied', { cableId: cable.id, node });
    hooked.push(cable);
    k++;
  }
  return { hooked, taut };
}

/** 고리에서 모두 뺌. 뺀 가닥 수 */
export function unhook(cables: readonly Cable[], ringId: string): number {
  const all = hooksAt(cables, ringId);
  for (const { cable, tie } of all) untie(cable, tie);
  return all.length;
}

/** 매니저를 빼거나 팔 때: 그 고리들에 걸린 선을 모두 풂 */
export function releaseDevice(cables: readonly Cable[], deviceId: string): void {
  for (const cable of cables) {
    for (const t of cable.ties.filter((x) => x.hook && deviceOfHook(x.hook) === deviceId)) untie(cable, t);
  }
}
