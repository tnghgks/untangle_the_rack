// 케이블 엔티티와 포트. 케이블 = 로프 + 양 끝 커넥터(꽂힌 포트 또는 null).

import type { Aabb, Vec3 } from './collide';
import { Rope } from './rope';

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
  /** 상점에서 낸 값 (판매 환급용). 시작 배선은 0 */
  paid: number;
  /** 가이드 경로에 들었으면 그 경로 (null = 늘어진 로프) */
  route: Route | null;
}

/** 가이드 경로: 지나는 가이드(매니저 id) 순서와 그중 벨크로로 묶은 가이드 */
export interface Route {
  guides: string[];
  tied: string[];
}

export const CABLE_RADIUS: Record<PortKind, number> = { lan: 0.003, power: 0.004 };

export function createCable(id: string, kind: PortKind, length: number, color: number): Cable {
  return { id, kind, rope: new Rope(length, { radius: CABLE_RADIUS[kind] }), ends: [null, null], color, paid: 0, route: null };
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
