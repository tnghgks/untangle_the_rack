import * as THREE from 'three';
import type { ToolId } from '../core/events';
import { pickCable, pickDevice, pickPowerButton } from './pick';
import type { Room } from './room';

// 클릭할 수 있는 것 위에 커서를 올리면 은은하게 밝히고 커서를 바꾼다 (10-25 플레이 피드백).
// 고르는 순서는 클릭 우선순위와 같음: 전원 버튼 → 케이블 → 장비 몸체(정보 카드).
// 전원 버튼·장비는 pointer, 케이블은 grab (줄이기 도구면 ns-resize). 장비를 든 동안·드래그 중에는 강조를 끄고 커서는 그쪽에 맡긴다.

const GLOW: Record<Kind, number> = { button: 0x2c6640, cable: 0x3a3f48, device: 0x22344a };
const CURSOR: Record<Kind, string> = { button: 'pointer', cable: 'grab', device: 'pointer' };
const CABLE_CURSOR: Record<ToolId, string> = { hand: 'grab', shorten: 'ns-resize' };

type Kind = 'button' | 'cable' | 'device';

export interface HoverDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  room: Room;
  /** 장비를 든 동안 (설치 미리보기가 커서를 씀) */
  busy(): boolean;
  tool(): ToolId;
}

export function createHover({ canvas, camera, room, busy, tool }: HoverDeps): void {
  let lit: THREE.MeshStandardMaterial[] = [];

  const light = (mats: THREE.MeshStandardMaterial[], kind: Kind | null) => {
    for (const m of lit) m.emissive.setHex(0x000000);
    lit = mats;
    if (kind) for (const m of lit) m.emissive.setHex(GLOW[kind]);
  };

  const find = (x: number, y: number): [Kind, THREE.MeshStandardMaterial[]] | null => {
    const rect = canvas.getBoundingClientRect();
    const button = pickPowerButton(room.devices, camera, x, y, rect);
    if (button?.button) return ['button', [button.button.material as THREE.MeshStandardMaterial]];
    const cable = pickCable(room.world.cables, camera, x, y, rect)?.cable;
    const mesh = cable && room.meshes.find((m) => m.cable === cable);
    if (mesh) return ['cable', [mesh.tube.material, mesh.plugs[0].material] as THREE.MeshStandardMaterial[]];
    const device = pickDevice(room.devices, camera, x, y, rect);
    if (device) return ['device', [device.body.material as THREE.MeshStandardMaterial]];
    return null;
  };

  // 캔버스 pointermove(케이블 드래그·장비 들기) 뒤에 커서를 덮어쓰도록 window에서
  window.addEventListener('pointermove', (e) => {
    if (e.target !== canvas) return light([], null);
    if (busy() || e.buttons !== 0) return light([], null);
    const hit = find(e.clientX, e.clientY);
    light(hit?.[1] ?? [], hit?.[0] ?? null);
    canvas.style.cursor = !hit ? '' : hit[0] === 'cable' ? CABLE_CURSOR[tool()] : CURSOR[hit[0]];
  });
  canvas.addEventListener('pointerleave', () => light([], null));
}
