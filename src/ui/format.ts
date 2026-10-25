// 돈 표기 (GDD 8장): 1만 미만은 쉼표, 1만 이상은 만·억·조·경 축약 + 유효숫자 3자리.
// 예: 9,999원 / 10,000 → 1.00만원 / 123,456 → 12.3만원 / 456,000,000 → 4.56억원

const UNITS: [number, string][] = [
  [1e16, '경'],
  [1e12, '조'],
  [1e8, '억'],
  [1e4, '만'],
];

export function formatMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  const v = Math.floor(Math.abs(value));
  if (v < 1e4) return `${sign}${v.toLocaleString('ko-KR')}원`;

  for (let i = 0; i < UNITS.length; i++) {
    const [base, name] = UNITS[i];
    if (v < base) continue;
    const n = roundSig(v / base, 3);
    // 반올림으로 다음 단위에 닿으면(9999.5만 → 1.00억) 한 단계 올림
    if (n >= 1e4 && i > 0) return `${sign}${formatSig(n / 1e4)}${UNITS[i - 1][1]}원`;
    return `${sign}${formatSig(n)}${name}원`;
  }
  return `${sign}${v}원`;
}

function roundSig(n: number, digits: number): number {
  if (n === 0) return 0;
  const p = digits - 1 - Math.floor(Math.log10(n));
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

/** 이미 유효숫자 3자리로 반올림된 수를 소수 자릿수 맞춰 출력 (1 → "1.00", 12.3 → "12.3", 1230 → "1,230") */
function formatSig(n: number): string {
  const intDigits = Math.floor(Math.log10(n)) + 1;
  const decimals = Math.max(0, 3 - intDigits);
  return n.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatRate(perSec: number): string {
  return `+${formatMoney(perSec)}/초`;
}
