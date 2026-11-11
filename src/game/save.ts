// 저장 데이터 형식과 localStorage 읽기·쓰기 (계획서 M5). Three.js에 의존하지 않는다 (헤드리스 테스트용).
// 장비·케이블을 다시 만드는 쪽은 Room(snapshot/restoreRoom). 여기엔 순수 데이터와 검증만.
// lastTick은 저장하지 않음 (4.3) — 불러온 시점부터 수익을 다시 쌓는다.

import { DEVICES, type DeviceDefId } from '../data/catalog';
import type { RackPlace } from '../rack/floor';
import type { GameState } from './state';

export const SAVE_KEY = 'untangle_the_rack.save';
/** 2: 랙 목록(racks)·장비의 rack·케이블 length. 1은 읽을 때 위로 올림 */
export const SAVE_VERSION = 2;

/** 저장된 케이블 길이(m) 상한. 넘으면 그 선의 length만 버림 (깨진 값으로 거대한 로프를 만들지 않게) */
export const SAVE_MAX_CABLE_LENGTH = 50;

/** 세운 랙 하나: id와 바닥 칸 */
export type SavedRack = RackPlace;

export interface SavedDevice {
  id: string;
  defId: DeviceDefId;
  /** 랙 장비: 아래쪽 U */
  u: number | null;
  /** PDU: 옆면 자리 */
  side: number | null;
  on: boolean;
  tripped: boolean;
  /** 달린 랙 id */
  rack: string;
}

export interface SavedCable {
  id: string;
  kind: 'lan' | 'power';
  color: number;
  /** 양 끝이 꽂힌 포트 id */
  ends: [string | null, string | null];
  /** 마디 좌표 xyz 이어 붙임, 소수 3자리 (mm) */
  nodes: number[];
  /** 옛 저장(벨크로·고리 걸기 시절)의 묶은 마디. 더는 안 쓰고 검증만 통과시킨다 */
  ties?: { node: number; pos: [number, number, number]; hook?: string }[];
  /** 케이블 길이 (m). 없으면 CABLE_DEFAULT_LENGTH — 시작 배선·옛 저장 */
  length?: number;
  /** 상점에서 낸 값 (판매 환급용). 없으면 0 — 시작 배선·옛 저장 */
  paid?: number;
  /** 가이드 경로 (지나는 가이드 순서·묶은 가이드). 없으면 늘어진 로프 */
  route?: { guides: string[]; tied: string[] };
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
  /** 세운 랙과 칸 */
  racks: SavedRack[];
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
  if (typeof d === 'object' && d !== null && (d as { v?: unknown }).v === 1) d = upgradeV1(d as Record<string, unknown>);
  return isSave(d) ? sanitize(d) : null;
}

/** v1 → v2: 랙은 rack-1 하나(칸 0,0), 장비는 모두 rack-1. 형식 검사는 isSave가 이어서.
 *  v1의 케이블 length는 줄이기 도구 시절 값이라 버린다 (v2의 length는 진짜 길이) */
function upgradeV1(s: Record<string, unknown>): Record<string, unknown> {
  const devices = Array.isArray(s.devices)
    ? s.devices.map((x) => (typeof x === 'object' && x !== null ? { ...x, rack: 'rack-1' } : x))
    : s.devices;
  const cables = Array.isArray(s.cables)
    ? s.cables.map((x) => {
        if (typeof x !== 'object' || x === null) return x;
        const { length: _old, ...rest } = x as Record<string, unknown>;
        return rest;
      })
    : s.cables;
  return { ...s, v: SAVE_VERSION, racks: [{ id: 'rack-1', cell: [0, 0] }], devices, cables };
}

/** 선 하나의 route·ties·length가 틀리면 그 선에서만 지운다 (선은 그대로 불러옴, length는 기본 길이로) */
function sanitize(d: SaveData): SaveData {
  for (const c of d.cables) {
    if (c.length !== undefined && c.length > SAVE_MAX_CABLE_LENGTH) delete c.length;
    if (c.route !== undefined && !routeOk(c.route)) delete c.route;
    if (c.ties !== undefined && !(Array.isArray(c.ties) && c.ties.every(tieOk))) delete c.ties;
  }
  return d;
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const portId = (x: unknown) => x === null || typeof x === 'string';
const strings = (x: unknown) => Array.isArray(x) && x.every((v) => typeof v === 'string');
const routeOk = (r: unknown) => {
  const x = r as { guides?: unknown; tied?: unknown };
  return typeof r === 'object' && r !== null && strings(x.guides) && strings(x.tied);
};
const tieOk =(t: unknown) => {
  const r = t as { node?: unknown; pos?: unknown; hook?: unknown };
  return typeof t === 'object' && t !== null && Number.isInteger(r.node) && Array.isArray(r.pos) && r.pos.length === 3 && r.pos.every(num) &&
    (r.hook === undefined || typeof r.hook === 'string');
};

function isSave(d: unknown): d is SaveData {
  if (typeof d !== 'object' || d === null) return false;
  const s = d as Record<string, unknown>;
  if (s.v !== SAVE_VERSION || !num(s.money) || !num(s.serial) || !num(s.spawned)) return false;
  if (typeof s.bought !== 'object' || s.bought === null) return false;
  if (!Array.isArray(s.devices) || !Array.isArray(s.cables) || !Array.isArray(s.racks) || s.racks.length === 0) return false;
  const rackOk = s.racks.every((x: SavedRack) =>
    typeof x?.id === 'string' && Array.isArray(x.cell) && x.cell.length === 2 && x.cell.every((v) => Number.isInteger(v)));
  const devOk = s.devices.every((x: SavedDevice) =>
    typeof x?.id === 'string' && x.defId in DEVICES && (x.u === null || num(x.u)) && (x.side === null || num(x.side)) &&
    typeof x.on === 'boolean' && typeof x.tripped === 'boolean' && typeof x.rack === 'string');
  const cabOk = s.cables.every((x: SavedCable) =>
    typeof x?.id === 'string' && (x.kind === 'lan' || x.kind === 'power') && num(x.color) &&
    Array.isArray(x.ends) && x.ends.length === 2 && x.ends.every(portId) &&
    Array.isArray(x.nodes) && x.nodes.length % 3 === 0 && x.nodes.every(num) &&
    (x.length === undefined || (num(x.length) && x.length > 0)) &&
    (x.paid === undefined || (num(x.paid) && x.paid >= 0)));
  return rackOk && devOk && cabOk;
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
