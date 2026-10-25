import * as THREE from 'three';
import type { Port, PortKind } from '../cable/cable';
import type { Vec3 } from '../cable/collide';
import { DEVICES, type DeviceDef, type DeviceDefId } from '../data/catalog';
import { RACK, U, uBottomY } from '../data/units';

// 장비 엔티티와 메시. 앞면: 전원 버튼·LED, 뒷면: 포트 소켓.
// 메시는 랙 그룹(원점 = 월드 원점)에 붙으므로 로컬 좌표 = 월드 좌표.

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
const LED_ON = 0x3cff7a;
const LED_OFF = 0x1d2a22;

export interface Device {
  id: string;
  def: DeviceDef;
  /** 아래쪽 U (PDU는 null) */
  u: number | null;
  on: boolean;
  ports: Port[];
  group: THREE.Group;
  button: THREE.Mesh | null;
  led: THREE.Mesh | null;
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
  g.add(body);

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

  const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), new THREE.MeshBasicMaterial({ color: LED_OFF }));
  led.position.set(DEVICE_WIDTH / 2 - 0.03, cy, frontZ + 0.002);
  g.add(led);

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

  const device: Device = { id, def, u, on: false, ports, group: g, button, led };
  return { device, sockets };
}

export function setDevicePower(device: Device, on: boolean): void {
  device.on = on;
  if (device.led) (device.led.material as THREE.MeshBasicMaterial).color.setHex(on ? LED_ON : LED_OFF);
  if (device.button) device.button.position.z = DEVICE_DEPTH / 2 + (on ? 0.001 : 0.002);
}

/** 옆면(왼쪽 바깥) 세로 PDU */
export const PDU_LAYOUT = { x: -RACK.width / 2 - 0.04, z: -0.43, w: 0.05, d: 0.04, y0: 0.15, y1: 1.45, outlets: 8 };

export function createPdu(id: string): { device: Device; sockets: Socket[] } {
  const L = PDU_LAYOUT;
  const g = new THREE.Group();
  g.name = id;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(L.w, L.y1 - L.y0, L.d),
    new THREE.MeshStandardMaterial({ color: DEVICES.pdu.color, metalness: 0.4, roughness: 0.6 }),
  );
  body.position.set(L.x, (L.y0 + L.y1) / 2, L.z);
  body.castShadow = true;
  body.userData.solid = true;
  g.add(body);

  const outletZ = L.z - L.d / 2 - 0.002;
  const sockets: Socket[] = [];
  const ports: Port[] = [];
  for (let i = 0; i < L.outlets; i++) {
    const y = L.y0 + 0.1 + (i * (L.y1 - L.y0 - 0.2)) / (L.outlets - 1);
    const pos: Vec3 = [L.x, y, outletZ];
    const port: Port = { id: `${id}:power${i}`, kind: 'power', pos, dir: OUT, plugged: null };
    const mesh = createSocketMesh('power', pos);
    g.add(mesh);
    sockets.push({ port, mesh, blink: false });
    ports.push(port);
  }
  return { device: { id, def: DEVICES.pdu, u: null, on: true, ports, group: g, button: null, led: null }, sockets };
}
