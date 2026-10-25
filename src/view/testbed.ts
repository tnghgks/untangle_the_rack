import * as THREE from 'three';
import { createCable, CableWorld, type Cable, type Port, type PortKind } from '../cable/cable';
import { CableMesh } from '../cable/cableMesh';
import type { Vec3 } from '../cable/collide';
import { plug, type PortHit } from '../cable/plug';
import { createRng } from '../core/rng';
import { CABLE_DEFAULT_LENGTH, RACK, RACK_HEIGHT, U, uBottomY } from '../data/units';
import { collectColliders, createPlaceholderDevice, DEVICE_DEPTH } from './scene';

// M1 케이블 프로토타입용 무대: 자리표시 장비 몇 개 + 옆면 PDU + 케이블 5가닥.
// M2에서 catalog·rack 슬롯표로 대체한다. ?stress=50 이면 떨어지는 케이블을 더 얹는다.

const BACK_Z = -DEVICE_DEPTH / 2 - 0.002;
const OUT: Vec3 = [0, 0, -1];

const SOCKET: Record<PortKind, THREE.Vector3> = {
  lan: new THREE.Vector3(0.014, 0.012, 0.006),
  power: new THREE.Vector3(0.024, 0.016, 0.006),
};
const SOCKET_COLOR: Record<PortKind, number> = { lan: 0x23384d, power: 0x0c0d0f };
const LAN_COLORS = [0x2f7fd8, 0xe0b020, 0x38a860, 0xd0483c];
const POWER_COLOR = 0x23262b;

interface DeviceSpec {
  name: string;
  u: number;
  sizeU: number;
  color: number;
  ports: { kind: PortKind; x: number }[];
}

const DEVICES: DeviceSpec[] = [
  {
    name: 'switch-8', u: 1, sizeU: 1, color: 0x2e5b8a,
    ports: Array.from({ length: 8 }, (_, i) => ({ kind: 'lan' as const, x: -0.15 + i * 0.026 })),
  },
  { name: 'server-entry', u: 3, sizeU: 1, color: 0x4a4f57, ports: [{ kind: 'lan', x: -0.12 }, { kind: 'power', x: 0.19 }] },
  { name: 'server-web', u: 5, sizeU: 1, color: 0x55606b, ports: [{ kind: 'lan', x: -0.12 }, { kind: 'power', x: 0.19 }] },
  {
    name: 'storage-2u', u: 7, sizeU: 2, color: 0x3d4650,
    ports: [{ kind: 'lan', x: -0.12 }, { kind: 'lan', x: -0.09 }, { kind: 'power', x: 0.19 }],
  },
];

function polylineLength(pts: Vec3[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  }
  return L;
}

/** 옆면(왼쪽 바깥) 세로 PDU */
const PDU = { x: -RACK.width / 2 - 0.04, z: -0.43, w: 0.05, d: 0.04, y0: 0.15, y1: 1.45, outlets: 8 };

export interface Testbed {
  world: CableWorld;
  meshes: CableMesh[];
  showPortHint(hit: PortHit | null): void;
  /** 스트레스 케이블을 다시 떨어뜨림 (측정용) */
  redrop(): void;
  sync(): void;
}

