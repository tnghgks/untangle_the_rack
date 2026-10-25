// 저장 데이터 형식과 localStorage 읽기·쓰기 (계획서 M5). Three.js에 의존하지 않는다 (헤드리스 테스트용).
// 장비·케이블을 다시 만드는 쪽은 Room(snapshot/restoreRoom). 여기엔 순수 데이터와 검증만.
// lastTick은 저장하지 않음 (4.3) — 불러온 시점부터 수익을 다시 쌓는다.

import { DEVICES, type DeviceDefId } from '../data/catalog';
import type { GameState } from './state';

export const SAVE_KEY = 'untangle_the_rack.save';
export const SAVE_VERSION = 1;

export interface SavedDevice {
  id: string;
  defId: DeviceDefId;
  /** 랙 장비: 아래쪽 U */
  u: number | null;
  /** PDU: 옆면 자리 */
  side: number | null;
  on: boolean;
  tripped: boolean;
}

export interface SavedCable {
  id: string;
  kind: 'lan' | 'power';
  color: number;
  /** 양 끝이 꽂힌 포트 id */
  ends: [string | null, string | null];
  /** 마디 좌표 xyz 이어 붙임, 소수 3자리 (mm) */
  nodes: number[];
  /** 줄이기 도구로 바꾼 길이 (m). 없으면 기본 길이 (P4 이전 저장) */
  length?: number;
}

export interface SaveData {
  v: number;
  money: number;
  bought: GameState['bought'];
  /** Room의 id 번호·상점 케이블 놓을 자리 카운터 */
  serial: number;
  spawned: number;
  devices: SavedDevice[];
  cables: SavedCable[];
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** 형식이 어긋나면 null (깨진 저장은 버리고 새로 시작) */
export function parseSave(text: string | null): SaveData | null {
  if (!text) return null;
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return null;
  }
  return isSave(d) ? d : null;
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const portId = (x: unknown) => x === null || typeof x === 'string';

function isSave(d: unknown): d is SaveData {
  if (typeof d !== 'object' || d === null) return false;
  const s = d as Record<string, unknown>;
  if (s.v !== SAVE_VERSION || !num(s.money) || !num(s.serial) || !num(s.spawned)) return false;
  if (typeof s.bought !== 'object' || s.bought === null) return false;
  if (!Array.isArray(s.devices) || !Array.isArray(s.cables)) return false;
  const devOk = s.devices.every((x: SavedDevice) =>
    typeof x?.id === 'string' && x.defId in DEVICES && (x.u === null || num(x.u)) && (x.side === null || num(x.side)) &&
    typeof x.on === 'boolean' && typeof x.tripped === 'boolean');
  const cabOk = s.cables.every((x: SavedCable) =>
    typeof x?.id === 'string' && (x.kind === 'lan' || x.kind === 'power') && num(x.color) &&
    Array.isArray(x.ends) && x.ends.length === 2 && x.ends.every(portId) &&
    Array.isArray(x.nodes) && x.nodes.length % 3 === 0 && x.nodes.every(num) &&
    (x.length === undefined || (num(x.length) && x.length > 0)));
  return devOk && cabOk;
}

/** localStorage가 막혀 있어도(사생활 모드 등) 게임은 계속 */
export function loadSave(storage: Pick<Storage, 'getItem'>): SaveData | null {
  try {
    return parseSave(storage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

export function writeSave(storage: Pick<Storage, 'setItem'>, data: SaveData): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
