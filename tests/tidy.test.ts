import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Cable } from '../src/cable/cable';
import type { Guide } from '../src/cable/guide';
import { guideOf } from '../src/cable/guide';
import { plug, unplug } from '../src/cable/plug';
import { tidyDegree } from '../src/cable/route';
import { parseSave, SAVE_VERSION } from '../src/game/save';
import { createStartRoom, restoreRoom, TIDY_POWER_CUT, type Room } from '../src/view/room';

const newRoom = (): Room => createStartRoom(new THREE.Scene(), new THREE.Group());

/** 시작 방 + U5 매니저 */
function roomWithGuide(u = 5): { room: Room; g: Guide } {
  const room = newRoom();
  const g = guideOf(room.install('cable-manager', u)!)!;
  return { room, g };
}

const node = (c: Cable, i: number): [number, number, number] => [c.rope.pos[i * 3]!, c.rope.pos[i * 3 + 1]!, c.rope.pos[i * 3 + 2]!];
const dist = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);

/**
 * 가로 가이드를 따라 가는 마디들: 가이드 x 범위·선에서 3cm 안이고, 다음 마디와 높이가 같으면서 x로 나아감
 * (가이드로 올라오는 세로 구간은 다른 선의 차선을 가로지르므로 뺀다)
 */
function guideNodes(c: Cable, g: Guide): [number, number, number][] {
  const out: [number, number, number][] = [];
  const flat = (p: [number, number, number], q: [number, number, number]) => Math.abs(p[1] - q[1]) < 1e-3 && Math.abs(p[0] - q[0]) > 1e-3;
  for (let i = 0; i < c.rope.n; i++) {
    const p = node(c, i);
    if (p[0] < g.a[0] || p[0] > g.b[0]) continue;
    if (Math.hypot(p[1] - g.a[1], p[2] - g.a[2]) >= 0.03) continue;
    // 평평한 구간의 양 끝 마디까지 (둥근 꺾임 바로 앞 마디도)
    if ((i + 1 < c.rope.n && flat(p, node(c, i + 1))) || (i > 0 && flat(node(c, i - 1), p))) out.push(p);
  }
  return out;
}

/**
 * 가이드를 따라 가는 두 선의 가장 가까운 단면 거리: 선 i의 각 가이드 마디 x에서 선 j를 보간한 점까지 (y, z) 거리의 최소.
 * x 구간이 안 겹치면 Infinity
 */
function minGap(si: readonly [number, number, number][], sj: readonly [number, number, number][]): number {
  let best = Infinity;
  for (const m of si) {
    for (let k = 0; k + 1 < sj.length; k++) {
      const p = sj[k]!, q = sj[k + 1]!;
      if ((p[0] - m[0]) * (q[0] - m[0]) > 0 || p[0] === q[0]) continue;
      const t = (m[0] - p[0]) / (q[0] - p[0]);
      best = Math.min(best, Math.hypot(m[1] - (p[1] + (q[1] - p[1]) * t), m[2] - (p[2] + (q[2] - p[2]) * t)));
    }
  }
  return best;
}

/** 가이드 위에서 어느 두 선도 서로 파고들지 않음 (중심 거리 ≥ 두 반지름 합) */
function expectNoOverlap(cables: readonly Cable[], g: Guide): void {
  const sets = cables.map((c) => guideNodes(c, g));
  for (const s of sets) expect(s.length).toBeGreaterThan(0);
  for (let i = 0; i < cables.length; i++) {
    for (let j = i + 1; j < cables.length; j++) {
      const need = cables[i]!.rope.cfg.radius + cables[j]!.rope.cfg.radius;
      // 짧은 구간은 마디가 하나뿐일 수 있어 양쪽에서 잼
      const gap = Math.min(minGap(sets[i]!, sets[j]!), minGap(sets[j]!, sets[i]!));
      expect(gap, `${cables[i]!.id} ↔ ${cables[j]!.id}`).toBeGreaterThanOrEqual(need);
      expect(gap).toBeLessThan(Infinity); // 같은 구간을 지남
    }
  }
}

