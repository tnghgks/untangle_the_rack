import { describe, expect, it } from 'vitest';
import type { DeviceDefId, ServerDefId } from '../src/data/catalog';
import { computeBonuses, type BonusDevice } from '../src/game/bonus';
import type { PowerRole, PowerStatus } from '../src/game/power';

const srv = (id: string, defId: ServerDefId, rack = 'r1', status: PowerStatus = 'running', lan = [`${id}:l0`]): BonusDevice => ({
  id, defId, rack, role: 'server', status, lanPorts: lan,
});
const other = (id: string, defId: DeviceDefId, role: PowerRole, rack = 'r1'): BonusDevice => ({
  id, defId, rack, role, status: 'running', lanPorts: [],
});
const fits = () => true;
const link = (...pairs: [string, string][]) => {
  const m = new Map<string, string>();
  for (const [a, b] of pairs) {
    m.set(a, b);
    m.set(b, a);
  }
  return m;
};

describe('전용 랙', () => {
  it('서버 1대뿐인 랙은 전용 아님', () => {
    const b = computeBonuses([srv('a', 'server-web')], new Map(), fits);
    expect(b.themes.has('r1')).toBe(false);
    expect(b.ratio.get('a') ?? 0).toBe(0);
  });

  it('같은 종류 2대 + 스위치·PDU·매니저 섞여도 전용', () => {
    const b = computeBonuses(
      [
        srv('a', 'server-web'), srv('b', 'server-web'),
        other('sw', 'switch-8', 'switch'), other('pdu', 'pdu', 'pdu'), other('m', 'cable-manager', 'passive'),
      ],
      new Map(),
      fits,
    );
    expect(b.themes.get('r1')).toEqual({ kind: 'server-web', full: false });
    expect(b.ratio.get('a')).toBeCloseTo(0.1);
    expect(b.ratio.get('b')).toBeCloseTo(0.1);
    expect(b.ratio.get('sw') ?? 0).toBe(0);
  });

  it('다른 종류 서버가 섞이면 전용 아님', () => {
    const b = computeBonuses([srv('a', 'server-web'), srv('b', 'server-web'), srv('c', 'server-entry')], new Map(), fits);
    expect(b.themes.has('r1')).toBe(false);
    expect(b.ratio.get('a') ?? 0).toBe(0);
  });

  it('서버가 꺼져 있거나 부팅 중이어도 전용 판정에 셈', () => {
    const b = computeBonuses([srv('a', 'server-entry', 'r1', 'off'), srv('b', 'server-entry', 'r1', 'booting')], new Map(), fits);
    expect(b.themes.get('r1')).toEqual({ kind: 'server-entry', full: false });
  });

  it('canFit이 false면 꽉 찬 전용', () => {
    const calls: [string, ServerDefId][] = [];
    const b = computeBonuses([srv('a', 'server-web'), srv('b', 'server-web')], new Map(), (rack, kind) => {
      calls.push([rack, kind]);
      return false;
    });
    expect(b.themes.get('r1')).toEqual({ kind: 'server-web', full: true });
    expect(b.ratio.get('a')).toBeCloseTo(0.25);
    expect(calls).toContainEqual(['r1', 'server-web']);
  });

  it('랙마다 따로 판정', () => {
    const b = computeBonuses(
      [srv('a', 'server-web'), srv('b', 'server-web'), srv('c', 'server-entry', 'r2'), srv('d', 'server-entry', 'r2')],
      new Map(),
      fits,
    );
    expect(b.themes.get('r1')?.kind).toBe('server-web');
    expect(b.themes.get('r2')?.kind).toBe('server-entry');
  });
});

describe('짝 연결', () => {
  const gpu = (status: PowerStatus = 'running') => srv('gpu', 'server-gpu', 'r1', status, ['gpu:l0', 'gpu:l1']);
  const sto = (status: PowerStatus = 'running', rack = 'r2') => srv('sto', 'server-storage', rack, status, ['sto:l0', 'sto:l1']);

  it('GPU와 스토리지 랜 직결 + 둘 다 running이면 짝', () => {
    const b = computeBonuses([gpu(), sto()], link(['gpu:l1', 'sto:l1']), fits);
    expect(b.pairs.get('gpu')).toBe('sto');
    expect(b.pairs.get('sto')).toBe('gpu');
    expect(b.ratio.get('gpu')).toBeCloseTo(0.15);
    expect(b.ratio.get('sto')).toBeCloseTo(0.15);
  });

  it.each(['booting', 'nolink', 'off'] as const)('한쪽이 %s면 짝 아님', (status) => {
    const b = computeBonuses([gpu(), sto(status)], link(['gpu:l1', 'sto:l1']), fits);
    expect(b.pairs.size).toBe(0);
    expect(b.ratio.get('gpu') ?? 0).toBe(0);
  });

  it('GPU↔GPU, 웹↔스토리지는 짝 아님', () => {
    const g2 = srv('g2', 'server-gpu', 'r2', 'running', ['g2:l0', 'g2:l1']);
    expect(computeBonuses([gpu(), g2], link(['gpu:l1', 'g2:l1']), fits).pairs.size).toBe(0);
    const web = srv('web', 'server-web', 'r1', 'running', ['web:l0']);
    expect(computeBonuses([web, sto()], link(['web:l0', 'sto:l1']), fits).pairs.size).toBe(0);
  });

  it('꽉 찬 GPU 전용 + 짝 = 0.40', () => {
    const g2 = srv('g2', 'server-gpu', 'r1', 'running', ['g2:l0', 'g2:l1']);
    const b = computeBonuses([gpu(), g2, sto()], link(['gpu:l1', 'sto:l1']), (rack) => rack !== 'r1');
    expect(b.ratio.get('gpu')).toBeCloseTo(0.4);
    expect(b.ratio.get('g2')).toBeCloseTo(0.25);
  });
});
