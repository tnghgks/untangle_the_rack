// 장비·케이블 정의 표 (GDD 3.1). 숫자는 이 파일 한 곳에 모은다.
// 포트 x/y는 장비 뒷면 중심 기준 미터 (x: 랙 폭 방향, y: 장비 높이 중심에서 위로).

import type { PortKind } from '../cable/cable';

export type DeviceDefId = 'server-entry' | 'server-web' | 'server-storage' | 'server-gpu' | 'switch-8' | 'switch-24' | 'pdu';
export type CableDefId = 'cable-lan' | 'cable-power';

export interface PortDef {
  kind: PortKind;
  x: number;
  y?: number;
}

/** null = 처음부터. owned = 그 장비를 count대 이상 보유. switchFull = 스위치 포트가 다 찼을 때 */
export type Unlock = null | { owned: DeviceDefId; count: number } | { when: 'switchFull' };

export interface DeviceDef {
  id: DeviceDefId;
  name: string;
  /** 0 = 랙 옆면(PDU) */
  sizeU: number;
  price: number;
  incomePerSec: number;
  /** 소비 전력 W */
  watts: number;
  /** PDU 공급 용량 W */
  capacity?: number;
  ports: PortDef[];
  color: number;
  unlock: Unlock;
}

export interface CableDef {
  id: CableDefId;
  name: string;
  kind: PortKind;
  price: number;
}

const POWER_X = 0.19;
const serverPorts = (lan: number): PortDef[] => [
  ...Array.from({ length: lan }, (_, i) => ({ kind: 'lan' as const, x: -0.12 + i * 0.03 })),
  { kind: 'power', x: POWER_X },
];

export const DEVICES: Record<DeviceDefId, DeviceDef> = {
  'server-entry': {
    id: 'server-entry', name: '엔트리 서버', sizeU: 1, price: 60, incomePerSec: 1, watts: 150,
    ports: serverPorts(1), color: 0x4a4f57, unlock: null,
  },
  'server-web': {
    id: 'server-web', name: '웹 서버', sizeU: 1, price: 400, incomePerSec: 4, watts: 250,
    ports: serverPorts(1), color: 0x55606b, unlock: null,
  },
  'server-storage': {
    id: 'server-storage', name: '스토리지 서버', sizeU: 2, price: 2500, incomePerSec: 15, watts: 400,
    ports: serverPorts(2), color: 0x3d4650, unlock: { owned: 'server-web', count: 3 },
  },
  'server-gpu': {
    id: 'server-gpu', name: 'GPU 서버', sizeU: 4, price: 20000, incomePerSec: 120, watts: 1600,
    ports: serverPorts(2), color: 0x2b3038, unlock: { owned: 'server-storage', count: 2 },
  },
  'switch-8': {
    id: 'switch-8', name: '스위치 8포트', sizeU: 1, price: 0, incomePerSec: 0, watts: 30,
    ports: [...Array.from({ length: 8 }, (_, i) => ({ kind: 'lan' as const, x: -0.15 + i * 0.026 })), { kind: 'power', x: POWER_X }],
    color: 0x2e5b8a, unlock: null,
  },
  'switch-24': {
    id: 'switch-24', name: '스위치 24포트', sizeU: 1, price: 3000, incomePerSec: 0, watts: 60,
    // 12포트 두 줄
    ports: [
      ...Array.from({ length: 24 }, (_, i) => ({ kind: 'lan' as const, x: -0.2 + (i % 12) * 0.022, y: i < 12 ? 0.009 : -0.009 })),
      { kind: 'power', x: POWER_X },
    ],
    color: 0x2a6aa0, unlock: { when: 'switchFull' },
  },
  pdu: {
    id: 'pdu', name: 'PDU', sizeU: 0, price: 1500, incomePerSec: 0, watts: 0, capacity: 3000,
    ports: [], color: 0x1a1c20, unlock: null,
  },
};

/** 가정: GDD에 케이블 가격이 없어 첫 짐작값. 길이는 기본 2m (CABLE_DEFAULT_LENGTH) */
export const CABLES: Record<CableDefId, CableDef> = {
  'cable-lan': { id: 'cable-lan', name: '랜선 2m', kind: 'lan', price: 10 },
  'cable-power': { id: 'cable-power', name: '전원선 2m', kind: 'power', price: 15 },
};

/** 상점에 보이는 순서 */
export const SHOP_DEVICES: DeviceDefId[] = ['server-entry', 'server-web', 'server-storage', 'server-gpu', 'switch-24', 'pdu'];
export const SHOP_CABLES: CableDefId[] = ['cable-lan', 'cable-power'];

export function unlockText(u: Unlock): string {
  if (!u) return '';
  if ('owned' in u) return `${DEVICES[u.owned].name} ${u.count}대 보유 시`;
  return '스위치 포트가 부족할 때';
}
