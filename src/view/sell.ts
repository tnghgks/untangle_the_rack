import type * as THREE from 'three';
import type { Cable } from '../cable/cable';
import type { Device } from '../rack/device';
import { pickCable, pickDevice } from './pick';
import type { Room } from './room';

// 판매 도구 (10-25): 클릭하면 확인 없이 바로 판다. 케이블이 장비보다 앞 (뒷면에서 장비 위로 지나는 선을 고르기 쉽게).
// 전원 버튼·케이블 끌기·정보 카드보다 먼저 받아야 하므로 그것들보다 먼저 등록한다 (main.ts).

export interface SellToolDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  room: Room;
  /** 판매 도구가 골라져 있는지 */
  active(): boolean;
  sellDevice(device: Device): void;
  sellCable(cable: Cable): void;
}

export function createSellTool({ canvas, camera, room, active, sellDevice, sellCable }: SellToolDeps): void {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0 || !active()) return;
      const rect = canvas.getBoundingClientRect();
      const cable = pickCable(room.world.cables, camera, e.clientX, e.clientY, rect)?.cable;
      const device = cable ? null : pickDevice(room.devices, camera, e.clientX, e.clientY, rect);
      if (!cable && !device) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (cable) sellCable(cable);
      else if (device) sellDevice(device);
    },
    { capture: true },
  );
}
