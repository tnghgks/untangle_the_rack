import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Cable } from '../src/cable/cable';
import { hook, hooksAt, ringsOf, unhook, type Ring } from '../src/cable/manager';
import { strapsOf } from '../src/cable/velcro';
import { STEP_SEC } from '../src/core/loop';
import { DEVICES } from '../src/data/catalog';
import { updatePower } from '../src/game/power';
import { parseSave, SAVE_VERSION, type SaveData } from '../src/game/save';
import type { Device } from '../src/rack/device';
import { createStartRoom, restoreRoom, type Room } from '../src/view/room';

function backmost(c: Cable): number {
  const p = c.rope.pos;
  let best = 2;
  for (let i = 2; i < c.rope.n - 2; i++) if (p[i * 3 + 2] < p[best * 3 + 2]) best = i;
  return best;
}

const steps = (room: Room, n: number) => {
  for (let i = 0; i < n; i++) room.world.step(STEP_SEC);
};

/** 시작 방 + U15에 매니저 (낮게 달면 남는 길이가 바닥으로 흘러 효과가 작음: U2 23→24%, U10 →70%, U15 →95%) */
function withManager(u = 15): { room: Room; manager: Device; rings: Ring[] } {
  const room = createStartRoom(new THREE.Scene(), new THREE.Group());
  const manager = room.install('cable-manager', u)!;
  steps(room, 240);
  return { room, manager, rings: ringsOf(manager.id, u, DEVICES['cable-manager'].rings!) };
}

/** 플레이어처럼: 늘어진 곳을 잡아 고리로 끌어다 대고 건 뒤 놓음 */
function routeAndHook(room: Room, c: Cable, ring: Ring) {
  c.rope.grab(backmost(c));
  for (let i = 0; i < 180; i++) {
    const t: [number, number, number] = [...ring.pos];
    c.rope.clampToReach(t);
    c.rope.setGrabTarget(t[0], t[1], t[2]);
    room.world.step(STEP_SEC);
  }
  const r = hook(room.world.cables, ring);
  c.rope.release();
  return r;
}

