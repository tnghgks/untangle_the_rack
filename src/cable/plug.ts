// 커넥터 꽂기·뽑기. 종류(랜/전원)가 같은 빈 포트에만 꽂힌다.
// 꽂으면 끝 노드는 포트에, 그 옆 노드는 포트 법선 방향 한 마디 앞에 고정 → 케이블이 곧게 나온다.

import { events } from '../core/events';
import { endNode, type Cable, type CableEnd, type Port, type PortKind } from './cable';
import type { Vec3 } from './collide';

/** 이 안에서 놓으면 꽂힘 */
export const SNAP_RADIUS = 0.03;
/** 이 안에선 끄는 커넥터가 포트 쪽으로 끌려감 */
export const MAGNET_RADIUS = 0.06;

export function plug(cable: Cable, end: CableEnd, port: Port): boolean {
  if (port.kind !== cable.kind || port.plugged || cable.ends[end]) return false;
  const { rope } = cable;
  const e = endNode(cable, end);
  const next = end === 0 ? 1 : rope.n - 2;
  const s = rope.cfg.segLen;
  const [px, py, pz] = port.pos;
  const [dx, dy, dz] = port.dir;
  rope.pin(e, px, py, pz);
  rope.pin(next, px + dx * s, py + dy * s, pz + dz * s);
  cable.ends[end] = port;
  port.plugged = { cable, end };
  events.emit('cable:plugged', { cableId: cable.id, portId: port.id });
  return true;
}

export function unplug(cable: Cable, end: CableEnd): void {
  const port = cable.ends[end];
  if (!port) return;
  const { rope } = cable;
  rope.unpin(endNode(cable, end));
  rope.unpin(end === 0 ? 1 : rope.n - 2);
  cable.ends[end] = null;
  port.plugged = null;
  events.emit('cable:unplugged', { cableId: cable.id, portId: port.id });
}

export interface PortHit {
  port: Port;
  dist: number;
  /** 종류가 맞아 꽂을 수 있는지 */
  ok: boolean;
}

export interface PortRayHit extends PortHit {
  /** 포트 깊이에서 광선이 지나는 점 */
  hand: Vec3;
}

/**
 * 마우스 광선이 각 빈 포트의 깊이(카메라 시선 기준)에서 포트에 얼마나 가까이 지나는지로 고른다.
 * 손 평면 깊이와 포트 깊이가 달라도 화면에서 포트 위에 커서를 올리면 잡힌다.
 * (종류 무관 — 안 맞으면 ok=false로 알려 줌)
 */
export function nearestPortOnRay(
  ports: readonly Port[],
  origin: Vec3,
  dir: Vec3,
  fwd: Vec3,
  radius: number,
  kind: PortKind,
): PortRayHit | null {
  const fd = fwd[0] * dir[0] + fwd[1] * dir[1] + fwd[2] * dir[2];
  if (fd <= 1e-6) return null;
  let best: PortRayHit | null = null;
  for (const port of ports) {
    if (port.plugged) continue;
    const [px, py, pz] = port.pos;
    const t = (fwd[0] * (px - origin[0]) + fwd[1] * (py - origin[1]) + fwd[2] * (pz - origin[2])) / fd;
    if (t <= 0) continue;
    const hand: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    const d = Math.hypot(px - hand[0], py - hand[1], pz - hand[2]);
    if (d <= radius && (!best || d < best.dist)) best = { port, dist: d, ok: port.kind === kind, hand };
  }
  return best;
}

/** 자석 보정: 스냅 반경 안이면 포트로, 자석 반경 경계에선 손 위치 그대로 */
export function magnetize(hand: Vec3, hit: PortHit): Vec3 {
  if (!hit.ok) return hand;
  const k = Math.min(1, Math.max(0, (MAGNET_RADIUS - hit.dist) / (MAGNET_RADIUS - SNAP_RADIUS)));
  const t = hit.port.pos;
  return [hand[0] + (t[0] - hand[0]) * k, hand[1] + (t[1] - hand[1]) * k, hand[2] + (t[2] - hand[2]) * k];
}
