import { describe, expect, it } from 'vitest';
import { formatMoney } from '../src/ui/format';

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
