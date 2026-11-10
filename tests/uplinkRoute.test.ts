import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Cable, CableEnd, Port } from '../src/cable/cable';
import type { Guide } from '../src/cable/guide';
import { plug } from '../src/cable/plug';
import { findRoute, pathLength, routePath } from '../src/cable/route';
import { RACK_HEIGHT } from '../src/data/units';
import type { Device } from '../src/rack/device';
import { cellOrigin, reachableCells, TRAY_Y, worstUplinkLength, type Cell } from '../src/rack/floor';
import { createStartRoom, type Room } from '../src/view/room';

const freeLan = (d: Device) => d.ports.find((p) => p.kind === 'lan' && !p.plugged)!;
const lans = (d: Device) => d.ports.filter((p) => p.kind === 'lan');
const firstSwitch = (room: Room) => room.devices.find((d) => d.def.id === 'switch-8')!;

/** 시작 방 + 그 칸에 랙 + 그 랙 U1 24포트 스위치 */
function twoRacks(cell: Cell) {
  const room = createStartRoom(new THREE.Scene());
  const r2 = room.addRack(cell)!;
  const sw2 = room.install('switch-24', 1, r2.id)!;
  return { room, sw1: firstSwitch(room), sw2 };
}

/** 10m(기본) 선을 두 포트에 꽂음 */
function cableBetween(room: Room, a: Port, b: Port, length = 10): Cable {
  const c = room.spawnCable('lan', 0, length);
  plug(c, 0, a);
  plug(c, 1, b);
  return c;
}

const seqOf = (room: Room, ids: readonly string[]): Guide[] => {
  const byId = new Map(room.guides().map((g) => [g.id, g]));
  return ids.map((id) => byId.get(id)!);
};
const realLength = (room: Room, c: Cable) => pathLength(routePath(c.ends[0]!, c.ends[1]!, seqOf(room, c.route!.guides)));

