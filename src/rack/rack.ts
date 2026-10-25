// 42U 슬롯 점유표. Three.js에 의존하지 않는다 (헤드리스 테스트용).
// U 번호는 1부터, 아래에서 위로. sizeU칸 장비는 u..u+sizeU-1을 차지한다.

import { RACK_UNITS } from '../data/units';

export class RackSlots {
  /** 인덱스 u-1 → 차지한 장비 id */
  private readonly slots: (string | null)[];

  constructor(readonly units = RACK_UNITS) {
    this.slots = new Array(units).fill(null);
  }

  occupant(u: number): string | null {
    return this.slots[u - 1] ?? null;
  }

  canPlace(u: number, sizeU: number): boolean {
    if (!Number.isInteger(u) || sizeU < 1 || u < 1 || u + sizeU - 1 > this.units) return false;
    for (let i = u; i < u + sizeU; i++) if (this.slots[i - 1] !== null) return false;
    return true;
  }

  place(id: string, u: number, sizeU: number): boolean {
    if (!this.canPlace(u, sizeU)) return false;
    for (let i = u; i < u + sizeU; i++) this.slots[i - 1] = id;
    return true;
  }

  remove(id: string): void {
    for (let i = 0; i < this.units; i++) if (this.slots[i] === id) this.slots[i] = null;
  }

  /** 아래에서부터 처음 들어갈 수 있는 칸 (없으면 null) */
  firstFree(sizeU: number): number | null {
    for (let u = 1; u + sizeU - 1 <= this.units; u++) if (this.canPlace(u, sizeU)) return u;
    return null;
  }

  /** 원하는 칸 want에 가장 가까운 들어갈 수 있는 칸 (같은 거리면 아래쪽) */
  nearestFree(want: number, sizeU: number): number | null {
    for (let d = 0; d < this.units; d++) {
      if (this.canPlace(want - d, sizeU)) return want - d;
      if (this.canPlace(want + d, sizeU)) return want + d;
    }
    return null;
  }

  get freeUnits(): number {
    return this.slots.filter((s) => s === null).length;
  }
}

/** 장비 중심 높이 y에 해당하는 아래쪽 U (랙 안으로 잘라냄) */
export function uFromCenterY(y: number, sizeU: number, baseHeight: number, uHeight: number, units = RACK_UNITS): number {
  const u = Math.round((y - baseHeight) / uHeight - sizeU / 2) + 1;
  return Math.min(units - sizeU + 1, Math.max(1, u));
}
