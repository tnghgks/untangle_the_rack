// 케이블 캡슐(선분 + 반지름) ↔ 축 정렬 상자 밀어내기. Three.js에 의존하지 않는다.
// 노드 좌표는 Float32Array에 xyz로 붙어 있고, 인덱스는 노드 번호다.

export type Vec3 = [number, number, number];

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/** 상자가 [lo, hi] 범위(이미 여유를 더한 값)와 겹치는지 */
export function aabbOverlaps(box: Aabb, lo: Vec3, hi: Vec3): boolean {
  return (
    box.min[0] <= hi[0] && box.max[0] >= lo[0] &&
    box.min[1] <= hi[1] && box.max[1] >= lo[1] &&
    box.min[2] <= hi[2] && box.max[2] >= lo[2]
  );
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 선분 a–b(반지름 r)가 상자와 겹치면 밀어내고 true.
 * 보정은 선분 위 가장 가까운 점의 위치(t)에 따라 양 끝 노드에 나눠 준다 (wa·wb = 역질량, 0이면 고정).
 * 선분 중심이 상자 안까지 들어갔으면 이전 위치(prev)가 바깥이던 면으로 밀어 터널링을 막는다.
 */
export function collideSegment(
  pos: Float32Array,
  prev: Float32Array,
  a: number,
  b: number,
  wa: number,
  wb: number,
  r: number,
  box: Aabb,
): boolean {
  if (wa === 0 && wb === 0) return false;
  const ao = a * 3;
  const bo = b * 3;
  const ax = pos[ao], ay = pos[ao + 1], az = pos[ao + 2];
  const bx = pos[bo], by = pos[bo + 1], bz = pos[bo + 2];
  const { min, max } = box;

  // 빠른 거절: 선분 경계 상자 vs 상자
  if (
    (ax < bx ? ax : bx) > max[0] + r || (ax > bx ? ax : bx) < min[0] - r ||
    (ay < by ? ay : by) > max[1] + r || (ay > by ? ay : by) < min[1] - r ||
    (az < bz ? az : bz) > max[2] + r || (az > bz ? az : bz) < min[2] - r
  ) return false;

  // 선분 위 최근접 점: 상자 투영 ↔ 선분 투영을 번갈아 (둘 다 볼록이라 수렴)
  const ex = bx - ax, ey = by - ay, ez = bz - az;
  const ee = ex * ex + ey * ey + ez * ez;
  let t = 0.5;
  if (ee > 1e-12) {
    for (let k = 0; k < 3; k++) {
      const qx = clamp(ax + ex * t, min[0], max[0]);
      const qy = clamp(ay + ey * t, min[1], max[1]);
      const qz = clamp(az + ez * t, min[2], max[2]);
      t = clamp(((qx - ax) * ex + (qy - ay) * ey + (qz - az) * ez) / ee, 0, 1);
    }
  }
  const sx = ax + ex * t, sy = ay + ey * t, sz = az + ez * t;
  const dx = sx - clamp(sx, min[0], max[0]);
  const dy = sy - clamp(sy, min[1], max[1]);
  const dz = sz - clamp(sz, min[2], max[2]);
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return false;

  let nx = 0, ny = 0, nz = 0, pen: number;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    nx = dx / d; ny = dy / d; nz = dz / d;
    pen = r - d;
  } else {
    const s = [sx, sy, sz];
    const p = [
      prev[ao] + (prev[bo] - prev[ao]) * t,
      prev[ao + 1] + (prev[bo + 1] - prev[ao + 1]) * t,
      prev[ao + 2] + (prev[bo + 2] - prev[ao + 2]) * t,
    ];
    let axis = -1, dir = 0, best = 0;
    for (let k = 0; k < 3; k++) {
      const lo = min[k] - r, hi = max[k] + r;
      if (p[k] < lo && lo - p[k] > best) { best = lo - p[k]; axis = k; dir = -1; }
      else if (p[k] > hi && p[k] - hi > best) { best = p[k] - hi; axis = k; dir = 1; }
    }
    if (axis < 0) {
      // 이전에도 (모서리에 걸쳐) 살짝 안이었으면, 이전 점 기준으로 가장 얕은 면으로.
      // 현재 점 기준으로 고르면 얇은 판의 가운데를 넘은 순간 반대쪽으로 밀려 빠져나간다.
      best = Infinity;
      for (let k = 0; k < 3; k++) {
        const toLo = p[k] - (min[k] - r), toHi = max[k] + r - p[k];
        if (toLo < best) { best = toLo; axis = k; dir = -1; }
        if (toHi < best) { best = toHi; axis = k; dir = 1; }
      }
    }
    pen = dir < 0 ? s[axis] - (min[axis] - r) : max[axis] + r - s[axis];
    if (axis === 0) nx = dir; else if (axis === 1) ny = dir; else nz = dir;
  }

  const ca = (1 - t) * wa;
  const cb = t * wb;
  const denom = (1 - t) * ca + t * cb;
  if (denom < 1e-9) return false;
  const k = pen / denom;
  pos[ao] += nx * k * ca; pos[ao + 1] += ny * k * ca; pos[ao + 2] += nz * k * ca;
  pos[bo] += nx * k * cb; pos[bo + 1] += ny * k * cb; pos[bo + 2] += nz * k * cb;
  return true;
}
