import * as THREE from 'three';
import type { Port, PortKind } from '../cable/cable';
import { RING_R, SIDE_RING_X, SIDE_RING_Z } from '../cable/manager';
import type { Vec3 } from '../cable/collide';
import { DEVICES, type DeviceDef, type DeviceDefId } from '../data/catalog';
import { RACK, RACK_HEIGHT, U, uBottomY } from '../data/units';
import type { PowerDevice, PowerStatus } from '../game/power';

// 장비 엔티티와 메시. 앞면: 전원 버튼·LED, 뒷면: 포트 소켓.
// 장비 그룹은 장면에 붙고 position = 랙 원점: 메시 좌표는 랙 기준, 포트 pos는 월드 좌표(원점을 더함).

/** 장비 몸체 깊이 (앞뒤 레일 사이). 뒷면 z = -DEVICE_DEPTH / 2 */
export const DEVICE_DEPTH = RACK.depth - 0.16;
export const DEVICE_WIDTH = RACK.railWidth - 0.01;
export const BACK_Z = -DEVICE_DEPTH / 2 - 0.002;
const OUT: Vec3 = [0, 0, -1];

const SOCKET: Record<PortKind, THREE.Vector3> = {
  lan: new THREE.Vector3(0.014, 0.012, 0.006),
  power: new THREE.Vector3(0.024, 0.016, 0.006),
};
const SOCKET_COLOR: Record<PortKind, number> = { lan: 0x23384d, power: 0x0c0d0f };
/**
 * 상태등 (앞·뒷면 같음): 가동 초록 · 부팅 노랑 · 켰는데 안 돎(전기·네트워크 없음) 빨강 ·
 * 꺼져 있지만 배선 완료(켜면 돎) 파랑 · 꺼져 있고 배선도 덜 됨 어둠. 가이드 패널에 같은 표가 있음
 */
export type LedState = 'running' | 'booting' | 'fault' | 'ready' | 'dark';
export const LED_COLOR: Record<LedState, number> = {
  running: 0x3cff7a,
  booting: 0xffc23c,
  fault: 0xff4a3c,
  ready: 0x3c9cff,
  dark: 0x1d2a22,
};
/** 뒷면 상태등 x: 랜 포트(왼쪽 묶음)와 전원 포트(오른쪽 끝) 사이 */
const BACK_LED_X = 0.13;

export interface Device {
  id: string;
  def: DeviceDef;
  /** 아래쪽 U (PDU는 null) */
  u: number | null;
  /** PDU 옆면 자리 (랙 장비는 null) */
  side: number | null;
  on: boolean;
  ports: Port[];
  group: THREE.Group;
  /** 장비 정보 카드용 레이캐스트 대상 */
  body: THREE.Mesh;
  button: THREE.Mesh | null;
  led: THREE.Mesh | null;
  /** 뒷면 상태등 (배선하면서 바로 보이게). PDU는 null */
  backLed: THREE.Mesh | null;
  /** 가동 판정 상태 (power.ts가 갱신) */
  power: PowerDevice;
  /** 달린 랙 id */
  rack: string;
  /** 그 랙 원점 (월드) = group.position */
  origin: Vec3;
}

/** 장비를 다는 랙: id와 원점 (월드) */
export interface DeviceSite {
  id: string;
  origin: Vec3;
}

/** 랙 기준 좌표 → 월드 좌표 */
function toWorld(site: DeviceSite, p: Vec3): Vec3 {
  return [p[0] + site.origin[0], p[1] + site.origin[1], p[2] + site.origin[2]];
}

/** 새 장비 그룹: 이름 = id, 랙 원점에 */
function siteGroup(id: string, site: DeviceSite): THREE.Group {
  const g = new THREE.Group();
  g.name = id;
  g.position.set(site.origin[0], site.origin[1], site.origin[2]);
  return g;
}

export interface Socket {
  port: Port;
  mesh: THREE.Mesh;
  /** 비어 있으면 깜빡여 배선할 곳을 알려 줌 */
  blink: boolean;
}

export function deviceHeight(sizeU: number): number {
  return sizeU * U - 0.002;
}

export function deviceCenterY(u: number, sizeU: number): number {
  return uBottomY(u) + deviceHeight(sizeU) / 2 + 0.001;
}

