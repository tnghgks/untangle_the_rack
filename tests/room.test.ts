import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createStartRoom } from '../src/view/room';

describe('Room.remove', () => {
  it('엔트리 서버를 빼면 케이블이 뽑히고 포트·충돌 상자·칸이 비고, 같은 id로 다시 끼울 수 있음', () => {
    const room = createStartRoom(new THREE.Scene(), new THREE.Group());
    const entry = room.devices.find((d) => d.def.id === 'server-entry')!;
    const ports = room.world.ports.length;
    const boxes = room.world.colliders.length;
    expect(room.updatePower(Date.now()).incomePerSec).toBe(1);

    expect(room.remove(entry)).toBe(true);
    expect(room.device(entry.id)).toBeUndefined();
    expect(room.slots.occupant(3)).toBeNull();
    expect(room.world.ports.length).toBe(ports - entry.ports.length);
    expect(room.world.colliders.length).toBeLessThan(boxes);
    // 엔트리에 꽂혀 있던 전원선·랜선의 그 쪽 끝이 비어 있음
    const loose = room.world.cables.filter((c) => c.ends.some((e) => e === null));
    expect(loose.length).toBe(2);
    expect(room.updatePower(Date.now()).incomePerSec).toBe(0);

    const back = room.install('server-entry', 10, entry.id)!;
    expect(back.id).toBe(entry.id);
    expect(room.slots.occupant(10)).toBe(entry.id);
    expect(room.world.ports.length).toBe(ports);
    expect(room.world.colliders.length).toBe(boxes);
  });

  it('옆면 PDU는 못 뺌', () => {
    const room = createStartRoom(new THREE.Scene(), new THREE.Group());
    const pdu = room.devices.find((d) => d.def.id === 'pdu')!;
    expect(room.remove(pdu)).toBe(false);
    expect(room.device(pdu.id)).toBe(pdu);
  });
});
