import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PortKind } from '../src/cable/cable';
import { guideOf } from '../src/cable/guide';
import { BOOT_MS } from '../src/game/power';
import type { Device } from '../src/rack/device';
import { createStartRoom } from '../src/view/room';

const port = (d: Device, kind: PortKind, nth = 0) => d.ports.filter((p) => p.kind === kind)[nth]!;
const freeLan = (d: Device) => d.ports.find((p) => p.kind === 'lan' && !p.plugged)!;

describe('랙 여러 대', () => {
  it('둘째 랙을 세우면 그 칸 원점에 장비·포트·가이드가 옮겨짐', () => {
    const room = createStartRoom(new THREE.Scene());
    expect(room.addRack([1, 0])!.id).toBe('rack-2');
    const sw1 = room.devices.find((d) => d.def.id === 'switch-8')!;
    const sw2 = room.install('switch-8', 1, 'rack-2')!;
    expect(sw2.ports[0]!.pos[0]).toBeCloseTo(sw1.ports[0]!.pos[0] + 1.0, 9);
    expect(sw2.ports[0]!.pos[1]).toBeCloseTo(sw1.ports[0]!.pos[1], 9);
    expect(sw2.ports[0]!.rack).toBe('rack-2');
    expect(sw1.ports[0]!.rack).toBe('rack-1');
    const g = guideOf(room.install('cable-manager', 5, 'rack-2')!)!;
    expect((g.a[0] + g.b[0]) / 2).toBeCloseTo(1.0, 9);
    expect(g.rack).toBe('rack-2');
  });

  it('같은 칸엔 두 번 못 세움', () => {
    const room = createStartRoom(new THREE.Scene());
    expect(room.addRack([0, 0])).toBeNull();
    expect(room.racks.length).toBe(1);
  });

  it('랙마다 슬롯이 따로', () => {
    const room = createStartRoom(new THREE.Scene());
    const r2 = room.addRack([1, 0])!;
    expect(room.rackAt([1, 0])).toBe(r2);
    expect(room.install('server-entry', 1)).toBeNull(); // 첫 랙 U1은 스위치
    const e2 = room.install('server-entry', 1, 'rack-2')!;
    expect(e2.rack).toBe('rack-2');
    expect(r2.slots.occupant(1)).toBe(e2.id);
    expect(room.racks[0].slots.occupant(1)).not.toBe(e2.id);
  });

  it('트레이가 가이드 목록에 랙마다 하나', () => {
    const room = createStartRoom(new THREE.Scene());
    room.addRack([1, 0]);
    expect(room.guides().filter((g) => g.tray).length).toBe(2);
  });

  it('둘째 랙 서버는 업링크 전엔 nolink, 첫 랙 스위치에 랜선을 이으면 가동', () => {
    const room = createStartRoom(new THREE.Scene());
    room.addRack([1, 0]);
    const sw1 = room.devices.find((d) => d.def.id === 'switch-8')!;
    const pdu2 = room.addPdu('rack-2')!;
    const sw2 = room.install('switch-8', 1, 'rack-2')!;
    const entry2 = room.install('server-entry', 3, 'rack-2')!;
    room.wire(pdu2.ports[0]!, port(sw2, 'power'));
    room.wire(pdu2.ports[1]!, port(entry2, 'power'));
    room.wire(port(sw2, 'lan'), port(entry2, 'lan'));
    room.setPower(sw2, true);
    room.setPower(entry2, true);
    const t0 = Date.now();
    room.updatePower(t0);
    expect(room.updatePower(t0 + BOOT_MS).incomePerSec).toBe(1);
    expect(entry2.power.status).toBe('nolink');

    room.wire(freeLan(sw1), freeLan(sw2));
    const t1 = t0 + BOOT_MS + 1;
    room.updatePower(t1);
    expect(room.updatePower(t1 + BOOT_MS).incomePerSec).toBe(2);
  });
});
