// Verlet 3D 로프. Three.js에 의존하지 않는다 (헤드리스 테스트용).
// 노드 좌표는 Float32Array에 xyz로 붙여 둔다. 바닥은 y = 0 평면.
//
// 한 스텝: 적분(감쇠·중력·이동 상한) → 반복 N회 [길이 → 굽힘 → 고정점 끈 → 충돌] → 마찰 → 잠자기 판정.
// 고정점(포트에 꽂힌 끝)과 잡은 점은 길이 제약에서 움직이지 않는다. 잡은 점은 충돌로만 밀린다.

import { aabbOverlaps, collideSegment, type Aabb, type Vec3 } from './collide';

export interface RopeConfig {
  segLen: number;
  radius: number;
  iterations: number;
  /** 스텝마다 속도에 곱함 */
  damping: number;
  /** 자유 노드의 스텝당 이동 상한 (터널링 방지) */
  maxMove: number;
  /** 잡은 점이 손을 따라가는 스텝당 상한 */
  grabMaxMove: number;
  gravity: number;
  /** 굽힘 강성 0..1 (i ↔ i+2 거리가 줄어드는 것에 저항) */
  bend: number;
  /** 접촉 중인 노드의 속도 감소 비율 0..1 */
  friction: number;
}

export const ROPE_DEFAULTS: RopeConfig = {
  segLen: 0.04,
  radius: 0.003,
  iterations: 8,
  damping: 0.98,
  maxMove: 0.02,
  grabMaxMove: 0.025,
  gravity: 9.8,
  bend: 0.2,
  friction: 0.35,
};

/** SLEEP_STEPS 스텝 동안 모든 노드가 SLEEP_DRIFT(m) 안에 머물면 잠든다 */
const SLEEP_DRIFT = 1e-3;
const SLEEP_STEPS = 45;
/** 접촉 노드가 스텝당 이보다 덜 움직이면 정지 마찰로 붙든다 (m) */
const STATIC_EPS = 4e-4;

export class Rope {
  readonly cfg: RopeConfig;
  readonly n: number;
  readonly pos: Float32Array;
  readonly prev: Float32Array;
  /** 노드가 이번 스텝에 무언가에 닿았는지 */
  readonly contact: Uint8Array;
  /** 모양이 바뀔 때마다 증가 — 렌더러가 갱신 여부를 판단 */
  version = 0;
  sleeping = false;

  private readonly start: Float32Array;
  private readonly sleepRef: Float32Array;
  private readonly pinned: Uint8Array;
  private readonly pinPos: Float32Array;
  private grabIndex = -1;
  private readonly grabTarget: Vec3 = [0, 0, 0];
  private calm = 0;
  private readonly anchors: number[] = [];
  private readonly near: Aabb[] = [];

  constructor(length: number, cfg: Partial<RopeConfig> = {}) {
    this.cfg = { ...ROPE_DEFAULTS, ...cfg };
    this.n = Math.max(2, Math.round(length / this.cfg.segLen) + 1);
    this.pos = new Float32Array(this.n * 3);
    this.prev = new Float32Array(this.n * 3);
    this.start = new Float32Array(this.n * 3);
    this.sleepRef = new Float32Array(this.n * 3);
    this.contact = new Uint8Array(this.n);
    this.pinned = new Uint8Array(this.n);
    this.pinPos = new Float32Array(this.n * 3);
  }

  get length(): number {
    return (this.n - 1) * this.cfg.segLen;
  }

  get grabbed(): number {
    return this.grabIndex;
  }