/** 소켓 바깥면이 포트 점에 오는 상자 */
export function createSocketMesh(kind: PortKind, pos: Vec3): THREE.Mesh {
  const s = SOCKET[kind];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(s.x, s.y, s.z),
    new THREE.MeshStandardMaterial({ color: SOCKET_COLOR[kind], roughness: 0.8 }),
  );
  mesh.position.set(pos[0], pos[1], pos[2] + s.z / 2);
  return mesh;
}

/** 랙에 끼우는 장비: 메시 + 뒷면 포트(월드 좌표) */
export function createRackDevice(id: string, defId: DeviceDefId, u: number, site: DeviceSite): { device: Device; sockets: Socket[] } {
  const def = DEVICES[defId];
  const g = siteGroup(id, site);
  const h = deviceHeight(def.sizeU);
  const cy = deviceCenterY(u, def.sizeU);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(DEVICE_WIDTH, h, DEVICE_DEPTH),
    new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.5, roughness: 0.5 }),
  );
  body.position.set(0, cy, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.solid = true; // 케이블 충돌 상자
  body.userData.deviceId = id;
  g.add(body);

  // 케이블 매니저: 전원 버튼·LED·포트 없이 뒷면 고리만
  if (def.rings) {
    addRings(g, id, u, def.rings);
    const power = powerOf(id, def, 'passive', []);
    return { device: { id, def, u, side: null, on: false, ports: [], group: g, body, button: null, led: null, backLed: null, power, rack: site.id, origin: site.origin }, sockets: [] };
  }

  // 앞면 전원 버튼 (왼쪽) + LED (오른쪽). 버튼은 몸체 밖으로 살짝 튀어나와 충돌 상자에 안 들어감
  const frontZ = DEVICE_DEPTH / 2;
  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.004, 16),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.4 }),
  );
  button.rotation.x = Math.PI / 2;
  button.position.set(-DEVICE_WIDTH / 2 + 0.03, cy, frontZ + 0.002);
  button.userData.deviceId = id;
  g.add(button);

  const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), new THREE.MeshBasicMaterial({ color: LED_COLOR.dark }));
  led.position.set(DEVICE_WIDTH / 2 - 0.03, cy, frontZ + 0.002);
  g.add(led);
  const backLed = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 8), new THREE.MeshBasicMaterial({ color: LED_COLOR.dark }));
  backLed.position.set(BACK_LED_X, cy, BACK_Z - 0.002);
  g.add(backLed);

  const isSwitch = def.id.startsWith('switch');
  const sockets: Socket[] = [];
  const ports = def.ports.map((p, i) => {
    const local: Vec3 = [p.x, cy + (p.y ?? 0), BACK_Z];
    const port: Port = { id: `${id}:${p.kind}${i}`, kind: p.kind, pos: toWorld(site, local), dir: OUT, rack: site.id, plugged: null };
    const mesh = createSocketMesh(p.kind, local);
    g.add(mesh);
    // 스위치 랜 포트는 전부 깜빡이면 시끄러움 → 서버 포트와 전원 포트만
    sockets.push({ port, mesh, blink: !(isSwitch && p.kind === 'lan') });
    return port;
  });

  const power = powerOf(id, def, isSwitch ? 'switch' : 'server', ports);
  const device: Device = { id, def, u, side: null, on: false, ports, group: g, body, button, led, backLed, power, rack: site.id, origin: site.origin };
  return { device, sockets };
}

/** 매니저 덕트 플라스틱 (장비마다 하나 — 가이드 위 밝힘이 장비별로 emissive를 바꿈) */
const ductMaterial = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: 0x1d2024, metalness: 0.15, roughness: 0.7 });
/** 핑거 덕트 치수 m: 손가락 폭·두께, 덕트 깊이, 손가락 줄의 중심 거리(가이드 축에서), 끝 걸쇠 */
const DUCT = { fingerW: 0.008, fingerT: 0.007, depth: 0.09, rowOff: 0.026, lip: 0.0065, lipT: 0.004 };

function ductPart(g: THREE.Group, id: string, mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number): void {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.userData.deviceId = id;
  g.add(m);
}

