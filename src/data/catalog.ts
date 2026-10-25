// 장비·케이블 정의 표 (GDD 3.1). 숫자는 이 파일 한 곳에 모은다.
// 해금 없음: 모든 장비를 처음부터 살 수 있다 (10-25 결정). 대신 인플레이션을 막으려고
// 상위 장비일수록 회수 시간(가격 ÷ 수익)을 길게 잡았다: 엔트리 60초 · 웹 133초 · 스토리지 250초 · GPU 364초.
// 실제 상한은 랙 42U·스위치 포트·PDU 용량이 건다.
// 포트 x/y는 장비 뒷면 중심 기준 미터 (x: 랙 폭 방향, y: 장비 높이 중심에서 위로).

import type { PortKind } from '../cable/cable';

export type DeviceDefId =
  | 'server-entry' | 'server-web' | 'server-storage' | 'server-gpu' | 'switch-8' | 'switch-24' | 'pdu' | 'cable-manager';
export type CableDefId = 'cable-lan' | 'cable-power';

export interface PortDef {
  kind: PortKind;
  x: number;
  y?: number;
}

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
  /** 케이블 매니저: 뒷면 고리 x 자리 (cable/manager.ts). 전기·포트 없음 */
  rings?: number[];
}

export interface CableDef {
  id: CableDefId;
  name: string;
  kind: PortKind;
  price: number;
}

/** 새 게임 시작 돈: 엔트리 서버 + 케이블 몇 세트를 바로 살 수 있게 (초반에 할 일이 없던 문제, 10-25 플레이 피드백) */
export const START_MONEY = 300;

const POWER_X = 0.19;
const serverPorts = (lan: number): PortDef[] => [
  ...Array.from({ length: lan }, (_, i) => ({ kind: 'lan' as const, x: -0.12 + i * 0.03 })),
  { kind: 'power', x: POWER_X },
];

export const DEVICES: Record<DeviceDefId, DeviceDef> = {
  'server-entry': {
    id: 'server-entry', name: '엔트리 서버', sizeU: 1, price: 60, incomePerSec: 1, watts: 150,
    ports: serverPorts(1), color: 0x4a4f57,
  },
  'server-web': {
    id: 'server-web', name: '웹 서버', sizeU: 1, price: 400, incomePerSec: 3, watts: 250,
    ports: serverPorts(1), color: 0x55606b,
  },
  'server-storage': {
    id: 'server-storage', name: '스토리지 서버', sizeU: 2, price: 2500, incomePerSec: 10, watts: 400,
    ports: serverPorts(2), color: 0x3d4650,
  },
  'server-gpu': {
    id: 'server-gpu', name: 'GPU 서버', sizeU: 4, price: 20000, incomePerSec: 55, watts: 1600,
    ports: serverPorts(2), color: 0x2b3038,
  },
  'switch-8': {
    id: 'switch-8', name: '스위치 8포트', sizeU: 1, price: 0, incomePerSec: 0, watts: 30,
    ports: [...Array.from({ length: 8 }, (_, i) => ({ kind: 'lan' as const, x: -0.15 + i * 0.026 })), { kind: 'power', x: POWER_X }],
    color: 0x2e5b8a,
  },
  'switch-24': {
    id: 'switch-24', name: '스위치 24포트', sizeU: 1, price: 3000, incomePerSec: 0, watts: 60,
    // 12포트 두 줄
    ports: [
      ...Array.from({ length: 24 }, (_, i) => ({ kind: 'lan' as const, x: -0.2 + (i % 12) * 0.022, y: i < 12 ? 0.009 : -0.009 })),
      { kind: 'power', x: POWER_X },
    ],
    color: 0x2a6aa0,
  },
  pdu: {
    id: 'pdu', name: 'PDU', sizeU: 0, price: 1500, incomePerSec: 0, watts: 0, capacity: 3000,
    ports: [], color: 0x1a1c20,
  },
  // 가격 100원 (10-26 사용자 확정). 1U를 차지하는 대신 랙 가운데에도 선을 걸 수 있음
  'cable-manager': {
    id: 'cable-manager', name: '케이블 매니저', sizeU: 1, price: 100, incomePerSec: 0, watts: 0,
    ports: [], color: 0x24272c, rings: [-0.2, -0.1, 0, 0.1, 0.2],
  },
};

/** 같은 장비를 살 때마다 가격 배수 (방치형 표준 1.15보다 가파르게 — 인플레이션 억제). 케이블은 고정가 */
export const PRICE_GROWTH = 1.25;

/** 가정: GDD에 케이블 가격이 없어 첫 짐작값. 길이는 기본 2m (CABLE_DEFAULT_LENGTH) */
export const CABLES: Record<CableDefId, CableDef> = {
  'cable-lan': { id: 'cable-lan', name: '랜선 2m', kind: 'lan', price: 10 },
  'cable-power': { id: 'cable-power', name: '전원선 2m', kind: 'power', price: 15 },
};

/** 상점에 보이는 순서 */
export const SHOP_DEVICES: DeviceDefId[] = ['server-entry', 'server-web', 'server-storage', 'server-gpu', 'switch-24', 'pdu', 'cable-manager'];
export const SHOP_CABLES: CableDefId[] = ['cable-lan', 'cable-power'];