  /** 꺾은선을 따라 노드를 고르게 배치 (길이가 안 맞아도 물리가 몇 스텝 안에 펴 준다) */
  setFromPolyline(points: readonly Vec3[]): void {
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      const [ax, ay, az] = points[i - 1];
      const [bx, by, bz] = points[i];
      cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay, bz - az));
    }
    const total = cum[cum.length - 1];
    let seg = 0;
    for (let i = 0; i < this.n; i++) {
      const d = (total * i) / (this.n - 1);
      while (seg < points.length - 2 && cum[seg + 1] < d) seg++;
      const span = cum[seg + 1] - cum[seg];
      const u = span > 1e-9 ? (d - cum[seg]) / span : 0;
      const a = points[seg];
      const b = points[Math.min(seg + 1, points.length - 1)];
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] = a[k] + (b[k] - a[k]) * u;
    }
    this.prev.set(this.pos);
    this.wake();
  }

  pin(i: number, x: number, y: number, z: number): void {
    this.pinned[i] = 1;
    const o = i * 3;
    this.pinPos[o] = this.pos[o] = this.prev[o] = x;
    this.pinPos[o + 1] = this.pos[o + 1] = this.prev[o + 1] = y;
    this.pinPos[o + 2] = this.pos[o + 2] = this.prev[o + 2] = z;
    this.wake();
  }

  unpin(i: number): void {
    this.pinned[i] = 0;
    this.wake();
  }

  isPinned(i: number): boolean {
    return this.pinned[i] === 1;
  }

  grab(i: number): void {
    this.grabIndex = i;
    this.grabTarget[0] = this.pos[i * 3];
    this.grabTarget[1] = this.pos[i * 3 + 1];
    this.grabTarget[2] = this.pos[i * 3 + 2];
    this.wake();
  }

  setGrabTarget(x: number, y: number, z: number): void {
    this.grabTarget[0] = x;
    this.grabTarget[1] = y;
    this.grabTarget[2] = z;
  }

  release(): void {
    const g = this.grabIndex;
    if (g < 0) return;
    this.grabIndex = -1;
    // 놓는 순간 속도 0 — 던지기 없음
    this.prev.set(this.pos.subarray(g * 3, g * 3 + 3), g * 3);
    this.wake();
  }

  wake(): void {
    this.sleeping = false;
    this.calm = 0;
    this.version++;
  }

  /**
   * 잡은 점의 목표를 고정점에서 닿는 거리 안으로 줄인다 (늘어나지 않는 케이블).
   * 가장 많이 넘친 거리와 그 고정점 노드를 돌려준다 → 많이 당기면 뽑기 판정에 사용.
   */
  clampToReach(target: Vec3): { overshoot: number; anchor: number } {
    const g = this.grabIndex;
    let overshoot = 0;
    let anchor = -1;
    if (g < 0) return { overshoot, anchor };
    // 양쪽에서 가장 가까운 고정점만 — 그 너머 고정점(벨크로 건너 꽂힌 끝)은 당겨지지 않는다
    let lo = g, hi = g;
    while (lo >= 0 && !this.pinned[lo]) lo--;
    while (hi < this.n && !this.pinned[hi]) hi++;
    for (let pass = 0; pass < 2; pass++) {
      for (const k of [lo, hi]) {
        if (k < 0 || k >= this.n) continue;
        const reach = Math.abs(g - k) * this.cfg.segLen * 0.99;
        const o = k * 3;
        const dx = target[0] - this.pinPos[o];
        const dy = target[1] - this.pinPos[o + 1];
        const dz = target[2] - this.pinPos[o + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d <= reach) continue;
        if (pass === 0 && d - reach > overshoot) {
          overshoot = d - reach;
          anchor = k;
        }
        const s = reach / d;
        target[0] = this.pinPos[o] + dx * s;
        target[1] = this.pinPos[o + 1] + dy * s;
        target[2] = this.pinPos[o + 2] + dz * s;
      }
    }
    return { overshoot, anchor };
  }

  /** 현재 경로 길이 (테스트용) */
  pathLength(): number {
    let L = 0;
    const p = this.pos;
    for (let i = 1; i < this.n; i++) {
      const o = i * 3;
      L += Math.hypot(p[o] - p[o - 3], p[o + 1] - p[o - 2], p[o + 2] - p[o - 1]);
    }
    return L;
  }

  step(dt: number, boxes: readonly Aabb[]): void {
    if (this.sleeping) return;
    const { cfg, n, pos, prev, pinned, pinPos } = this;
    const g = this.grabIndex;
    this.start.set(pos);

    // 1. 적분
    const gdt2 = cfg.gravity * dt * dt;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      if (pinned[i]) {
        pos[o] = prev[o] = pinPos[o];
        pos[o + 1] = prev[o + 1] = pinPos[o + 1];
        pos[o + 2] = prev[o + 2] = pinPos[o + 2];
        continue;
      }
      if (i === g) {
        const dx = this.grabTarget[0] - pos[o];
        const dy = this.grabTarget[1] - pos[o + 1];
        const dz = this.grabTarget[2] - pos[o + 2];
        const d = Math.hypot(dx, dy, dz);
        const s = d > cfg.grabMaxMove ? cfg.grabMaxMove / d : 1;
        pos[o] += dx * s; pos[o + 1] += dy * s; pos[o + 2] += dz * s;
        prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
        continue;
      }
      let vx = (pos[o] - prev[o]) * cfg.damping;
      let vy = (pos[o + 1] - prev[o + 1]) * cfg.damping - gdt2;
      let vz = (pos[o + 2] - prev[o + 2]) * cfg.damping;
      const v = Math.hypot(vx, vy, vz);
      if (v > cfg.maxMove) {
        const s = cfg.maxMove / v;
        vx *= s; vy *= s; vz *= s;
      }
      prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
      pos[o] += vx; pos[o + 1] += vy; pos[o + 2] += vz;
    }

    // 2. 이번 스텝에 닿을 수 있는 상자만 추림 (브로드페이즈)
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const v = pos[i * 3 + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    const margin = cfg.radius + cfg.maxMove;
    for (let k = 0; k < 3; k++) { lo[k] -= margin; hi[k] += margin; }
    this.near.length = 0;
    for (const b of boxes) if (aabbOverlaps(b, lo, hi)) this.near.push(b);

    this.anchors.length = 0;
    for (let i = 0; i < n; i++) if (pinned[i] || i === g) this.anchors.push(i);

    // 3. 제약 반복
    this.contact.fill(0);
    for (let it = 0; it < cfg.iterations; it++) {
      // 굽힘을 먼저 풀고 길이를 나중에 — 반대 순서면 굽힘이 매 반복 케이블을 늘려 놓는다
      this.solveBend();
      this.solveLength((it & 1) === 1);
      this.solveTethers();
      this.solveCollisions();
    }

    // 4. 접촉 마찰: 닿은 노드의 속도를 줄이고, 아주 조금만 움직였으면 제자리에 붙든다 (정지 마찰).
    //    정지 마찰이 없으면 바닥에 감긴 고리가 제약끼리 밀고 당기며 끝없이 기어간다.
    const f = cfg.friction;
    const st = this.start;
    for (let i = 0; i < n; i++) {
      if (!this.contact[i] || pinned[i] || i === g) continue;
      const o = i * 3;
      const dx = pos[o] - st[o];
      const dy = pos[o + 1] - st[o + 1];
      const dz = pos[o + 2] - st[o + 2];
      if (dx * dx + dy * dy + dz * dz < STATIC_EPS * STATIC_EPS) {
        pos[o] = prev[o] = st[o];
        pos[o + 1] = prev[o + 1] = st[o + 1];
        pos[o + 2] = prev[o + 2] = st[o + 2];
      } else {
        prev[o] += (pos[o] - prev[o]) * f;
        prev[o + 1] += (pos[o + 1] - prev[o + 1]) * f;
        prev[o + 2] += (pos[o + 2] - prev[o + 2]) * f;
      }
    }
    // 마찰로 되돌린 점이 상자 안에 남지 않도록 충돌이 마지막 말을 한다
    this.solveCollisions();

    // 5. 잠자기: 창(SLEEP_STEPS) 시작 시점에서 SLEEP_DRIFT 이상 벗어난 노드가 없으면 잠든다.
    //    스텝마다 비교하면 모서리에 걸친 노드의 미세 떨림(±0.3mm) 때문에 영영 못 잔다.
    this.version++;
    if (g >= 0) {
      this.calm = 0;
      return;
    }
    const ref = this.sleepRef;
    let drift2 = 0;
    if (this.calm > 0) {
      for (let i = 0; i < n * 3; i += 3) {
        const dx = pos[i] - ref[i], dy = pos[i + 1] - ref[i + 1], dz = pos[i + 2] - ref[i + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > drift2) drift2 = d2;
      }
    }
    if (this.calm === 0 || drift2 > SLEEP_DRIFT * SLEEP_DRIFT) {
      ref.set(pos);
      this.calm = 1;
    } else if (++this.calm >= SLEEP_STEPS) {
      this.sleeping = true;
    }
  }

  private w(i: number): number {
    return this.pinned[i] || i === this.grabIndex ? 0 : 1;
  }

  private solveLength(reverse: boolean): void {
    const { pos, n } = this;
    const rest = this.cfg.segLen;
    for (let s = 0; s < n - 1; s++) {
      const i = reverse ? n - 2 - s : s;
      const j = i + 1;
      const wi = this.w(i), wj = this.w(j);
      if (wi + wj === 0) continue;
      const a = i * 3, b = j * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-9) continue;
      const k = (d - rest) / (d * (wi + wj));
      pos[a] += dx * k * wi; pos[a + 1] += dy * k * wi; pos[a + 2] += dz * k * wi;
      pos[b] -= dx * k * wj; pos[b + 1] -= dy * k * wj; pos[b + 2] -= dz * k * wj;
    }
  }

  private solveBend(): void {
    const { pos, n } = this;
    const rest = this.cfg.segLen * 2;
    const stiff = this.cfg.bend;
    for (let i = 0; i < n - 2; i++) {
      const j = i + 2;
      const wi = this.w(i), wj = this.w(j);
      if (wi + wj === 0) continue;
      const a = i * 3, b = j * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d >= rest || d < 1e-9) continue;
      const k = ((d - rest) / (d * (wi + wj))) * stiff;
      pos[a] += dx * k * wi; pos[a + 1] += dy * k * wi; pos[a + 2] += dz * k * wi;
      pos[b] -= dx * k * wj; pos[b + 1] -= dy * k * wj; pos[b + 2] -= dz * k * wj;
    }
  }

  /** 고정점에서 마디 수 × 간격보다 멀어지지 않게 (긴 사슬이 늘어지는 것 방지) */
  private solveTethers(): void {
    const { pos, n } = this;
    const seg = this.cfg.segLen;
    for (const k of this.anchors) {
      const ko = k * 3;
      const kx = pos[ko], ky = pos[ko + 1], kz = pos[ko + 2];
      for (let i = 0; i < n; i++) {
        if (this.w(i) === 0) continue;
        const o = i * 3;
        const max = Math.abs(i - k) * seg;
        const dx = pos[o] - kx, dy = pos[o + 1] - ky, dz = pos[o + 2] - kz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= max * max) continue;
        const s = max / Math.sqrt(d2);
        pos[o] = kx + dx * s; pos[o + 1] = ky + dy * s; pos[o + 2] = kz + dz * s;
      }
    }
  }

  private solveCollisions(): void {
    const { pos, prev, n, contact, pinned } = this;
    const r = this.cfg.radius;
    // 잡은 점도 충돌로는 밀린다 (손으로 장비를 뚫고 끌 수 없음)
    const cw = (i: number) => (pinned[i] ? 0 : 1);
    for (let i = 0; i < n; i++) {
      if (pos[i * 3 + 1] < r && !pinned[i]) {
        pos[i * 3 + 1] = r;
        contact[i] = 1;
      }
    }
    if (this.near.length === 0) return;
    for (let i = 0; i < n - 1; i++) {
      const wa = cw(i), wb = cw(i + 1);
      for (const box of this.near) {
        if (collideSegment(pos, prev, i, i + 1, wa, wb, r, box)) {
          contact[i] = 1;
          contact[i + 1] = 1;
        }
      }
    }
  }
}
