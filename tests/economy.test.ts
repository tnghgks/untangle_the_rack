import { describe, expect, it } from 'vitest';
import { CABLES, DEVICES, type DeviceDefId } from '../src/data/catalog';
import { paybackSec, priceOf, spend, tick } from '../src/game/economy';
import { createGameState } from '../src/game/state';
import { PDU_LAYOUT, PDU_SIDES } from '../src/rack/device';

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

// 위 시뮬에 실제 제약을 넣은 판: 스위치 랜 포트 · PDU 콘센트 8개 · PDU 용량 · 옆면 PDU 2자리.
// 막히면 그 제약을 푸는 장비(스위치 24포트·PDU)를 먼저 산다. 배선·이동 시간은 0으로 봐서 여전히 상한 쪽.
describe('제약 포함 15분 (M6)', () => {
  const lanPorts = (id: DeviceDefId) => DEVICES[id].ports.filter((p) => p.kind === 'lan').length;
  const LAN = CABLES['cable-lan'].price;
  const PWR = CABLES['cable-power'].price;

  function simulate(minutes: number, pick: (cost: (id: DeviceDefId) => number) => DeviceDefId) {
    const bought: Partial<Record<DeviceDefId, number>> = {};
    const price = (id: DeviceDefId) => priceOf(DEVICES[id], bought[id] ?? 0);
    const cost = (id: DeviceDefId) => price(id) + (id === 'pdu' ? 0 : id === 'switch-24' ? PWR : LAN + PWR);
    // 시작 상태: PDU 1 (콘센트 2 사용) · 스위치 8포트 (랜 1 사용) · 엔트리 서버
    let money = 0, income = 1, lanFree = lanPorts('switch-8') - 1, outlets = PDU_LAYOUT.outlets - 2;
    let pdus = 1, watts = DEVICES['switch-8'].watts + DEVICES['server-entry'].watts;
    const webAt: number[] = [];
    for (let t = 0; t < minutes * 60; t++) {
      for (;;) {
        const want = pick(cost);
        let id: DeviceDefId = want;
        if (outlets < 1 || watts + DEVICES[want].watts > pdus * DEVICES.pdu.capacity!) id = 'pdu';
        else if (lanFree < 1) id = 'switch-24';
        if ((id === 'pdu' && pdus >= PDU_SIDES) || (id === 'switch-24' && bought['switch-24'])) break;
        if (money < cost(id)) break;
        money -= cost(id);
        bought[id] = (bought[id] ?? 0) + 1;
        if (id === 'pdu') {
          pdus++;
          outlets += PDU_LAYOUT.outlets;
          continue;
        }
        outlets--;
        watts += DEVICES[id].watts;
        lanFree += id === 'switch-24' ? lanPorts(id) : -1;
        income += DEVICES[id].incomePerSec;
        if (id === 'server-web') webAt.push(t);
      }
      money += income;
    }
    return { income, bought, webAt };
  }

  const cheapest = (cost: (id: DeviceDefId) => number) =>
    (['server-entry', 'server-web'] as const).reduce((a, b) => (cost(a) / DEVICES[a].incomePerSec <= cost(b) / DEVICES[b].incomePerSec ? a : b));

  it('웹 서버만 사면 3대째가 12분 안 (실측 10.8분)', () => {
    expect(simulate(15, () => 'server-web').webAt[2]).toBeLessThan(12 * 60);
  });

  it('회수 시간 탐욕이어도 15분 안에 웹 서버 3대 (실측 14.4분 — PDU·스위치 벽을 넘어서)', () => {
    const { webAt, bought } = simulate(15, cheapest);
    expect(webAt[2]).toBeLessThan(15 * 60);
    expect(bought.pdu).toBe(1);
  });
});

describe('tick', () => {
  it('실제 경과 시간만큼 더하고 같은 시간을 두 번 세지 않음', () => {
    const s = createGameState(1000);
    tick(s, 1250, 4);
    expect(s.money).toBeCloseTo(1);
    tick(s, 1250, 4);
    expect(s.money).toBeCloseTo(1);
    // 탭을 10분 숨겼다 돌아옴
    tick(s, 1250 + 600_000, 4);
    expect(s.money).toBeCloseTo(2401);
  });

  it('spend: 모자라면 안 빠짐', () => {
    const s = createGameState(0, 100);
    expect(spend(s, 150)).toBe(false);
    expect(s.money).toBe(100);
    expect(spend(s, 60)).toBe(true);
    expect(s.money).toBe(40);
  });
});
