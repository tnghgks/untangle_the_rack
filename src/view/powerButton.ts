import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Room } from './room';

// 장비 앞면 전원 버튼 클릭 → 켜기/끄기. 케이블 잡기보다 우선한다 (버튼 위에 케이블이 걸쳐 있어도 버튼).

export function createPowerButtons(canvas: HTMLCanvasElement, camera: THREE.Camera, controls: OrbitControls, room: Room): void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0) return;
      const buttons = room.devices.flatMap((d) => (d.button ? [d.button] : []));
      const rect = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // 버튼이 작아서(지름 12mm) 레이캐스트는 버튼만 — 몸체에 가려진 경우는 뒷면에서 클릭한 것이라 무시
      const hit = raycaster.intersectObjects(buttons, false)[0];
      if (!hit || raycaster.ray.direction.z >= 0) return;
      const device = room.device(hit.object.userData.deviceId);
      if (!device) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      controls.enabled = true;
      room.setPower(device, !device.on);
    },
    { capture: true },
  );
}