/**
 * 가로 매니저 뒷면: 핑거 덕트. 뒷판 + 위아래 두 줄의 빗살 손가락(랙 뒤 -z로 뻗음, 끝에 안쪽 걸쇠) + 양 끝 막이.
 * 선은 두 줄 사이 홈(고리 자리 = 가이드)을 따라 가고, 손가락 사이 틈으로 위아래로 드나듦.
 * 손가락은 고리 x 사이(±2.5cm)에 — 벨크로 띠가 고리 x에 감김. 충돌 상자 아님
 */
function addRings(g: THREE.Group, id: string, u: number, xs: readonly number[]): void {
  const mat = ductMaterial();
  const y = uBottomY(u) + U / 2;
  const z0 = BACK_Z - 0.002;
  const zMid = BACK_Z - DUCT.depth / 2;
  const zTip = BACK_Z - DUCT.depth + DUCT.lipT / 2;
  ductPart(g, id, mat, new THREE.BoxGeometry(DEVICE_WIDTH, U - 0.002, 0.004), 0, y, z0);
  const finger = new THREE.BoxGeometry(DUCT.fingerW, DUCT.fingerT, DUCT.depth);
  const lip = new THREE.BoxGeometry(DUCT.fingerW, DUCT.lip, DUCT.lipT);
  const lo = Math.min(...xs) - 0.025, hi = Math.max(...xs) + 0.025;
  for (let x = lo; x <= hi + 1e-9; x += 0.05) {
    for (const s of [1, -1]) {
      ductPart(g, id, mat, finger, x, y + s * DUCT.rowOff, zMid);
      ductPart(g, id, mat, lip, x, y + s * (DUCT.rowOff - DUCT.fingerT / 2 - DUCT.lip / 2), zTip);
    }
  }
  const cap = new THREE.BoxGeometry(0.004, 2 * DUCT.rowOff + DUCT.fingerT, DUCT.depth);
  for (const s of [1, -1]) ductPart(g, id, mat, cap, s * (DEVICE_WIDTH / 2 - 0.002), y, zMid);
}

/**
 * 세로 매니저: 기둥 바깥에 세운 기둥(몸체)과 y축을 감싸는 고리들(세로로 지나는 선이 통과). 자리는 왼쪽(0)·오른쪽(1).
 * 치수는 함수 안에서 — manager.ts와 순환 import라 모듈 맨 위에서 그 상수를 쓰면 브라우저에서 아직 정의 전
 */
export function createSideManager(id: string, side: number, site: DeviceSite): { device: Device; sockets: Socket[] } {
  const L = { x: SIDE_RING_X + RING_R + 0.02, w: 0.016, d: 2 * 0.026 + 0.012, y0: 0.08, y1: RACK_HEIGHT - 0.1 };
  const def = DEVICES['cable-manager-v'];
  const sx = side === 0 ? -1 : 1;
  const g = siteGroup(id, site);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(L.w, L.y1 - L.y0, L.d),
    new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.5, roughness: 0.5 }),
  );
  body.position.set(sx * L.x, (L.y0 + L.y1) / 2, SIDE_RING_Z);
  body.castShadow = true;
  body.userData.solid = true;
  body.userData.deviceId = id;
  g.add(body);
  // 위아래 팔로 랙 기둥에 붙인 모양 (충돌 상자 아님)
  const armLen = L.x - L.w / 2 - RACK.width / 2;
  for (const y of [L.y0 + 0.02, L.y1 - 0.02]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.6, roughness: 0.5 }));
    arm.position.set(sx * (RACK.width / 2 + armLen / 2), y, -(RACK.depth - RACK.frame) / 2);
    g.add(arm);
  }
  // 세로 핑거 덕트: 기둥(몸체)에서 랙 쪽(-sx)으로 뻗은 손가락 두 줄(앞뒤 z), 고리 높이 사이(±4cm)에. 선은 랙 쪽 틈으로 옆에서 드나듦
  const mat = ductMaterial();
  const inner = L.x - L.w / 2;
  const tip = SIDE_RING_X - 0.035;
  const len = inner - tip;
  const finger = new THREE.BoxGeometry(len, DUCT.fingerW, DUCT.fingerT);
  const lip = new THREE.BoxGeometry(DUCT.lipT, DUCT.fingerW, DUCT.lip);
  const ys = def.rings!;
  for (let y = ys[0]! - 0.04; y <= Math.min(ys[ys.length - 1]! + 0.04, L.y1 - 0.01) + 1e-9; y += 0.08) {
    for (const s of [1, -1]) {
      ductPart(g, id, mat, finger, sx * (tip + len / 2), y, SIDE_RING_Z + s * DUCT.rowOff);
      ductPart(g, id, mat, lip, sx * (tip + DUCT.lipT / 2), y, SIDE_RING_Z + s * (DUCT.rowOff - DUCT.fingerT / 2 - DUCT.lip / 2));
    }
  }
  const power = powerOf(id, def, 'passive', []);
  return { device: { id, def, u: null, side, on: false, ports: [], group: g, body, button: null, led: null, backLed: null, power, rack: site.id, origin: site.origin }, sockets: [] };
}

