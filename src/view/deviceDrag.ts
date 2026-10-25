import type * as THREE from 'three';
import type { Device } from '../rack/device';
import { pickDevice } from './pick';
import type { Room } from './room';

// 장비 끌어 옮기기: 랙 장비 몸체를 누르고 DRAG_PX 넘게 끌면 랙에서 빼서 손에 든다 (placement.ts 끌기 모드).
// 놓은 칸이 비어 있으면 거기 끼우고, 아니면 원래 자리로. 끌지 않고 떼면 지금처럼 정보 카드 (inspector.ts).
// 케이블 잡기·전원 버튼·벨크로 등 앞 단계가 받은 클릭(preventDefault·stopImmediatePropagation)은 건드리지 않는다.
// Shift+왼쪽은 카메라 회전이라 제외. 옆면 PDU는 자리가 정해져 있어 제외.

const DRAG_PX = 6;

export interface DeviceDragDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  room: Room;
  /** 끌 수 있는 도구인지 (손·벨크로) */
  active(): boolean;
  /** 이미 장비를 들고 있음 */
  busy(): boolean;
  /** 끌기 시작: 랙에서 빼서 손에 듦 */
  start(device: Device): void;
}

export function createDeviceDrag({ canvas, camera, room, active, busy, start }: DeviceDragDeps): void {
  let down: { device: Device; x: number; y: number; id: number } | null = null;

  window.addEventListener(
    'pointerdown',
    (e) => {
      down = null;
      if (e.target !== canvas || e.button !== 0 || e.shiftKey || e.defaultPrevented || !active() || busy()) return;
      const device = pickDevice(room.devices, camera, e.clientX, e.clientY, canvas.getBoundingClientRect());
      if (device && device.u !== null) down = { device, x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    { capture: true },
  );
  window.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id || Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_PX) return;
    const { device } = down;
    down = null;
    start(device);
  });
  window.addEventListener('pointerup', () => (down = null));
}