describe('경로에 넣기·묶기·풀기', () => {
  it('경로에 넣으면 로프가 멈추고 포트에서 포트까지 이어짐', () => {
    const { room, g } = roomWithGuide();
    const c = room.world.cables[0]!;
    expect(room.routeCable(c, g.id)).toBe(true);
    expect(c.route).toEqual({ guides: [g.id], tied: [] });
    expect(c.rope.frozen).toBe(true);
    expect(dist(node(c, 0), c.ends[0]!.pos)).toBeLessThan(0.001);
    expect(dist(node(c, c.rope.n - 1), c.ends[1]!.pos)).toBeLessThan(0.001);
    const before = Array.from(c.rope.pos);
    for (let i = 0; i < 60; i++) room.world.step(1 / 60);
    expect(Array.from(c.rope.pos)).toEqual(before);
  });

  it('양 끝이 꽂혀야 경로에 들어감', () => {
    const { room, g } = roomWithGuide();
    const c = room.world.cables[0]!;
    unplug(c, 1);
    expect(room.routeCable(c, g.id)).toBe(false);
    expect(c.route).toBeNull();
    expect(c.rope.frozen).toBe(false);
  });

  it('묶기 전엔 전력 그대로, 묶으면 15% × 비율만큼 줄어듦', () => {
    const { room, g } = roomWithGuide();
    for (const c of room.world.cables) expect(room.routeCable(c, g.id)).toBe(true);
    const sw = room.devices.find((d) => d.def.id === 'switch-8')!;
    const entry = room.devices.find((d) => d.def.id === 'server-entry')!;
    const rated = sw.def.watts + entry.def.watts;
    room.updatePower(Date.now());
    expect(sw.power.saving).toBe(0);
    expect(room.summary.powerUsed).toBeCloseTo(rated, 6);

    const tied = room.tieGuide(g.id);
    expect(tied.map((c) => c.id).sort()).toEqual(room.world.cables.map((c) => c.id).sort());
    expect(room.tieGuide(g.id)).toEqual([]); // 이미 묶인 선은 다시 안 묶음
    room.updatePower(Date.now());
    expect(sw.power.saving).toBeCloseTo(TIDY_POWER_CUT, 6);
    expect(TIDY_POWER_CUT).toBe(0.15);
    expect(room.summary.powerUsed).toBeLessThan(rated);
    expect(room.summary.powerUsed).toBeCloseTo(rated * (1 - 0.15), 6);
  });

  it('가이드 한 구간만 묶으면 부분 보상', () => {
    const { room, g: h } = roomWithGuide();
    const v = guideOf(room.addSide('cable-manager-v')!)!;
    expect(room.guides().map((x) => x.id).sort()).toEqual([h.id, v.id].sort());
    const c = room.world.cables[2]!;
    expect(room.routeWith(c, [h.id, v.id], [])).toBe(true);
    expect(c.route).toEqual({ guides: [h.id, v.id], tied: [] });
    expect(room.tieGuide(h.id)).toEqual([c]);
    expect(tidyDegree(c.route)).toBe(0.5);
    expect(tidyDegree(null)).toBe(0);
  });

  it('routeWith는 없는 가이드나 빠진 끝이면 false', () => {
    const { room, g } = roomWithGuide();
    const c = room.world.cables[0]!;
    expect(room.routeWith(c, [g.id, 'nope'], [])).toBe(false);
    expect(c.route).toBeNull();
    unplug(c, 0);
    expect(room.routeWith(c, [g.id], [])).toBe(false);
    expect(c.route).toBeNull();
  });

  it('새 선이 들어와도 묶인 선은 유지', () => {
    const { room, g } = roomWithGuide();
    const [c0, c1, c2] = room.world.cables as [Cable, Cable, Cable];
    room.routeCable(c0, g.id);
    room.routeCable(c1, g.id);
    expect(room.tieGuide(g.id)).toEqual([c0, c1]);
    expect(room.routeCable(c2, g.id)).toBe(true);
    expect(c0.route!.tied).toEqual([g.id]);
    expect(c1.route!.tied).toEqual([g.id]);
    expect(c2.route!.tied).toEqual([]);
    expectNoOverlap([c0, c1, c2], g);
  });

  it('전원선 하나만 묶고 다른 전원선을 올려도 안 겹침 (묶는 연출 중에도)', () => {
    const { room, g } = roomWithGuide();
    const [p0, p1] = room.world.cables as [Cable, Cable];
    expect(p0.kind).toBe('power');
    expect(p1.kind).toBe('power');
    room.routeCable(p0, g.id);
    expect(room.tieGuide(g.id)).toEqual([p0]);
    room.routeCable(p1, g.id);
    expectNoOverlap([p0, p1], g);
    for (const t of [0.25, 0.5, 0.75, 1]) {
      room.relayout(g.id, new Map([[g.id, t]]));
      expectNoOverlap([p0, p1], g);
    }
  });

  it('랜선을 묶은 뒤 전원선을 더해 다 묶어도 안 겹침', () => {
    const { room, g } = roomWithGuide();
    const [p0, p1, lan] = room.world.cables as [Cable, Cable, Cable];
    expect(lan.kind).toBe('lan');
    room.routeCable(lan, g.id);
    expect(room.tieGuide(g.id)).toEqual([lan]);
    room.routeCable(p0, g.id);
    room.routeCable(p1, g.id);
    expectNoOverlap([p0, p1, lan], g);
    expect(room.tieGuide(g.id)).toEqual([p0, p1]);
    expectNoOverlap([p0, p1, lan], g);
  });

  it('묶는 연출의 tight 덮어쓰기는 안 묶인 선에만 — 묶인 선 마디는 그대로', () => {
    const { room, g } = roomWithGuide();
    const [c0, c1, c2] = room.world.cables as [Cable, Cable, Cable];
    room.routeCable(c0, g.id);
    room.routeCable(c1, g.id);
    expect(room.tieGuide(g.id)).toEqual([c0, c1]);
    room.routeCable(c2, g.id);
    const before = [c0, c1].map((c) => guideNodes(c, g));
    const loose = guideNodes(c2, g);
    room.relayout(g.id, new Map([[g.id, 1]]));
    const c2Tight = guideNodes(c2, g);
    room.relayout(g.id, new Map([[g.id, 0]]));
    expect([c0, c1].map((c) => guideNodes(c, g))).toEqual(before);
    expect(guideNodes(c2, g)).toEqual(loose);
    expect(c2Tight).not.toEqual(loose); // 안 묶인 선은 덮어쓰기를 따름
  });

  it('가이드를 빼면 그 가이드를 지나던 선만 풀림', () => {
    const room = newRoom();
    const m5 = room.install('cable-manager', 5)!;
    const m10 = room.install('cable-manager', 10)!;
    const [a, b] = room.world.cables as [Cable, Cable];
    expect(room.routeCable(a, m5.id)).toBe(true);
    expect(room.routeCable(b, m10.id)).toBe(true);
    expect(a.route!.guides).toEqual([m5.id]);
    expect(b.route!.guides).toEqual([m10.id]);
    expect(room.remove(m5)).toBe(true);
    expect(a.route).toBeNull();
    expect(a.rope.frozen).toBe(false);
    expect(b.route).toEqual({ guides: [m10.id], tied: [] });
    expect(b.rope.frozen).toBe(true);
  });

  it('매니저를 옮겨도 (같은 id로 다시 끼우고 routeWith) 경로·묶음 그대로, 차선은 새 자리에 맞게 안 겹침', () => {
    const { room, g } = roomWithGuide();
    const [p0, p1, lan] = room.world.cables as [Cable, Cable, Cable];
    room.routeCable(lan, g.id);
    room.tieGuide(g.id);
    room.routeCable(p0, g.id);
    room.routeCable(p1, g.id);
    room.tieGuide(g.id);
    const kept = room.world.cables.map((cable) => ({ cable, guides: [...cable.route!.guides], tied: [...cable.route!.tied] }));
    const device = room.device(g.id)!;
    expect(room.remove(device)).toBe(true);
    for (const c of room.world.cables) expect(c.route).toBeNull();
    const moved = guideOf(room.install('cable-manager', 12, g.id)!)!;
    for (const { cable, guides, tied } of kept) expect(room.routeWith(cable, guides, tied)).toBe(true);
    for (const c of room.world.cables) expect(c.route).toEqual({ guides: [g.id], tied: [g.id] });
    expectNoOverlap([lan, p0, p1], moved);
  });

  it('선을 뽑으면 경로에서 빠짐', () => {
    const { room, g } = roomWithGuide();
    const c = room.world.cables[1]!;
    room.routeCable(c, g.id);
    const port = c.ends[1]!;
    unplug(c, 1);
    expect(c.route).toBeNull();
    expect(c.rope.frozen).toBe(false);
    // 다시 꽂아도 경로는 저절로 돌아오지 않음
    plug(c, 1, port);
    expect(c.route).toBeNull();
  });

  it('케이블 id는 팔고 새로 사도, 불러온 뒤에도 겹치지 않음', () => {
    const room = newRoom();
    room.removeCable(room.world.cables[0]!);
    room.spawnCable('lan');
    const ids = room.world.cables.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const data = parseSave(JSON.stringify({ v: SAVE_VERSION, money: 0, bought: {}, ...room.snapshot() }))!;
    const back = restoreRoom(new THREE.Scene(), new THREE.Group(), data);
    expect(back.world.cables.map((c) => c.id)).toEqual(ids); // 불러온 id는 그대로
    back.spawnCable('power');
    const after = back.world.cables.map((c) => c.id);
    expect(new Set(after).size).toBe(after.length);
  });

  it('장비를 빼면 그 장비에 꽂힌 경로 선이 풀림 (같은 id 선이 있어도)', () => {
    const { room, g } = roomWithGuide();
    const [, , lan] = room.world.cables as [Cable, Cable, Cable];
    // 시작 선 하나를 팔고 새로 사서, 옛 규칙이면 id가 겹치는 선을 만든다
    room.removeCable(room.world.cables[0]!);
    const fresh = room.spawnCable('lan');
    const [a, b] = lan.ends as [NonNullable<Cable['ends'][0]>, NonNullable<Cable['ends'][1]>];
    unplug(lan, 0);
    unplug(lan, 1);
    expect(plug(fresh, 0, a)).toBe(true);
    expect(plug(fresh, 1, b)).toBe(true);
    expect(room.routeCable(fresh, g.id)).toBe(true);
    const entry = room.devices.find((d) => d.def.id === 'server-entry')!;
    expect(room.remove(entry)).toBe(true);
    expect(fresh.route).toBeNull();
    expect(fresh.rope.frozen).toBe(false);
  });

  it('케이블을 없애도 경로에서 빠짐', () => {
    const { room, g } = roomWithGuide();
    const [c0, c1] = room.world.cables as [Cable, Cable];
    room.routeCable(c0, g.id);
    room.routeCable(c1, g.id);
    room.removeCable(c0);
    expect(c0.route).toBeNull();
    expect(c1.route).toEqual({ guides: [g.id], tied: [] });
  });

  it('저장하고 불러와도 경로·묶음 유지', () => {
    const { room, g } = roomWithGuide();
    const [c0, c1] = room.world.cables as [Cable, Cable];
    room.routeCable(c0, g.id);
    room.routeCable(c1, g.id);
    room.tieGuide(g.id);
    const data = parseSave(JSON.stringify({ v: SAVE_VERSION, money: 0, bought: {}, ...room.snapshot() }))!;
    expect(data).not.toBeNull();
    const back = restoreRoom(new THREE.Scene(), new THREE.Group(), data);
    for (const c of room.world.cables) {
      const d = back.world.cables.find((x) => x.id === c.id)!;
      expect(d.route).toEqual(c.route);
      expect(d.rope.frozen).toBe(c.route !== null);
    }
    expect(back.world.cables.find((x) => x.id === c0.id)!.route).toEqual({ guides: [g.id], tied: [g.id] });
  });

  it('저장된 경로의 가이드가 없으면 늘어진 로프로 불러옴', () => {
    const { room, g } = roomWithGuide();
    const c = room.world.cables[0]!;
    room.routeCable(c, g.id);
    const snap = room.snapshot();
    snap.devices = snap.devices.filter((d) => d.id !== g.id);
    const data = parseSave(JSON.stringify({ v: SAVE_VERSION, money: 0, bought: {}, ...snap }))!;
    const back = restoreRoom(new THREE.Scene(), new THREE.Group(), data);
    const d = back.world.cables.find((x) => x.id === c.id)!;
    expect(d.route).toBeNull();
    expect(d.rope.frozen).toBe(false);
  });

  it('route 형식이 틀린 저장은 버림, 옛 ties 저장은 불러옴', () => {
    const room = newRoom();
    const snap = room.snapshot();
    const bad = { v: SAVE_VERSION, money: 0, bought: {}, ...snap, cables: snap.cables.map((c) => ({ ...c, route: { guides: [1], tied: [] } })) };
    expect(parseSave(JSON.stringify(bad))).toBeNull();
    const old = { v: SAVE_VERSION, money: 0, bought: {}, ...snap, cables: snap.cables.map((c) => ({ ...c, ties: [{ node: 3, pos: [0, 0, 0] }] })) };
    expect(parseSave(JSON.stringify(old))).not.toBeNull();
  });
});