describe('랙 사이 트레이 경로', () => {
  it('10m 선은 길이 10, 2m 선은 지금과 같은 모양', () => {
    const room = createStartRoom(new THREE.Scene());
    const long = room.spawnCable('lan', 0, 10);
    expect(long.rope.length).toBeCloseTo(10, 6);
    for (let i = 0; i < long.rope.n; i++) expect(long.rope.pos[i * 3 + 1]!).toBeLessThan(0.05);
    expect(room.spawnCable('lan').rope.length).toBeCloseTo(2, 6);
  });

  it('옆 랙 스위치끼리 트레이를 지나는 경로', () => {
    const { room, sw1, sw2 } = twoRacks([1, 0]);
    const c = cableBetween(room, freeLan(sw1), freeLan(sw2));
    expect(room.routeCable(c, 'rack-1:tray')).toBe(true);
    expect(c.route!.guides).toEqual(['rack-1:tray', 'rack-2:tray']);
    const pts = routePath(c.ends[0]!, c.ends[1]!, seqOf(room, c.route!.guides));
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThanOrEqual(TRAY_Y - 0.01);
    // 몸체 안쪽 2cm 안으로 안 들어감. 포트 높이에서 랙 옆까지 가는 첫·끝 가로 구간(포트가 원래 랙 뒤 안쪽에 있음)은 뺌
    const low = Math.max(c.ends[0]!.pos[1], c.ends[1]!.pos[1]) + 0.05;
    for (const o of [cellOrigin([0, 0]), cellOrigin([1, 0])]) {
      for (const p of pts) {
        if (p[1] <= low) continue;
        const inside = Math.abs(p[0] - o[0]) < 0.3 - 0.02 && Math.abs(p[2] - o[2]) < 0.5 - 0.02 && p[1] < RACK_HEIGHT - 0.02;
        expect(inside, `점 ${p.map((v) => v.toFixed(3))}`).toBe(false);
      }
    }
  });

  it('2m 선은 트레이 경로 거절', () => {
    const { room, sw1, sw2 } = twoRacks([1, 0]);
    const c = cableBetween(room, freeLan(sw1), freeLan(sw2), 2);
    expect(room.routeCable(c, 'rack-1:tray')).toBe(false);
    expect(c.route).toBeNull();
  });

  it('사이 랙 트레이를 차례로 지남', () => {
    const room = createStartRoom(new THREE.Scene());
    room.addRack([1, 0]);
    const r3 = room.addRack([2, 0])!;
    const sw3 = room.install('switch-24', 1, r3.id)!;
    const c = cableBetween(room, freeLan(firstSwitch(room)), freeLan(sw3));
    expect(room.routeCable(c, 'rack-3:tray')).toBe(true);
    expect(c.route!.guides).toEqual(['rack-1:tray', 'rack-2:tray', 'rack-3:tray']);
  });

  it('세로 매니저가 있으면 그걸 타고 오름', () => {
    const { room, sw1, sw2 } = twoRacks([1, 0]);
    const v = room.addSide('cable-manager-v', 'rack-1', 1)!;
    const c = cableBetween(room, freeLan(sw1), freeLan(sw2));
    expect(room.routeCable(c, 'rack-1:tray')).toBe(true);
    expect(c.route!.guides).toEqual([v.id, 'rack-1:tray', 'rack-2:tray']);
  });

  it('같은 랙 안에선 다른 랙 매니저를 안 씀', () => {
    const room = createStartRoom(new THREE.Scene());
    room.addRack([1, 0]);
    const h1 = room.install('cable-manager', 5)!;
    const h2 = room.install('cable-manager', 5, 'rack-2')!;
    const c = room.world.cables[2]!; // 시작 랜선 (스위치 ↔ 서버)
    expect(room.routeCable(c, h1.id)).toBe(true);
    expect(c.route!.guides.some((id) => id === h2.id || id.startsWith('rack-2'))).toBe(false);
    expect(findRoute(c.ends[0]!, c.ends[1]!, room.guides(), h2.id, c.rope.length)).toBeNull();
    expect(findRoute(c.ends[0]!, c.ends[1]!, room.guides(), 'rack-1:tray', c.rope.length)).toBeNull();
  });

  it('초록 칸 가장자리는 U1 스위치끼리도 10m로 닿음', () => {
    const origin: Cell = [0, 0];
    const cells = reachableCells([{ id: 'rack-1', cell: origin }]);
    const worst = Math.max(...cells.map((c) => worstUplinkLength(origin, c)));
    const edge = cells.filter((c) => worstUplinkLength(origin, c) > worst - 1e-9);
    // 같은 줄 가장 먼 칸, 다른 줄 칸, 대각선이 다 들어 있음
    for (const want of [[4, 0], [0, 2], [2, 1]] as const) expect(edge.some((c) => c[0] === want[0] && c[1] === want[1])).toBe(true);
    for (const cell of edge) {
      const room = createStartRoom(new THREE.Scene());
      room.remove(firstSwitch(room));
      const sw1 = room.install('switch-24', 1)!;
      const r2 = room.addRack(cell)!;
      const sw2 = room.install('switch-24', 1, r2.id)!;
      // 상대 랙에서 먼 쪽 끝 포트. 같은 x면 a는 왼쪽 끝·b는 오른쪽 끝 (서로 반대쪽 옆으로 올라 트레이를 가로지르는 더 나쁜 경우)
      const farPort = (d: Device, towardRight: boolean) => {
        const xs = lans(d);
        return xs.reduce((p, q) => ((towardRight ? q.pos[0] < p.pos[0] : q.pos[0] > p.pos[0]) ? q : p));
      };
      const a = farPort(sw1, cell[0] >= 0);
      const b = farPort(sw2, cell[0] < 0);
      const c = cableBetween(room, a, b);
      expect(room.routeCable(c, 'rack-1:tray'), `칸 ${cell}`).toBe(true);
      const len = realLength(room, c);
      expect(len, `칸 ${cell}`).toBeLessThanOrEqual(worstUplinkLength(origin, cell));
    }
  });

  it('옮긴 뒤 트레이 경로가 길이를 넘으면 경로만 풀림', () => {
    // (a) 같은 랙 U2로 옮김 → 경로 되살아남
    {
      const { room, sw1, sw2 } = twoRacks([1, 0]);
      const c = cableBetween(room, freeLan(sw1), freeLan(sw2));
      expect(room.routeCable(c, 'rack-1:tray')).toBe(true);
      const route = { guides: [...c.route!.guides], tied: [...c.route!.tied] };
      const portId = c.ends[1]!.id;
      const end: CableEnd = 1;
      room.remove(sw2);
      const back = room.install('switch-24', 2, 'rack-2', sw2.id)!;
      const port = back.ports.find((p) => p.id === portId)!;
      expect(room.canReplug(c, end, port, route)).toBe(true);
      expect(plug(c, end, port)).toBe(true);
      expect(room.routeWith(c, route.guides, route.tied)).toBe(true);
    }
    // (b) 멀리 [6,0] 랙 U1로 옮김 → 직선으론 닿아 꽂히지만 트레이 경로는 10m 넘어 풀림
    {
      const { room, sw1, sw2 } = twoRacks([1, 0]);
      const c = cableBetween(room, freeLan(sw1), freeLan(sw2));
      expect(room.routeCable(c, 'rack-1:tray')).toBe(true);
      const route = { guides: [...c.route!.guides], tied: [...c.route!.tied] };
      const portId = c.ends[1]!.id;
      const end: CableEnd = 1;
      room.remove(sw2);
      const far = room.addRack([6, 0])!;
      const moved = room.install('switch-24', 1, far.id, sw2.id)!;
      const port = moved.ports.find((p) => p.id === portId)!;
      expect(room.canReplug(c, end, port, route)).toBe(true);
      expect(plug(c, end, port)).toBe(true);
      expect(room.routeWith(c, route.guides, route.tied)).toBe(false);
      expect(c.route).toBeNull();
      expect(c.ends[0]).not.toBeNull();
      expect(c.ends[1]).toBe(port);
    }
  });

  it('랙이 안 맞는 경로는 거절: 같은 랙 경로를 랙 사이에, 트레이 경로를 같은 랙에', () => {
    // (a) 같은 랙 매니저 경로 → 스위치가 다른 랙으로 옮겨짐
    {
      const room = createStartRoom(new THREE.Scene());
      const h = room.install('cable-manager', 5)!;
      const c = room.world.cables[2]!; // 시작 랜선 (스위치 ↔ 서버, 2m)
      expect(room.routeCable(c, h.id)).toBe(true);
      const route = { guides: [...c.route!.guides], tied: [...c.route!.tied] };
      const sw = firstSwitch(room);
      const end: CableEnd = sw.ports.includes(c.ends[0]!) ? 0 : 1;
      const portId = c.ends[end]!.id;
      room.remove(sw);
      const r2 = room.addRack([4, 0])!;
      const moved = room.install('switch-8', 1, r2.id, sw.id)!;
      const port = moved.ports.find((p) => p.id === portId)!;
      expect(plug(c, end, port)).toBe(true);
      expect(room.routeFits(c, route.guides)).toBe(false);
      expect(room.routeWith(c, route.guides, route.tied)).toBe(false);
      expect(c.route).toBeNull();
    }
    // (b) 트레이 경로 → 두 끝이 같은 랙이 됨
    {
      const { room, sw1, sw2 } = twoRacks([1, 0]);
      const c = cableBetween(room, freeLan(sw1), freeLan(sw2));
      expect(room.routeCable(c, 'rack-1:tray')).toBe(true);
      const route = { guides: [...c.route!.guides], tied: [...c.route!.tied] };
      const portId = c.ends[1]!.id;
      room.remove(sw2);
      const back = room.install('switch-24', 8, 'rack-1', sw2.id)!;
      const port = back.ports.find((p) => p.id === portId)!;
      expect(plug(c, 1, port)).toBe(true);
      expect(room.routeFits(c, route.guides)).toBe(false);
      expect(room.routeWith(c, route.guides, route.tied)).toBe(false);
      expect(c.route).toBeNull();
    }
  });
});
