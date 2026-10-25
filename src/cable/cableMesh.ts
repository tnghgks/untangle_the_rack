import * as THREE from 'three';
import { CABLE_RADIUS, type Cable } from './cable';
import type { Aabb } from './collide';
import { segmentInBox } from '../game/thermal';

// 튜브 메시: 노드 사이를 Catmull-Rom으로 SUBDIV 등분한 곡선에 링을 하나씩.
// 버퍼는 한 번 만들고 매 프레임 정점·법선만 다시 쓴다.
// 링 방향은 투영식 평행 이동(이전 법선을 접선에 수직으로 투영)이라 꼬이지 않는다.
// 배기 통로(zone)를 막는 토막은 주황빛으로 깜빡인다 (정리할 곳 표시, 10-25). 꽂힌 케이블만 — 공기 흐름 계산(thermal.ts)과 같은 기준.

const RADIAL = 8;
const SUBDIV = 3;
const COS = Array.from({ length: RADIAL }, (_, k) => Math.cos((k / RADIAL) * Math.PI * 2));
const SIN = Array.from({ length: RADIAL }, (_, k) => Math.sin((k / RADIAL) * Math.PI * 2));
const plugDir = new THREE.Vector3();

const CONNECTOR: Record<Cable['kind'], { size: THREE.Vector3; color: number }> = {
  lan: { size: new THREE.Vector3(0.012, 0.01, 0.022), color: 0xb8c0c8 },
  power: { size: new THREE.Vector3(0.02, 0.012, 0.03), color: 0x15171a },
};

const Z = new THREE.Vector3(0, 0, 1);
const HOT = new THREE.Color(0xff5a1f);
const mix = new THREE.Color();

export class CableMesh {
  readonly group = new THREE.Group();
  readonly tube: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  /** 곡선 위 링 중심점 */
  private readonly curve: Float32Array;
  private readonly rings: number;
  readonly plugs: [THREE.Mesh, THREE.Mesh];
  private synced = -1;
  private readonly colors: Float32Array;
  private readonly base: THREE.Color;
  /** 토막마다 배기 통로를 막는지 (모양이 바뀔 때 다시 셈) */
  private readonly blocked: Uint8Array;
  private anyBlocked = false;
  /** 색을 기본색으로 되돌려야 하는지 */
  private tinted = false;

  constructor(readonly cable: Cable, private readonly zone: Aabb | null = null) {
    const m = (this.rings = (cable.rope.n - 1) * SUBDIV + 1);
    this.curve = new Float32Array(m * 3);
    this.positions = new Float32Array(m * RADIAL * 3);
    this.normals = new Float32Array(m * RADIAL * 3);
    this.colors = new Float32Array(m * RADIAL * 3);
    this.blocked = new Uint8Array(cable.rope.n - 1);
    this.base = new THREE.Color(cable.color);
    this.paint(0);
    const index: number[] = [];
    for (let i = 0; i < m - 1; i++) {
      for (let k = 0; k < RADIAL; k++) {
        const a = i * RADIAL + k;
        const b = i * RADIAL + ((k + 1) % RADIAL);
        const c = a + RADIAL;
        const d = b + RADIAL;
        index.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(index);

    this.tube = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55 }));
    this.tube.castShadow = true;
    this.tube.frustumCulled = false; // 매 프레임 모양이 바뀌어 경계 구 계산을 생략
    this.group.add(this.tube);