function powerOf(id: string, def: DeviceDef, role: PowerDevice['role'], ports: Port[]): PowerDevice {
  return {
    id, role, on: role === 'pdu', watts: def.watts, incomePerSec: def.incomePerSec, capacity: def.capacity ?? 0, saving: 0,
    tripped: false, load: 0, demand: 0, ports: ports.map((p) => ({ id: p.id, kind: p.kind })), bootStart: null, status: 'off', ready: false, uplink: false,
  };
}

/** 버튼 눌림. LED는 가동 판정 뒤 setDeviceLed로 */
export function setDevicePower(device: Device, on: boolean): void {
  device.on = on;
  device.power.on = on;
  if (device.button) device.button.position.z = DEVICE_DEPTH / 2 + (on ? 0.001 : 0.002);
}

export function ledState(p: PowerDevice): LedState {
  // PDU: 공급 중 초록, 차단 빨강
  if (p.role === 'pdu') return p.tripped ? 'fault' : 'running';
  if (!p.on) return p.ready ? 'ready' : 'dark';
  const byStatus: Record<PowerStatus, LedState> = { off: 'dark', nopower: 'fault', booting: 'booting', nolink: 'fault', running: 'running' };
  return byStatus[p.status];
}

/** 가동 판정 뒤 앞·뒷면 상태등 */
export function setDeviceLed(device: Device): void {
  const color = LED_COLOR[ledState(device.power)];
  for (const led of [device.led, device.backLed]) if (led) (led.material as THREE.MeshBasicMaterial).color.setHex(color);
}

/** 옆면 바깥 세로 PDU. 자리는 왼쪽(0)·오른쪽(1) 두 곳 */
export const PDU_SIDES = 2;
export const PDU_LAYOUT = { x: RACK.width / 2 + 0.04, z: -0.43, w: 0.05, d: 0.04, y0: 0.15, y1: 1.45, outlets: 8 };

export function createPdu(id: string, side: number, site: DeviceSite): { device: Device; sockets: Socket[] } {
  const L = PDU_LAYOUT;
  const x = side === 0 ? -L.x : L.x;
  const g = siteGroup(id, site);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(L.w, L.y1 - L.y0, L.d),
    new THREE.MeshStandardMaterial({ color: DEVICES.pdu.color, metalness: 0.4, roughness: 0.6 }),
  );
  body.position.set(x, (L.y0 + L.y1) / 2, L.z);
  body.castShadow = true;
  body.userData.solid = true;
  body.userData.deviceId = id;
  g.add(body);

  const outletZ = L.z - L.d / 2 - 0.002;
  // 차단기 표시등: 콘센트 줄 위, 뒷면 쪽
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), new THREE.MeshBasicMaterial({ color: LED_COLOR.running }));
  led.position.set(x, L.y1 - 0.03, outletZ);
  g.add(led);
  const sockets: Socket[] = [];
  const ports: Port[] = [];
  for (let i = 0; i < L.outlets; i++) {
    const y = L.y0 + 0.1 + (i * (L.y1 - L.y0 - 0.2)) / (L.outlets - 1);
    const local: Vec3 = [x, y, outletZ];
    const port: Port = { id: `${id}:power${i}`, kind: 'power', pos: toWorld(site, local), dir: OUT, rack: site.id, plugged: null };
    const mesh = createSocketMesh('power', local);
    g.add(mesh);
    sockets.push({ port, mesh, blink: false });
    ports.push(port);
  }
  const power = powerOf(id, DEVICES.pdu, 'pdu', ports);
  return { device: { id, def: DEVICES.pdu, u: null, side, on: true, ports, group: g, body, button: null, led, backLed: null, power, rack: site.id, origin: site.origin }, sockets };
}
