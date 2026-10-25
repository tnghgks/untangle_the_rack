import { describe, expect, it } from 'vitest';
import { CABLES, DEVICES, type DeviceDefId } from '../src/data/catalog';
import { paybackSec, priceOf } from '../src/game/economy';

const SERVERS: DeviceDefId[] = ['server-entry', 'server-web', 'server-storage', 'server-gpu'];

describe('priceOf', () => {
  it('구매할 때마다 ×1.25', () => {
    const web = DEVICES['server-web'];
    expect(priceOf(web, 0)).toBe(400);
    expect(priceOf(web, 1)).toBe(500);
    expect(priceOf(web, 2)).toBe(625);
  });
});

describe('인플레이션 억제', () => {
  it('상위 서버일수록 회수 시간이 길다 (해금 없이 다 열려 있어도 고급 장비가 지름길이 아님)', () => {
    const pb = SERVERS.map((id) => paybackSec(DEVICES[id]));
    for (let i = 1; i < pb.length; i++) expect(pb[i]).toBeGreaterThan(pb[i - 1]);
  });

  // 탐욕 전략(회수 시간 가장 짧은 서버를 살 수 있을 때 바로 삼)으로 1초 단위 시뮬.
  // 랙 U·포트·전력 제약은 빼서 실제보다 빠른 상한 쪽을 본다. 서버마다 케이블 2가닥 값 포함.
  function simulate(minutes: number) {
    const cable = CABLES['cable-lan'].price + CABLES['cable-power'].price;
    const bought: Record<string, number> = {};
    let money = 0;
    let income = 1; // 시작 엔트리 서버
    const cost = (id: DeviceDefId) => priceOf(DEVICES[id], bought[id] ?? 0) + cable;
    for (let t = 0; t < minutes * 60; t++) {
      for (;;) {
        const best = SERVERS.reduce((a, b) => (cost(a) / DEVICES[a].incomePerSec <= cost(b) / DEVICES[b].incomePerSec ? a : b));
        if (money < cost(best)) break;
        money -= cost(best);
        bought[best] = (bought[best] ?? 0) + 1;
        income += DEVICES[best].incomePerSec;
      }
      money += income;
    }
    return { income, bought };
  }

  it('MVP 기준: 15분 안에 웹 서버 3대 이상', () => {
    expect(simulate(15).bought['server-web'] ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('30분에 초당 수익이 500원을 넘지 않음 (제약 없는 상한)', () => {
    expect(simulate(30).income).toBeLessThan(500);
  });
});
