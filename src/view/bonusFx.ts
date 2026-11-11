import * as THREE from 'three';
import { events } from '../core/events';
import { RACK, RACK_HEIGHT } from '../data/units';
import { playChime } from '../ui/sfx';
import type { Room } from './room';
import { createSparkles } from './sparkle';

// 보너스가 생기는 순간 연출: 전용 랙(띠 앞·뒤 양 끝과 가운데) · 짝(이어진 두 랜 포트)에 반짝 + 띵동. 글씨 없음.
// Room이 새로 생길 때만 이벤트를 내므로(불러오기·시작 방은 조용) 여기서는 듣기만 한다

export interface BonusFx {
  sync(dtSec: number): void;
}

export function createBonusFx({ scene, room }: { scene: THREE.Scene; room: Room }): BonusFx {
  const sparkles = createSparkles(scene);
  const p = new THREE.Vector3();

  events.on('rack:themed', ({ rackId }) => {
    const r = room.rack(rackId);
    if (!r) return;
    const [ox, oy, oz] = r.origin;
    const y = oy + RACK_HEIGHT - RACK.frame / 2;
    for (const z of [RACK.depth / 2, -RACK.depth / 2]) {
      for (const x of [-RACK.width / 3, 0, RACK.width / 3]) sparkles.at(p.set(ox + x, y, oz + z));
    }
    playChime();
  });

  events.on('server:paired', ({ a, b }) => {
    const da = room.device(a);
    if (!da) return;
    // a의 랜 포트 중 b로 이어진 것: 그 케이블 양 끝
    for (const port of da.ports) {
      const plugged = port.plugged;
      if (port.kind !== 'lan' || !plugged) continue;
      const other = plugged.cable.ends[plugged.end === 0 ? 1 : 0];
      if (!other || !room.device(b)?.ports.includes(other)) continue;
      sparkles.at(p.set(port.pos[0], port.pos[1], port.pos[2]));
      sparkles.at(p.set(other.pos[0], other.pos[1], other.pos[2]));
    }
    playChime();
  });

  return {
    sync(dtSec) {
      sparkles.sync(dtSec * 1000);
    },
  };
}
