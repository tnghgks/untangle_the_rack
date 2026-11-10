import * as THREE from 'three';
import type { Room } from './room';

// 랙 고르기: 랙 프레임·트레이를 클릭(끌지 않고)하면 그 랙을 고른다 → main이 카메라를 그 랙으로 옮김.
// 장비 클릭은 지금처럼 정보 카드만 (카메라 안 움직임) — 광선에 처음 맞은 게 장비면 고르지 않는다.
// 앞 단계(케이블 잡기·전원 버튼·장비 들기 등)가 받은 클릭(preventDefault)은 건드리지 않는다. 등록은 정보 카드 다음.

const CLICK_PX = 6;

export interface RackSelectDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  room: Room;
  /** 장비를 들었거나 랙 자리를 고르는 중 */
  busy(): boolean;
  /** 지금 고른 랙 id (같은 랙을 다시 누르면 무시) */
  selected(): string;
  select(rackId: string): void;
}

export function createRackSelect({ canvas, camera, room, busy, selected, select }: RackSelectDeps): void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number; id: number } | null = null;

  /** 커서 아래 처음 맞은 물체가 랙 메시(프레임·트레이)면 그 랙 id, 장비거나 없으면 null */
  const pickRack = (clientX: number, clientY: number): string | null => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const owner = new Map<THREE.Object3D, string | null>();
    for (const r of room.racks) owner.set(r.group, r.id);
    for (const d of room.devices) owner.set(d.group, null);
    const hit = raycaster.intersectObjects([...owner.keys()], true)[0];
    if (!hit) return null;
    // 맞은 메시에서 위로 올라가며 랙 그룹·장비 그룹을 찾음
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      if (owner.has(o)) return owner.get(o) ?? null;
    }
    return null;
  };

  window.addEventListener(
    'pointerdown',
    (e) => {
      down =
        e.target === canvas && e.button === 0 && !e.shiftKey && !e.defaultPrevented && !busy()
          ? { x: e.clientX, y: e.clientY, id: e.pointerId }
          : null;
    },
    { capture: true },
  );
  window.addEventListener('pointerup', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > CLICK_PX || busy()) return; // 카메라를 돌린 것
    const id = pickRack(e.clientX, e.clientY);
    if (id && id !== selected()) select(id);
  });
}
