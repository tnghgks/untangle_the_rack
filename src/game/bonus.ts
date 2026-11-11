// 보너스 판정 (전용 랙·짝 연결). Three.js에 의존하지 않는다 (헤드리스 테스트용).
// 매 프레임 불리므로 장비·포트 수에 비례하는 한 번씩만 훑는다.

import {
  PAIR_BONUS, PAIR_KINDS, THEME_BONUS, THEME_FULL_BONUS, THEME_MIN_SERVERS,
  type DeviceDefId, type ServerDefId,
} from '../data/catalog';
import type { PowerRole, PowerStatus } from './power';

export interface BonusDevice {
  id: string;
  defId: DeviceDefId;
  rack: string;
  role: PowerRole;
  status: PowerStatus;
  /** 랜 포트 id들 */
  lanPorts: readonly string[];
}

export interface RackTheme {
  kind: ServerDefId;
  /** 그 종류를 하나 더 끼울 자리가 없음 */
  full: boolean;
}

export interface Bonuses {
  /** 랙 id → 테마 (전용 아닌 랙은 키 없음) */
  themes: Map<string, RackTheme>;
  /** 장비 id → 짝 장비 id (양쪽 다 들어감) */
  pairs: Map<string, string>;
  /** 서버 id → 보너스 합 (없으면 키 없음) */
  ratio: Map<string, number>;
}

export const NO_BONUSES: Bonuses = { themes: new Map(), pairs: new Map(), ratio: new Map() };

/**
 * links: 포트 id → 케이블 반대쪽 포트 id (양방향). canFit: 그 랙에 그 종류 서버를 하나 더 끼울 자리가 있나.
 * 전용 판정은 꽂힘·가동과 상관없이 달린 서버로, 짝은 둘 다 가동 중일 때만
 */
export function computeBonuses(
  devices: readonly BonusDevice[],
  links: ReadonlyMap<string, string>,
  canFit: (rackId: string, kind: ServerDefId) => boolean,
): Bonuses {
  // 랙별 서버 종류: 하나뿐이면 그 종류, 섞이면 null
  const kinds = new Map<string, { kind: ServerDefId | null; n: number }>();
  const ownerOf = new Map<string, BonusDevice>();
  for (const d of devices) {
    if (d.role !== 'server') continue;
    for (const p of d.lanPorts) ownerOf.set(p, d);
    const k = kinds.get(d.rack);
    const kind = d.defId as ServerDefId;
    if (!k) kinds.set(d.rack, { kind, n: 1 });
    else {
      k.n++;
      if (k.kind !== kind) k.kind = null;
    }
  }
  const themes = new Map<string, RackTheme>();
  for (const [rack, { kind, n }] of kinds) {
    if (kind && n >= THEME_MIN_SERVERS) themes.set(rack, { kind, full: !canFit(rack, kind) });
  }

  const [ka, kb] = PAIR_KINDS;
  const pairs = new Map<string, string>();
  for (const d of devices) {
    if (d.role !== 'server' || d.status !== 'running' || d.defId !== ka) continue;
    for (const p of d.lanPorts) {
      const peerPort = links.get(p);
      const peer = peerPort === undefined ? undefined : ownerOf.get(peerPort);
      if (peer?.defId === kb && peer.status === 'running' && !pairs.has(peer.id)) {
        pairs.set(d.id, peer.id);
        pairs.set(peer.id, d.id);
        break;
      }
    }
  }

  const ratio = new Map<string, number>();
  for (const d of devices) {
    if (d.role !== 'server') continue;
    const t = themes.get(d.rack);
    const r = (t ? (t.full ? THEME_FULL_BONUS : THEME_BONUS) : 0) + (pairs.has(d.id) ? PAIR_BONUS : 0);
    if (r > 0) ratio.set(d.id, r);
  }
  return { themes, pairs, ratio };
}