export function createTestbed(scene: THREE.Scene, rack: THREE.Group, stress = 0): Testbed {
  const world = new CableWorld();
  const portMeshes = new Map<Port, THREE.Mesh>();

  const addPort = (id: string, kind: PortKind, pos: Vec3, parent: THREE.Object3D) => {
    const port: Port = { id, kind, pos, dir: OUT, plugged: null };
    world.ports.push(port);
    const s = SOCKET[kind];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(s.x, s.y, s.z),
      new THREE.MeshStandardMaterial({ color: SOCKET_COLOR[kind], roughness: 0.8 }),
    );
    // 소켓 바깥면이 포트 점에 오도록
    mesh.position.set(pos[0], pos[1], pos[2] + s.z / 2);
    parent.add(mesh);
    portMeshes.set(port, mesh);
    return port;
  };

  for (const d of DEVICES) {
    rack.add(createPlaceholderDevice(d.name, d.u, d.sizeU, d.color));
    const y = uBottomY(d.u) + (d.sizeU * U) / 2;
    d.ports.forEach((p, i) => addPort(`${d.name}:${p.kind}${i}`, p.kind, [p.x, y, BACK_Z], scene));
  }

  const pdu = new THREE.Mesh(
    new THREE.BoxGeometry(PDU.w, PDU.y1 - PDU.y0, PDU.d),
    new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.4, roughness: 0.6 }),
  );
  pdu.position.set(PDU.x, (PDU.y0 + PDU.y1) / 2, PDU.z);
  pdu.castShadow = true;
  pdu.userData.solid = true;
  scene.add(pdu);
  const outletZ = PDU.z - PDU.d / 2 - 0.002;
  for (let i = 0; i < PDU.outlets; i++) {
    const y = PDU.y0 + 0.1 + (i * (PDU.y1 - PDU.y0 - 0.2)) / (PDU.outlets - 1);
    addPort(`pdu:power${i}`, 'power', [PDU.x, y, outletZ], scene);
  }

  world.colliders.push(...collectColliders(rack), ...collectColliders(pdu));

  const port = (id: string) => world.ports.find((p) => p.id === id)!;
  const meshes: CableMesh[] = [];
  const addCable = (kind: PortKind, color: number): Cable => {
    const c = createCable(`cable-${world.cables.length}`, kind, CABLE_DEFAULT_LENGTH, color);
    world.cables.push(c);
    const m = new CableMesh(c);
    scene.add(m.group);
    meshes.push(m);
    return c;
  };

  // 시작 배선: 전원 PDU → 엔트리 서버, 랜 스위치 → 엔트리 서버
  const wire = (kind: PortKind, color: number, aId: string, bId: string) => {
    const c = addCable(kind, color);
    const a = port(aId), b = port(bId);
    const out = (p: Port, k: number): Vec3 => [p.pos[0] + p.dir[0] * k, p.pos[1] + p.dir[1] * k, p.pos[2] + p.dir[2] * k];
    const a1 = out(a, 0.08), b1 = out(b, 0.08);
    const y = c.rope.cfg.radius;
    const af: Vec3 = [a1[0], y, a1[2] - 0.1], bf: Vec3 = [b1[0], y, b1[2] - 0.1];
    // 남는 길이는 바닥에 U자로 깔아 처음부터 케이블 길이와 맞춘다 (눌린 채 시작하면 구겨짐)
    const used = polylineLength([a.pos, a1, af, bf, b1, b.pos]);
    const extra = Math.max(0, c.rope.length - used) / 2;
    c.rope.setFromPolyline([a.pos, a1, af, [af[0], y, af[2] - extra], [bf[0], y, bf[2] - extra], bf, b1, b.pos]);
    plug(c, 0, a);
    plug(c, 1, b);
  };
  wire('power', POWER_COLOR, 'pdu:power0', 'server-entry:power1');
  wire('lan', LAN_COLORS[0], 'switch-8:lan0', 'server-entry:lan0');

  // 바닥에 놓인 여분 케이블
  const loose = (kind: PortKind, color: number, z: number) => {
    const c = addCable(kind, color);
    const y = c.rope.cfg.radius;
    c.rope.setFromPolyline([[-1, y, z], [1, y, z]]);
  };
  loose('lan', LAN_COLORS[1], -0.75);
  loose('lan', LAN_COLORS[2], -0.9);
  loose('power', POWER_COLOR, -1.05);

  // 꽂힌 케이블이 늘어진 모양으로 자리 잡게 미리 돌림
  for (let i = 0; i < 240; i++) world.step(1 / 60);

  const stressCables: Cable[] = [];
  const rng = createRng(42);
  for (let i = 0; i < stress; i++) {
    const kind: PortKind = rng() < 0.7 ? 'lan' : 'power';
    stressCables.push(addCable(kind, kind === 'lan' ? LAN_COLORS[i % LAN_COLORS.length] : POWER_COLOR));
  }
  const redrop = () => {
    for (const c of stressCables) {
      const cx = (rng() - 0.5) * 0.8, cz = (rng() - 0.5) * 1.2;
      const y = RACK_HEIGHT + 0.1 + rng() * 0.8;
      const a = rng() * Math.PI;
      const h = c.rope.length / 2;
      c.rope.setFromPolyline([[cx - Math.cos(a) * h, y, cz - Math.sin(a) * h], [cx + Math.cos(a) * h, y, cz + Math.sin(a) * h]]);
    }
  };
  redrop();

  let hinted: THREE.Mesh | null = null;
  return {
    world,
    meshes,
    redrop,
    showPortHint(hit) {
      if (hinted) (hinted.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      hinted = hit ? portMeshes.get(hit.port) ?? null : null;
      if (hinted && hit) (hinted.material as THREE.MeshStandardMaterial).emissive.setHex(hit.ok ? 0x22cc55 : 0xcc3322);
    },
    sync() {
      for (const m of meshes) m.update();
    },
  };
}
