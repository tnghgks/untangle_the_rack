import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { endNode, type Cable, type CableEnd, type CableWorld } from '../cable/cable';
import type { Vec3 } from '../cable/collide';
import { MAGNET_RADIUS, SNAP_RADIUS, magnetize, nearestPortOnRay, plug, unplug, type PortHit } from '../cable/plug';
import { tieAt, untie } from '../cable/velcro';
import { pickCable } from './pick';

// 케이블 잡기·끌기. 잡은 점은 카메라를 바라보는 평면 위에서 움직이고, 휠로 그 평면을 앞뒤로 민다.
// 꽂힌 커넥터는 직접 잡고 UNPLUG_PX 넘게 끌어야 뽑힌다 (클릭만으론 안 뽑힘, 10-25). 케이블 가운데를 아무리 당겨도
// 포트는 안 빠지고 손이 닿는 거리에서 멈춘다. 벨크로에 걸려 있으면 세게 당길 때 벨크로만 떨어진다.
// 들고 다니기(carry): 상점에서 산 케이블의 한쪽 끝이 버튼을 안 눌러도 커서를 따라오고, 포트 위에서 클릭하면 꽂힌다.

const WHEEL_STEP = 0.02;
const PULL_OUT = 0.15;
/** 꽂힌 커넥터를 이만큼(px) 끌어야 뽑힘 */
const UNPLUG_PX = 6;
/** 들고 다니기 중인 끌기의 pointerId (실제 포인터가 아님) */
const CARRY = -1;

export interface CableDragDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: CableWorld;
  /** 손·벨크로 도구일 때 잡는다 */
  enabled(): boolean;
  /** 끄는 커넥터 근처의 포트 표시 (null = 끔) */
  showPortHint(hit: PortHit | null): void;
  /** 케이블 가운데를 끄는 동안 손이 붙을 자리 (벨크로 도구: 기둥). null이면 손 평면 그대로 */
  snap?(ray: THREE.Ray): Vec3 | null;
}

export interface CableDrag {
  /** 지금 끄는 케이블과 잡은 마디 */
  held(): { cable: Cable; node: number } | null;
  /** 꽂지 않고 놓기 (벨크로를 감은 뒤) */
  drop(): void;
  /** 케이블 끝을 들고 다니기 시작 (상점에서 산 직후) — 포트 위에서 클릭하면 꽂힘, 빈 곳 클릭·Esc는 내려놓기 */
  carry(cable: Cable, end: CableEnd): void;
}

interface Drag {
  cable: Cable;
  end: CableEnd | null;
  pointerId: number;
  hit: PortHit | null;
  /** 꽂힌 커넥터를 눌렀지만 아직 덜 끌었음 — 눌린 화면 위치 */
  pending: { x: number; y: number } | null;
}

export function createCableDrag({ canvas, camera, controls, world, enabled, showPortHint, snap }: CableDragDeps): CableDrag {
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
    if (!drag || drag.pending) return;
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
    } else {
      target = snap?.(raycaster.ray) ?? hand;
    }
    // 닿는 거리 밖으로는 못 끈다. 넘친 쪽이 벨크로면 세게 당긴 것으로 보고 떼어 냄 (포트는 안 뽑힘)
    const { overshoot, anchor } = cable.rope.clampToReach(target);
    if (overshoot > PULL_OUT) {
      const t = tieAt(cable, anchor);
      if (t) untie(cable, t);
    }
    cable.rope.setGrabTarget(target[0], target[1], target[2]);
  };

  const finish = (commit: boolean) => {
    if (!drag) return;
    const { cable, end, hit } = drag;
    cable.rope.release();
    if (commit && end !== null && hit?.ok && hit.dist <= SNAP_RADIUS) plug(cable, end, hit.port);
    if (drag.pointerId !== CARRY && canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    showPortHint(null);
    drag = null;
    controls.enabled = true;
    canvas.style.cursor = '';
  };

  /** 잡은 마디를 지나는 카메라 정면 평면 = 손이 움직일 평면 */
  const startPlane = (cable: Cable, node: number) => {
    const p = cable.rope.pos;
    hitPoint.set(p[node * 3], p[node * 3 + 1], p[node * 3 + 2]);
    camera.getWorldDirection(fwd);
    plane.setFromNormalAndCoplanarPoint(fwd, hitPoint);
  };

  // OrbitControls보다 먼저 판정해야 하므로 window 캡처 단계에서 받는다
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0) return;
      // 들고 다니는 중: 포트 위면 꽂고, 아니면 내려놓기
      if (drag?.pointerId === CARRY) {
        e.preventDefault();
        e.stopImmediatePropagation();
        lastX = e.clientX;
        lastY = e.clientY;
        updateTarget();
        const ok = drag.hit?.ok ?? false;
        if (ok && drag.hit) drag.hit.dist = 0; // 자석 반경 안이면 클릭으로 꽂힘
        finish(ok);
        return;
      }
      if (drag || !enabled()) return;
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
      const node = pick.end !== null ? endNode(cable, pick.end) : pick.node;
      startPlane(cable, node);
      // 꽂힌 커넥터는 끌기 시작할 때 뽑는다 (pointermove)
      const plugged = pick.end !== null && cable.ends[pick.end] !== null;
      if (!plugged) cable.rope.grab(node);
      drag = { cable, end: pick.end, pointerId: e.pointerId, hit: null, pending: plugged ? { x: e.clientX, y: e.clientY } : null };
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
    if (!drag || drag.pointerId === CARRY) return;
    const { pending, cable, end } = drag;
    if (pending && end !== null) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < UNPLUG_PX) return;
      unplug(cable, end);
      cable.rope.grab(endNode(cable, end));
      drag.pending = null;
    }
    updateTarget();
  });
  // 들고 다니기는 버튼 없이 커서만 따라옴 — 상점 패널 위를 지나도 계속
  window.addEventListener('pointermove', (e) => {
    if (drag?.pointerId !== CARRY) return;
    lastX = e.clientX;
    lastY = e.clientY;
    updateTarget();
  });

  canvas.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.pointerId) finish(true);
  });
  canvas.addEventListener('pointercancel', () => {
    if (drag?.pointerId !== CARRY) finish(false);
  });

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

  return {
    held: () => (drag && !drag.pending ? { cable: drag.cable, node: drag.cable.rope.grabbed } : null),
    drop: () => finish(false),
    carry(cable, end) {
      finish(false);
      const node = endNode(cable, end);
      startPlane(cable, node);
      cable.rope.grab(node);
      drag = { cable, end, pointerId: CARRY, hit: null, pending: null };
      controls.enabled = true; // 들고 다니는 동안에도 카메라는 돌릴 수 있게
      updateTarget();
    },
  };
}