describe('케이블 매니저', () => {
  it('전기를 안 먹고 수익도 없음', () => {
    const { room, manager } = withManager();
    room.updatePower(Date.now());
    expect(manager.power.status).toBe('off');
    expect(manager.ports).toHaveLength(0);
    expect(updatePower([manager.power], new Map(), 0).incomePerSec).toBe(0);
  });

  it('손에 든 마디는 고리까지 덜 따라왔어도 걸림 (Space를 바로 눌러도)', () => {
    const { room, rings } = withManager();
    const c = room.world.cables[0];
    const r = hook(room.world.cables, rings[1], { cable: c, node: backmost(c) });
    expect(r.hooked).toEqual([c]);
  });

  it('든 채로 걸면 든 선만 — 같은 고리에 와 있는 다른 선은 안 걸림', () => {
    const { room, rings } = withManager();
    const [a, b] = room.world.cables;
    // b를 고리에 대 놓은 채로 (손에 든 채 붙잡아 둠)
    b.rope.grab(backmost(b));
    for (let i = 0; i < 180; i++) {
      const t: [number, number, number] = [...rings[1].pos];
      b.rope.clampToReach(t);
      b.rope.setGrabTarget(t[0], t[1], t[2]);
      room.world.step(STEP_SEC);
    }
    const r = hook(room.world.cables, rings[1], { cable: a, node: backmost(a) });
    expect(r.hooked).toEqual([a]);
    expect(b.ties).toHaveLength(0);
    // 빈손 클릭은 닿아 있는 선을 다 검
    expect(hook(room.world.cables, rings[1]).hooked).toEqual([b]);
  });

  it('포트 바로 위 고리에 걸어도 포트 옆이 아니라 앞서 건 고리에서 이어지는 곳이 걸림', () => {
    // U4 = 엔트리 서버(U3) 바로 위. 랜 포트(x −0.12)가 rings[1](x −0.1) 몇 cm 아래
    const { room, rings } = withManager(4);
    const c = room.world.cables[2];
    hook(room.world.cables, rings[0], { cable: c, node: 20 });
    // 포트 — 포트에서 팽팽하게 재면 포트 옆 마디가 들어갔음
    hook(room.world.cables, rings[1], { cable: c, node: 30 });
    const [a, b] = c.ties;
    expect(b.node - a.node).toBeGreaterThan(0);
    expect(b.node - a.node).toBeLessThanOrEqual(4);
  });

  it('커넥터 가까이를 잡아 안 닿으면 닿는 마디로 미끄러져 걸림', () => {
    const { room, rings } = withManager();
    const c = room.world.cables[0];
    const r = hook(room.world.cables, rings[1], { cable: c, node: 3 });
    expect(r.hooked).toEqual([c]);
    expect(c.ties[0].node).toBeGreaterThan(3);
  });

  it('고리를 차례로 걸면 고리 사이가 곧게 (남는 길이는 뒤쪽으로)', () => {
    const { room, rings } = withManager();
    const c = room.world.cables[2];
    for (const ring of rings) {
      // 한쪽 포트에서 이어 가며 거는 것처럼: 방금 건 고리 다음의 늘어진 곳을 잡음
      const last = c.ties[c.ties.length - 1];
      const node = last ? last.node + 6 : 14;
      expect(hook(room.world.cables, ring, { cable: c, node }).hooked).toEqual([c]);
    }
    steps(room, 300);
    const ties = [...c.ties].sort((a, b) => a.node - b.node);
    const p = c.rope.pos;
    let sag = 0;
    for (let k = 1; k < ties.length; k++) {
      for (let i = ties[k - 1].node + 1; i < ties[k].node; i++) sag = Math.max(sag, ties[k].pos[1] - p[i * 3 + 1]);
    }
    // 팽팽하게 걸기 전엔 2.7cm (마디 4cm라 고리 10cm 사이에 12cm가 들어감). 고리 안에서 비켜 놓아 1.3cm
    expect(sag).toBeLessThan(0.015);
  });

  it('고리에 닿지 않은 선은 안 걸림', () => {
    const { room, rings } = withManager();
    expect(hook(room.world.cables, rings[2]).hooked).toHaveLength(0);
  });

  it('고리에 걸면 공기 흐름이 회복, 고리를 비우면 풀림', () => {
    const { room, rings } = withManager();
    room.updatePower(Date.now());
    const before = room.airflow;
    expect(before).toBeLessThan(0.8);
    room.world.cables.forEach((c, i) => expect(routeAndHook(room, c, rings[i + 1]).hooked).toContain(c));
    steps(room, 600);
    room.updatePower(Date.now());
    expect(room.airflow).toBeGreaterThan(0.9);
    // 기둥 띠로는 안 보임
    expect(strapsOf(room.world.cables)).toHaveLength(0);
    expect(unhook(room.world.cables, rings[1].id)).toBe(1);
    expect(hooksAt(room.world.cables, rings[1].id)).toHaveLength(0);
  });

  it('한 고리에 여러 가닥', () => {
    const { room, rings } = withManager();
    const [a, b] = room.world.cables;
    routeAndHook(room, a, rings[0]);
    routeAndHook(room, b, rings[0]);
    expect(hooksAt(room.world.cables, rings[0].id).map((h) => h.cable)).toEqual(expect.arrayContaining([a, b]));
    // 같은 자리에 겹치지 않게 비켜 놓음
    expect(a.ties[0].pos).not.toEqual(b.ties[0].pos);
  });

  it('매니저를 빼면 걸린 선이 풀림', () => {
    const { room, manager, rings } = withManager();
    const c = room.world.cables[0];
    routeAndHook(room, c, rings[1]);
    const node = c.ties[0].node;
    expect(room.remove(manager)).toBe(true);
    expect(c.ties).toHaveLength(0);
    expect(c.rope.isPinned(node)).toBe(false);
  });

  it('저장하고 불러와도 고리에 그대로, 매니저가 없으면 버림', () => {
    const { room, rings } = withManager();
    const c = room.world.cables[2];
    routeAndHook(room, c, rings[3]);
    const node = c.ties[0].node;
    const data: SaveData = { v: SAVE_VERSION, money: 0, bought: {}, ...room.snapshot() };
    const parsed = parseSave(JSON.stringify(data))!;
    expect(parsed).not.toBeNull();
    const back = restoreRoom(new THREE.Scene(), new THREE.Group(), parsed);
    expect(hooksAt(back.world.cables, rings[3].id)).toHaveLength(1);
    expect(back.world.cables[2].rope.isPinned(node)).toBe(true);

    const noManager = { ...parsed, devices: parsed.devices.filter((d) => d.defId !== 'cable-manager') };
    const bare = restoreRoom(new THREE.Scene(), new THREE.Group(), noManager);
    expect(bare.world.cables[2].ties).toHaveLength(0);
    expect(parseSave(JSON.stringify({ ...data, cables: [{ ...data.cables[2], ties: [{ node, pos: [0, 0, 0], hook: 3 }] }] }))).toBeNull();
  });
});