    const spec = CONNECTOR[cable.kind];
    const plugGeo = new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z);
    plugGeo.translate(0, 0, spec.size.z / 2); // 원점 = 커넥터 앞 끝
    const plugMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.4 });
    this.plugs = [new THREE.Mesh(plugGeo, plugMat), new THREE.Mesh(plugGeo, plugMat)];
    for (const p of this.plugs) {
      p.castShadow = true;
      this.group.add(p);
    }
  }

  /** timeSec: 막힌 토막 깜빡임용 */
  update(timeSec = 0): void {
    const { rope } = this.cable;
    if (this.anyBlocked || this.tinted) this.paint(timeSec);
    if (rope.version === this.synced) return;
    this.synced = rope.version;
    this.findBlocked();

    const n = rope.n;
    this.buildCurve(rope.pos, n);
    const p = this.curve;
    const m = this.rings;
    const r = CABLE_RADIUS[this.cable.kind];
    const pos = this.positions;
    const nor = this.normals;
    // 매 프레임 수만 개 정점을 쓰므로 Vector3 없이 스칼라로 계산
    let qx = 0, qy = 1, qz = 0; // 링 기준 법선
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 1) * 3;
      const b = Math.min(m - 1, i + 1) * 3;
      let tx = p[b] - p[a], ty = p[b + 1] - p[a + 1], tz = p[b + 2] - p[a + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      if (i === 0 && Math.abs(ty) > 0.9) { qx = 1; qy = 0; }
      const dot = qx * tx + qy * ty + qz * tz;
      qx -= tx * dot; qy -= ty * dot; qz -= tz * dot;
      const ql = Math.hypot(qx, qy, qz) || 1;
      qx /= ql; qy /= ql; qz /= ql;
      const bx = ty * qz - tz * qy, by = tz * qx - tx * qz, bz = tx * qy - ty * qx;
      const cx = p[i * 3], cy = p[i * 3 + 1], cz = p[i * 3 + 2];
      for (let k = 0; k < RADIAL; k++) {
        const c = COS[k], s = SIN[k];
        const nx = qx * c + bx * s;
        const ny = qy * c + by * s;
        const nz = qz * c + bz * s;
        const o = (i * RADIAL + k) * 3;
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        pos[o] = cx + nx * r; pos[o + 1] = cy + ny * r; pos[o + 2] = cz + nz * r;
      }
    }
    const geo = this.tube.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;

    this.placePlug(this.plugs[0], 0, 1);
    this.placePlug(this.plugs[1], n - 1, n - 2);
  }

  private findBlocked(): void {
    const { zone, blocked, cable } = this;
    this.anyBlocked = false;
    if (!zone) return;
    const plugged = cable.ends[0] !== null || cable.ends[1] !== null;
    for (let i = 0; i < blocked.length; i++) {
      blocked[i] = plugged && segmentInBox(cable.rope.pos, i, zone) ? 1 : 0;
      if (blocked[i]) this.anyBlocked = true;
    }
  }

  /** 링마다 색: 막힌 토막은 기본색과 주황 사이를 오감 */
  private paint(timeSec: number): void {
    const { colors, blocked, base } = this;
    const hot = mix.copy(base).lerp(HOT, 0.45 + 0.4 * Math.sin(timeSec * 6));
    const last = blocked.length - 1;
    for (let i = 0; i < this.rings; i++) {
      const c = this.anyBlocked && blocked[Math.min(last, Math.floor(i / SUBDIV))] ? hot : base;
      for (let k = 0; k < RADIAL; k++) {
        const o = (i * RADIAL + k) * 3;
        colors[o] = c.r; colors[o + 1] = c.g; colors[o + 2] = c.b;
      }
    }
    this.tinted = this.anyBlocked;
    // 생성자에서 처음 칠할 땐 아직 메시가 없음
    const attr = this.tube?.geometry.getAttribute('color');
    if (attr) attr.needsUpdate = true;
  }

  /** 노드 i..i+1 구간을 이웃 노드까지 써서 Catmull-Rom으로 나눔 (양 끝은 끝 노드를 반복) */
  private buildCurve(p: Float32Array, n: number): void {
    const out = this.curve;
    let o = 0;
    for (let i = 0; i < n - 1; i++) {
      const i0 = Math.max(0, i - 1) * 3, i1 = i * 3, i2 = (i + 1) * 3, i3 = Math.min(n - 1, i + 2) * 3;
      for (let s = 0; s < SUBDIV; s++) {
        const u = s / SUBDIV, u2 = u * u, u3 = u2 * u;
        const w0 = -0.5 * u3 + u2 - 0.5 * u;
        const w1 = 1.5 * u3 - 2.5 * u2 + 1;
        const w2 = -1.5 * u3 + 2 * u2 + 0.5 * u;
        const w3 = 0.5 * u3 - 0.5 * u2;
        for (let k = 0; k < 3; k++) out[o++] = p[i0 + k] * w0 + p[i1 + k] * w1 + p[i2 + k] * w2 + p[i3 + k] * w3;
      }
    }
    const e = (n - 1) * 3;
    out[o] = p[e]; out[o + 1] = p[e + 1]; out[o + 2] = p[e + 2];
  }

  /** 커넥터 앞 끝을 끝 노드에 두고, 케이블 반대쪽(바깥)으로 향하게 */
  private placePlug(mesh: THREE.Mesh, end: number, inner: number): void {
    const p = this.cable.rope.pos;
    const e = end * 3, q = inner * 3;
    plugDir.set(p[q] - p[e], p[q + 1] - p[e + 1], p[q + 2] - p[e + 2]).normalize();
    mesh.position.set(p[e], p[e + 1], p[e + 2]);
    mesh.quaternion.setFromUnitVectors(Z, plugDir);
  }

  dispose(): void {
    this.tube.geometry.dispose();
    (this.tube.material as THREE.Material).dispose();
    this.plugs[0].geometry.dispose();
    (this.plugs[0].material as THREE.Material).dispose();
  }
}
