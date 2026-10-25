// 케이블 엔티티와 포트. 케이블 = 로프 + 양 끝 커넥터(꽂힌 포트 또는 null).

import type { Aabb, Vec3 } from './collide';
import { Rope } from './rope';
import type { Tie } from './velcro';

export type PortKind = 'lan' | 'power';
export type CableEnd = 0 | 1;

export interface Port {
  id: string;
  kind: PortKind;
  /** 월드 좌표, 커넥터 끝이 닿는 점 */
  pos: Vec3;
  /** 포트 바깥쪽 법선 — 케이블이 이 방향으로 곧게 나온다 */
  dir: Vec3;
  plugged: { cable: Cable; end: CableEnd } | null;
}

export interface Cable {
  id: string;
  kind: PortKind;
  rope: Rope;
  ends: [Port | null, Port | null];
  color: number;
  /** 뒷면 기둥에 묶은 벨크로 (velcro.ts) */
  ties: Tie[];
}

export const CABLE_RADIUS: Record<PortKind, number> = { lan: 0.003, power: 0.004 };

export function createCable(id: string, kind: PortKind, length: number, color: number): Cable {
  return { id, kind, rope: new Rope(length, { radius: CABLE_RADIUS[kind] }), ends: [null, null], color, ties: [] };
}

export function endNode(cable: Cable, end: CableEnd): number {
  return end === 0 ? 0 : cable.rope.n - 1;
}

export class CableWorld {
  readonly cables: Cable[] = [];
  readonly ports: Port[] = [];
  readonly colliders: Aabb[] = [];

  step(dt: number): void {
    for (const c of this.cables) c.rope.step(dt, this.colliders);
  }

  get awakeCount(): number {
    let k = 0;
    for (const c of this.cables) if (!c.rope.sleeping) k++;
    return k;
  }
}
