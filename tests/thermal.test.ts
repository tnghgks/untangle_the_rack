import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCable } from '../src/cable/cable';
import type { Aabb } from '../src/cable/collide';
import { CableResize, MIN_CABLE_LENGTH } from '../src/cable/shorten';
import { STEP_SEC } from '../src/core/loop';
import { airflowOf, blockedLength, FULL_BLOCK, incomeFactor, lengthInBox, MAX_THROTTLE } from '../src/game/thermal';
import { formatRate } from '../src/ui/format';
import { createStartRoom } from '../src/view/room';

describe('공기 흐름', () => {
  it('상자 안을 지나는 토막 길이만 셈', () => {
    const c = createCable('c', 'lan', 2, 0);
    c.rope.setFromPolyline([[-1, 0.5, 0], [1, 0.5, 0]]);
    const box: Aabb = { min: [-0.25, 0, -1], max: [0.25, 1, 1] };
    expect(lengthInBox(c.rope.pos, c.rope.n, box)).toBeCloseTo(0.5, 1);
    // 꽂힌 끝이 없으면 바닥에 놓인 새 선으로 보고 세지 않음
    expect(blockedLength([c], box)).toBe(0);
  });

  it('배율은 공기 흐름 100% → 1, 0% → 1 − MAX_THROTTLE, 그 사이는 연속', () => {
    expect(airflowOf(0)).toBe(1);
    expect(airflowOf(FULL_BLOCK * 2)).toBe(0);
    expect(incomeFactor(1)).toBe(1);
    expect(incomeFactor(0)).toBeCloseTo(1 - MAX_THROTTLE);
    expect(incomeFactor(airflowOf(FULL_BLOCK / 2))).toBeCloseTo(1 - MAX_THROTTLE / 2);
  });

  it('시작 상태(2m 케이블 3개)는 감점되고, 줄이기로 남는 길이를 걷으면 회복', () => {
    const room = createStartRoom(new THREE.Scene(), new THREE.Group());
    room.updatePower(Date.now());
    expect(room.airflow).toBeLessThan(0.8);
    expect(room.incomePerSec).toBeLessThan(0.9);

    for (const c of room.world.cables) {
      const job = new CableResize(c.rope);
      for (let i = 0; i < 600; i++) {
        job.step(MIN_CABLE_LENGTH, STEP_SEC);
        room.world.step(STEP_SEC);
      }
      job.end();
    }
    for (let i = 0; i < 300; i++) room.world.step(STEP_SEC);
    room.updatePower(Date.now());
    expect(room.airflow).toBeGreaterThan(0.95);
    expect(room.incomePerSec).toBeGreaterThan(0.97);
  });

  it('스로틀링으로 생긴 소수 수익 표기', () => {
    expect(formatRate(0.73)).toBe('+0.7원/초');
    expect(formatRate(1)).toBe('+1원/초');
  });
});
