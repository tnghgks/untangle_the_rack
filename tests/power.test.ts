import { describe, expect, it } from 'vitest';
import { BOOT_MS, resetBreaker, updatePower, type PowerDevice, type PowerRole } from '../src/game/power';

function dev(id: string, role: PowerRole, opts: Partial<PowerDevice> = {}): PowerDevice {
  const ports =
    role === 'pdu'
      ? [0, 1, 2].map((i) => ({ id: `${id}:power${i}`, kind: 'power' as const }))
      : role === 'switch'
        ? [{ id: `${id}:lan0`, kind: 'lan' as const }, { id: `${id}:lan1`, kind: 'lan' as const }, { id: `${id}:power2`, kind: 'power' as const }]
        : [{ id: `${id}:lan0`, kind: 'lan' as const }, { id: `${id}:power1`, kind: 'power' as const }];
  return {
    id, role, on: role === 'pdu', watts: role === 'server' ? 250 : role === 'switch' ? 30 : 0,
    incomePerSec: role === 'server' ? 3 : 0, capacity: role === 'pdu' ? 3000 : 0, tripped: false, load: 0, demand: 0,
    ports, bootStart: null, status: 'off', ...opts,
  };
}

function links(...pairs: [string, string][]): Map<string, string> {
  const m = new Map<string, string>();
  for (const [a, b] of pairs) {
    m.set(a, b);
    m.set(b, a);
  }
  return m;
}

/** PDU + 스위치 + 서버, 전부 배선 */
function wired() {
  const pdu = dev('pdu', 'pdu');
  const sw = dev('sw', 'switch', { on: true });
  const srv = dev('srv', 'server', { on: true });
  const l = links(['pdu:power0', 'sw:power2'], ['pdu:power1', 'srv:power1'], ['sw:lan0', 'srv:lan0']);
  return { devs: [pdu, sw, srv], pdu, sw, srv, l };
}

describe('updatePower', () => {
  it('켜고 3초 부팅 뒤 가동, 수익·전력 합산', () => {
    const { devs, srv, l } = wired();
    let s = updatePower(devs, l, 0);
    expect(srv.status).toBe('booting');
    expect(s.incomePerSec).toBe(0);
    expect(s.powerUsed).toBe(280);
    s = updatePower(devs, l, BOOT_MS - 1);
    expect(srv.status).toBe('booting');
    s = updatePower(devs, l, BOOT_MS);
    expect(srv.status).toBe('running');
    expect(s).toEqual({ incomePerSec: 3, powerUsed: 280, powerCap: 3000 });
    expect(devs[0].load).toBe(280);
  });

  it('꺼져 있으면 off, 전기 안 먹음', () => {
    const { devs, srv, l } = wired();
    srv.on = false;
    const s = updatePower(devs, l, 10_000);
    expect(srv.status).toBe('off');
    expect(s.powerUsed).toBe(30);
  });

  it('전원선이 없으면 nopower, 다시 꽂으면 부팅부터', () => {
    const { devs, srv, l } = wired();
    updatePower(devs, l, 0);
    updatePower(devs, l, 5000);
    expect(srv.status).toBe('running');
    l.delete('srv:power1');
    l.delete('pdu:power1');
    updatePower(devs, l, 6000);
    expect(srv.status).toBe('nopower');
    l.set('srv:power1', 'pdu:power1').set('pdu:power1', 'srv:power1');
    updatePower(devs, l, 7000);
    expect(srv.status).toBe('booting');
  });

  it('전원 포트가 PDU가 아닌 곳에 이어지면 전기 없음', () => {
    const a = dev('a', 'server', { on: true });
    const b = dev('b', 'server', { on: true });
    updatePower([a, b], links(['a:power1', 'b:power1']), 0);
    expect(a.status).toBe('nopower');
  });

  it('차단된 PDU는 전기를 안 줌', () => {
    const { devs, pdu, srv, l } = wired();
    pdu.tripped = true;
    updatePower(devs, l, 0);
    expect(srv.status).toBe('nopower');
  });

  it('랜선이 없거나 스위치가 꺼졌거나 부팅 중이면 nolink', () => {
    const { devs, sw, srv, l } = wired();
    updatePower(devs, l, 0);
    sw.on = false;
    updatePower(devs, l, 5000);
    expect(srv.status).toBe('nolink');
    sw.on = true;
    updatePower(devs, l, 6000); // 스위치 다시 부팅
    expect(sw.status).toBe('booting');
    expect(srv.status).toBe('nolink');
    const s = updatePower(devs, l, 9000);
    expect(srv.status).toBe('running');
    expect(s.incomePerSec).toBe(3);
    l.delete('srv:lan0');
    updatePower(devs, l, 9500);
    expect(srv.status).toBe('nolink');
  });
});

describe('차단기', () => {
  /** 용량 500W PDU에 250W 서버 n대 */
  function loaded(n: number) {
    const pdu = dev('pdu', 'pdu', { capacity: 500, ports: Array.from({ length: n + 1 }, (_, i) => ({ id: `pdu:power${i}`, kind: 'power' as const })) });
    const sw = dev('sw', 'switch', { on: true });
    const srvs = Array.from({ length: n }, (_, i) => dev(`s${i}`, 'server', { on: true }));
    const l = links(['pdu:power0', 'sw:power2'], ...srvs.map((s, i): [string, string] => [`pdu:power${i + 1}`, `${s.id}:power1`]));
    return { devs: [pdu, sw, ...srvs], pdu, srvs, l };
  }

  it('용량 이하면 그대로', () => {
    const { devs, pdu, l } = loaded(1);
    const s = updatePower(devs, l, 0);
    expect(pdu.tripped).toBe(false);
    expect(pdu.load).toBe(280);
    expect(s.powerUsed).toBe(280);
  });

  it('넘으면 차단 → 꽂힌 장비 전부 전기 없음, 전원 버튼은 그대로', () => {
    const { devs, pdu, srvs, l } = loaded(2); // 30 + 500 > 500
    const s = updatePower(devs, l, 0);
    expect(pdu.tripped).toBe(true);
    expect(pdu.status).toBe('nopower');
    expect(srvs.every((d) => d.status === 'nopower' && d.on)).toBe(true);
    expect(s.powerUsed).toBe(0);
    expect(pdu.load).toBe(0);
    expect(pdu.demand).toBe(530);
  });

  it('부하를 줄이고 리셋하면 다시 부팅, 안 줄이면 또 차단', () => {
    const { devs, pdu, srvs, l } = loaded(2);
    updatePower(devs, l, 0);
    resetBreaker(pdu);
    updatePower(devs, l, 100);
    expect(pdu.tripped).toBe(true);
    srvs[1].on = false;
    resetBreaker(pdu);
    updatePower(devs, l, 200);
    expect(pdu.tripped).toBe(false);
    expect(srvs[0].status).toBe('booting');
    expect(pdu.load).toBe(280);
  });
});
