import * as THREE from 'three';
import type { Port, PortKind } from '../cable/cable';
import { RING_OUT, RING_R, ringsOf, SIDE_RING_X, SIDE_RING_Z, sideRingsOf } from '../cable/manager';
import type { Aabb, Vec3 } from '../cable/collide';
import { DEVICES, type DeviceDef, type DeviceDefId } from '../data/catalog';
import { RACK, RACK_HEIGHT, U, uBottomY } from '../data/units';
import type { PowerDevice, PowerStatus } from '../game/power';

// 장비 엔티티와 메시. 앞면: 전원 버튼·LED, 뒷면: 포트 소켓.
// 메시는 랙 그룹(원점 = 월드 원점)에 붙으므로 로컬 좌표 = 월드 좌표.

/** 장비 몸체 깊이 (앞뒤 레일 사이). 뒷면 z = -DEVICE_DEPTH / 2 */
export const DEVICE_DEPTH = RACK.depth - 0.16;
export const DEVICE_WIDTH = RACK.railWidth - 0.01;
export const BACK_Z = -DEVICE_DEPTH / 2 - 0.002;
const OUT: Vec3 = [0, 0, -1];

/** 뒷면에 붙어 지나가는 층 두께 — 이 안의 선은 배기를 막지 않는 것으로 본다 (thermal.ts) */
export const EXHAUST_GAP = 0.1;
export const EXHAUST_DEPTH = 0.6;
/** 배기 통로: 랙 폭 × 바닥~꼭대기, 뒷면에서 EXHAUST_GAP 떨어진 곳부터 EXHAUST_DEPTH만큼 뒤로 */
export const EXHAUST_ZONE: Aabb = {
  min: [-RACK.width / 2, 0, BACK_Z - EXHAUST_GAP - EXHAUST_DEPTH],
  max: [RACK.width / 2, RACK_HEIGHT, BACK_Z - EXHAUST_GAP],
};

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
export function createRackDevice(id: string, defId: DeviceDefId, u: number): { device: Device; sockets: Socket[] } {
  const def = DEVICES[defId];
  const g = new THREE.Group();
  g.name = id;
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
    return { device: { id, def, u, side: null, on: false, ports: [], group: g, body, button: null, led: null, backLed: null, power }, sockets: [] };
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
    const pos: Vec3 = [p.x, cy + (p.y ?? 0), BACK_Z];
    const port: Port = { id: `${id}:${p.kind}${i}`, kind: p.kind, pos, dir: OUT, plugged: null };
    const mesh = createSocketMesh(p.kind, pos);
    g.add(mesh);
    // 스위치 랜 포트는 전부 깜빡이면 시끄러움 → 서버 포트와 전원 포트만
    sockets.push({ port, mesh, blink: !(isSwitch && p.kind === 'lan') });
    return port;
  });

  const power = powerOf(id, def, isSwitch ? 'switch' : 'server', ports);
  const device: Device = { id, def, u, side: null, on: false, ports, group: g, body, button, led, backLed, power };
  return { device, sockets };
}

const RING_TUBE = 0.003;

/** 매니저 뒷면 고리: x축을 감싸는 고리(가로로 지나는 선이 통과) + 뒷면에서 나온 짧은 받침. 충돌 상자 아님 */
function addRings(g: THREE.Group, id: string, u: number, xs: readonly number[]): void {
  const ringGeo = new THREE.TorusGeometry(RING_R, RING_TUBE, 8, 24);
  const stemGeo = new THREE.BoxGeometry(0.006, 0.004, RING_OUT);
  for (const ring of ringsOf(id, u, xs)) {
    const [x, y, z] = ring.pos;
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x8a929c, metalness: 0.7, roughness: 0.35 }));
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.userData.ringId = ring.id;
    g.add(mesh);
    const stem = new THREE.Mesh(stemGeo, new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.6, roughness: 0.5 }));
    stem.position.set(x, y - RING_R, z + RING_OUT / 2);
    g.add(stem);
  }
}

/**
 * 세로 매니저: 기둥 바깥에 세운 기둥(몸체)과 y축을 감싸는 고리들(세로로 지나는 선이 통과). 자리는 왼쪽(0)·오른쪽(1).
 * 치수는 함수 안에서 — manager.ts와 순환 import라 모듈 맨 위에서 그 상수를 쓰면 브라우저에서 아직 정의 전
 */
export function createSideManager(id: string, side: number): { device: Device; sockets: Socket[] } {
  const L = { x: SIDE_RING_X + RING_R + 0.02, w: 0.016, d: 0.05, y0: 0.08, y1: RACK_HEIGHT - 0.1 };
  const def = DEVICES['cable-manager-v'];
  const sx = side === 0 ? -1 : 1;
  const g = new THREE.Group();
  g.name = id;
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
  const ringGeo = new THREE.TorusGeometry(RING_R, RING_TUBE, 8, 24);
  const stemLen = L.x - L.w / 2 - SIDE_RING_X - RING_R;
  const stemGeo = new THREE.BoxGeometry(stemLen, 0.004, 0.006);
  for (const ring of sideRingsOf(id, side, def.rings!)) {
    const [x, y, z] = ring.pos;
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x8a929c, metalness: 0.7, roughness: 0.35 }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.userData.ringId = ring.id;
    g.add(mesh);
    const stem = new THREE.Mesh(stemGeo, new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.6, roughness: 0.5 }));
    stem.position.set(x + sx * (RING_R + stemLen / 2), y, z);
    g.add(stem);
  }
  const power = powerOf(id, def, 'passive', []);
  return { device: { id, def, u: null, side, on: false, ports: [], group: g, body, button: null, led: null, backLed: null, power }, sockets: [] };
}

function powerOf(id: string, def: DeviceDef, role: PowerDevice['role'], ports: Port[]): PowerDevice {
  return {
    id, role, on: role === 'pdu', watts: def.watts, incomePerSec: def.incomePerSec, capacity: def.capacity ?? 0,
    tripped: false, load: 0, demand: 0, ports: ports.map((p) => ({ id: p.id, kind: p.kind })), bootStart: null, status: 'off', ready: false,
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

export function createPdu(id: string, side: number): { device: Device; sockets: Socket[] } {
  const L = PDU_LAYOUT;
  const x = side === 0 ? -L.x : L.x;
  const g = new THREE.Group();
  g.name = id;
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
    const pos: Vec3 = [x, y, outletZ];
    const port: Port = { id: `${id}:power${i}`, kind: 'power', pos, dir: OUT, plugged: null };
    const mesh = createSocketMesh('power', pos);
    g.add(mesh);
    sockets.push({ port, mesh, blink: false });
    ports.push(port);
  }
  const power = powerOf(id, DEVICES.pdu, 'pdu', ports);
  return { device: { id, def: DEVICES.pdu, u: null, side, on: true, ports, group: g, body, button: null, led, backLed: null, power }, sockets };
}
