import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { pickPowerButton } from './pick';
import type { Room } from './room';

// 장비 앞면 전원 버튼 클릭 → 켜기/끄기. 케이블 잡기보다 우선한다 (버튼 위에 케이블이 걸쳐 있어도 버튼).
// 올렸을 때 강조·커서는 hover.ts

export function createPowerButtons(canvas: HTMLCanvasElement, camera: THREE.Camera, controls: OrbitControls, room: Room): void {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0) return;
      const device = pickPowerButton(room.devices, camera, e.clientX, e.clientY, canvas.getBoundingClientRect());
      if (!device) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      controls.enabled = true;
      room.setPower(device, !device.on);
    },
    { capture: true },
  );
}
