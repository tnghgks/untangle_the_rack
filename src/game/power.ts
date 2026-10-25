// 가동 판정 (계획서 4.2). Three.js에 의존하지 않는다 (헤드리스 테스트용).
// running = on && 부팅 끝 && 전원 포트 ↔ 차단 안 된 PDU 콘센트 && (서버면) 랜 포트 ↔ running 스위치.
// 부팅은 "켜져 있고 전기가 들어온" 순간부터 BOOT_MS. 전기가 끊기면 처음부터 다시.
// PDU 부하(켜져 전기를 먹는 장비 합)가 용량을 넘으면 차단기가 내려가 그 PDU에 꽂힌 장비 전부 전기 없음.
// 장비 전원 버튼 상태는 그대로 → 리셋(resetBreaker)하면 다시 부팅. 부하를 안 줄이고 리셋하면 또 내려감.

export const BOOT_MS = 3000;

/** passive: 전기·포트 없는 부품 (케이블 매니저) — 판정에서 빠짐 */
export type PowerRole = 'server' | 'switch' | 'pdu' | 'passive';

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
  /** PDU 차단기. 내려가면 resetBreaker로만 올림 */
  tripped: boolean;
  /** PDU: 이 콘센트들에서 전기를 먹는 장비 소비 합 W */
  load: number;
  /** PDU: 켜져 있는 꽂힌 장비 소비 합 W (차단돼도 셈 → 얼마나 줄여야 하는지) */
  demand: number;
  ports: PowerPort[];
  /** 부팅 시작 시각 (ms). 전기 없거나 꺼져 있으면 null */
  bootStart: number | null;
  status: PowerStatus;
  /** 배선 완료: 전원 포트 ↔ 차단 안 된 PDU, (서버면) 랜 포트 ↔ 스위치. 꺼져 있어도 셈 → "켜면 돈다" 표시용 */
  ready: boolean;
}

export interface PowerSummary {
  incomePerSec: number;
  /** 켜져서 전기를 먹는 장비 소비 합 */
  powerUsed: number;
  powerCap: number;
}

/**
 * 장비 상태를 갱신한다 (bootStart·status·load·tripped 변경). links: 포트 id → 케이블 반대쪽 포트 id (양방향).
 * 매 틱 + 배선·전원 이벤트마다 부른다.
 */
export function updatePower(devices: readonly PowerDevice[], links: ReadonlyMap<string, string>, now: number): PowerSummary {
  // 차단되면 그 PDU 장비들이 빠진 상태로 다시 계산 (PDU 수만큼이면 충분)
  for (;;) {
    const summary = evaluate(devices, links, now);
    const over = devices.filter((d) => d.role === 'pdu' && !d.tripped && d.load > d.capacity);
    if (over.length === 0) return summary;
    for (const d of over) d.tripped = true;
  }
}

export function resetBreaker(pdu: PowerDevice): void {
  pdu.tripped = false;
}

function evaluate(devices: readonly PowerDevice[], links: ReadonlyMap<string, string>, now: number): PowerSummary {
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
    if (d.role === 'passive') {
      d.status = 'off';
      d.ready = false;
      continue;
    }
    if (d.role === 'pdu') {
      d.status = d.tripped ? 'nopower' : 'running';
      d.ready = !d.tripped;
      continue;
    }
    d.ready = !!supplier(d) && (d.role !== 'server' || d.ports.some((p) => p.kind === 'lan' && peerDevice(p.id)?.role === 'switch'));
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
  for (const d of devices) if (d.role === 'pdu') d.load = d.demand = 0;
  for (const d of devices) {
    if (d.role === 'pdu' || !d.on) continue;
    const p = d.ports.find((x) => x.kind === 'power');
    const src = p && peerDevice(p.id);
    if (src?.role === 'pdu') src.demand += d.watts;
  }
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
