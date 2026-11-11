import { describe, expect, it } from 'vitest';
import { formatBonus, formatMoney } from '../src/ui/format';

describe('formatMoney', () => {
  it.each([
    [0, '0원'],
    [9999, '9,999원'],
    [9999.9, '9,999원'],
    [10000, '1.00만원'],
    [123456, '12.3만원'],
    [1234567, '123만원'],
    [12345678, '1,230만원'],
    [99_995_000, '1.00억원'],
    [456_000_000, '4.56억원'],
    [1.23e12, '1.23조원'],
    [-12000, '-1.20만원'],
  ])('%d → %s', (v, out) => {
    expect(formatMoney(v)).toBe(out);
  });
});

describe('formatBonus', () => {
  it.each([
    [null, false, ''],
    [{ kind: 'server-web', full: false }, false, ' (전용 랙 +10%)'],
    [{ kind: 'server-web', full: true }, false, ' (꽉 찬 전용 랙 +25%)'],
    [null, true, ' (짝 +15%)'],
    [{ kind: 'server-gpu', full: false }, true, ' (전용 랙 +10% · 짝 +15%)'],
  ] as const)('%o, 짝 %s → "%s"', (theme, paired, out) => {
    expect(formatBonus(theme, paired)).toBe(out);
  });
});
