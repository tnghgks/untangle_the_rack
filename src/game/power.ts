// 가동 판정 (계획서 4.2). Three.js에 의존하지 않는다 (헤드리스 테스트용).
// running = on && 부팅 끝 && 전원 포트 ↔ 차단 안 된 PDU 콘센트 && (서버면) 랜 포트 ↔ running 스위치.
// 부팅은 "켜져 있고 전기가 들어온" 순간부터 BOOT_MS. 전기가 끊기면 처음부터 다시.

export const BOOT_MS = 3000;

export type PowerRole = 'server' | 'switch' | 'pdu';

/** 꺼짐 · 켰지만 전기 없음 · 부팅 중 · 부팅 끝났지만 네트워크 없음 · 가동 */
export type PowerStatus = 'off' | 'nopower' | 'booting' | 'nolink' | 'running';

export interface PowerPort {
  id: string;
  kind: 'lan' | 'power';
}

export interface PowerDevice {
  id: string;
  role: PowerRole;
  on: boolean;
  watts: number;
  incomePerSec: number;
  /** PDU 공급 용량 W */
  capacity: number;
  /** PDU 차단기 (M4) */
  tripped: boolean;
  /** PDU: 이 콘센트들에서 전기를 먹는 장비 소비 합 W */
  load: number;
  ports: PowerPort[];
  /** 부팅 시작 시각 (ms). 전기 없거나 꺼져 있으면 null */
  bootStart: number | null;
  status: PowerStatus;
}

export interface PowerSummary {
  incomePerSec: number;
  /** 켜져서 전기를 먹는 장비 소비 합 */
  powerUsed: number;
  powerCap: number;
}

/**
 * 장비 상태를 갱신한다 (bootStart·status 변경). links: 포트 id → 케이블 반대쪽 포트 id (양방향).
 * 매 틱 + 배선·전원 이벤트마다 부른다.
 */
export function updatePower(devices: readonly PowerDevice[], links: ReadonlyMap<string, string>, now: number): PowerSummary {
  const ownerOf = new Map<string, PowerDevice>();
  for (const d of devices) for (const p of d.ports) ownerOf.set(p.id, d);
  const peerDevice = (portId: string) => {
    const peer = links.get(portId);
    return peer === undefined ? undefined : ownerOf.get(peer);
  };

  /** 전기를 주는 PDU (없으면 undefined) */
  const supplier = (d: PowerDevice) => {
    for (const p of d.ports) {
      if (p.kind !== 'power') continue;
      const src = peerDevice(p.id);
      if (src?.role === 'pdu' && !src.tripped) return src;
    }
    return undefined;
  };

  // 1) 전기·부팅 (스위치·서버 공통)
  for (const d of devices) {
    if (d.role === 'pdu') {
      d.status = d.tripped ? 'nopower' : 'running';
      continue;
    }
    if (!d.on) {
      d.bootStart = null;
      d.status = 'off';
    } else if (!supplier(d)) {
      d.bootStart = null;
      d.status = 'nopower';
    } else {
      d.bootStart ??= now;
      d.status = now - d.bootStart >= BOOT_MS ? 'running' : 'booting';
    }
  }

  // 2) 서버는 running 스위치에 랜으로 이어져야 가동 (스위치끼리 연결은 MVP 밖)
  for (const d of devices) {
    if (d.role !== 'server' || d.status !== 'running') continue;
    const linked = d.ports.some((p) => p.kind === 'lan' && peerDevice(p.id)?.role === 'switch' && peerDevice(p.id)!.status === 'running');
    if (!linked) d.status = 'nolink';
  }

  const summary: PowerSummary = { incomePerSec: 0, powerUsed: 0, powerCap: 0 };
  for (const d of devices) if (d.role === 'pdu') d.load = 0;
  for (const d of devices) {
    if (d.role === 'pdu') {
      summary.powerCap += d.capacity;
      continue;
    }
    if (d.status === 'running') summary.incomePerSec += d.incomePerSec;
    if (d.status === 'booting' || d.status === 'nolink' || d.status === 'running') {
      summary.powerUsed += d.watts;
      supplier(d)!.load += d.watts;
    }
  }
  return summary;
}
