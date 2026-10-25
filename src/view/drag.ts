import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { endNode, type Cable, type CableEnd, type CableWorld } from '../cable/cable';
import type { Vec3 } from '../cable/collide';
import { MAGNET_RADIUS, SNAP_RADIUS, magnetize, nearestPortOnRay, plug, unplug, type PortHit } from '../cable/plug';
import { tieAt, untie } from '../cable/velcro';
import { pickCable } from './pick';

// 케이블 잡기·끌기. 잡은 점은 카메라를 바라보는 평면 위에서 움직이고, 휠로 그 평면을 앞뒤로 민다.
// 꽂힌 커넥터를 잡으면 뽑힌다 (클릭 = 뽑기). 반대쪽 끝이 꽂힌 채로 너무 당기면 그쪽이 빠진다. 벨크로에 걸려 있으면 벨크로가 먼저 떨어진다.

const WHEEL_STEP = 0.02;
const PULL_OUT = 0.15;

export interface CableDragDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: CableWorld;
  /** 손 도구일 때만 잡는다 (벨크로 도구는 velcro.ts) */
  enabled(): boolean;
  /** 끄는 커넥터 근처의 포트 표시 (null = 끔) */
  showPortHint(hit: PortHit | null): void;
}

interface Drag {
  cable: Cable;
  end: CableEnd | null;
  pointerId: number;
  hit: PortHit | null;
}

export function createCableDrag({ canvas, camera, controls, world, enabled, showPortHint }: CableDragDeps): void {
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  let drag: Drag | null = null;
  let lastX = 0;
  let lastY = 0;

  const handAt = (clientX: number, clientY: number): Vec3 | null => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;
    return [hitPoint.x, hitPoint.y, hitPoint.z];
  };

  const updateTarget = () => {
    if (!drag) return;
    const hand = handAt(lastX, lastY);
    if (!hand) return;
    const { cable } = drag;
    let target = hand;
    if (drag.end !== null) {
      const { origin, direction } = raycaster.ray;
      const hit = nearestPortOnRay(
        world.ports,
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
        [fwd.x, fwd.y, fwd.z],
        MAGNET_RADIUS,
        cable.kind,
      );
      drag.hit = hit;
      // 꽂을 수 있는 포트 위면 손을 포트 깊이로 옮겨 자석 보정
      if (hit?.ok) target = magnetize(hit.hand, hit);
      showPortHint(hit);
    }
    const { overshoot, anchor } = cable.rope.clampToReach(target);
    if (overshoot > PULL_OUT) {
      const t = tieAt(cable, anchor);
      if (t) untie(cable, t);
      else unplug(cable, anchor <= 1 ? 0 : 1);
    }
    cable.rope.setGrabTarget(target[0], target[1], target[2]);
  };

  const finish = (commit: boolean) => {
    if (!drag) return;
    const { cable, end, hit } = drag;
    cable.rope.release();
    if (commit && end !== null && hit?.ok && hit.dist <= SNAP_RADIUS) plug(cable, end, hit.port);
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    showPortHint(null);
    drag = null;
    controls.enabled = true;
    canvas.style.cursor = '';
  };

  // OrbitControls보다 먼저 판정해야 하므로 window 캡처 단계에서 받는다
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0 || drag || !enabled()) return;
      const pick = pickCable(world.cables, camera, e.clientX, e.clientY, canvas.getBoundingClientRect());
      if (!pick) return;
      controls.enabled = false;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 합성 이벤트 등 활성 포인터가 아니면 캡처 없이 진행
      }

      const { cable } = pick;
      let node = pick.node;
      if (pick.end !== null) {
        node = endNode(cable, pick.end);
        unplug(cable, pick.end);
      }
      const p = cable.rope.pos;
      hitPoint.set(p[node * 3], p[node * 3 + 1], p[node * 3 + 2]);
      camera.getWorldDirection(fwd);
      plane.setFromNormalAndCoplanarPoint(fwd, hitPoint);
      cable.rope.grab(node);
      drag = { cable, end: pick.end, pointerId: e.pointerId, hit: null };
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    },
    { capture: true },
  );

  canvas.addEventListener('pointermove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    // 잡기 전 커서·강조는 hover.ts
    if (drag) updateTarget();
  });

  canvas.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.pointerId) finish(true);
  });
  canvas.addEventListener('pointercancel', () => finish(false));

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!drag) return;
      e.preventDefault();
      // 평면을 카메라 시선 방향으로 밀거나 당김 (아래로 굴리면 멀어짐)
      plane.constant -= Math.sign(e.deltaY) * WHEEL_STEP;
      updateTarget();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') finish(false);
  });
}
