import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { hooksAt, ringsOf } from '../cable/manager';
import { events } from '../core/events';
import type { PowerStatus } from '../game/power';
import { DEVICE_DEPTH, DEVICE_WIDTH, PDU_LAYOUT, type Device } from '../rack/device';
import { pickDevice } from '../view/pick';
import type { Room } from '../view/room';
import { formatRate } from './format';

// 장비 정보 카드: 장비 몸체를 클릭(끌지 않고)하면 그 장비 옆 화면 위치에 뜬다.
// 케이블 잡기·전원 버튼·장비 들기가 먼저 처리한 클릭은 받지 않는다 (입력 우선순위 맨 뒤).

const CLICK_PX = 5;

const STATUS_TEXT: Record<PowerStatus, [string, string]> = {
  off: ['꺼짐', '앞면 전원 버튼을 누르세요'],
  nopower: ['전기 없음', '뒷면 전원 포트를 PDU 콘센트에 연결하세요 (차단된 PDU는 전기를 안 줌)'],
  booting: ['부팅 중', '잠시 후 가동'],
  nolink: ['네트워크 없음', '랜 포트를 켜진 스위치에 연결하세요 (빈 포트가 없으면 스위치 24포트)'],
  running: ['가동 중', ''],
};

export interface InspectorDeps {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  room: Room;
  /** 빼기 버튼: 랙에서 빼서 손에 듦 */
  onRemove(device: Device): void;
}

export interface Inspector {
  /** 매 프레임: 위치·내용 갱신 */
  update(): void;
  close(): void;
}

export function createInspector({ root, canvas, camera, controls, room, onRemove }: InspectorDeps): Inspector {
  const card = document.createElement('div');
  card.className = 'hud-panel hud-inspector';
  card.hidden = true;
  root.append(card);

  const anchor = new THREE.Vector3();
  let device: Device | null = null;
  let down: { x: number; y: number; id: number } | null = null;
  let lastHtml = '';

  card.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || !device) return;
    if (t.dataset.act === 'close') close();
    else if (t.dataset.act === 'power') room.setPower(device, !device.on);
    else if (t.dataset.act === 'reset') room.resetBreaker(device);
    else if (t.dataset.act === 'remove') onRemove(device);
  });

  const close = () => {
    device = null;
    card.hidden = true;
  };

  const pick = (x: number, y: number) => pickDevice(room.devices, camera, x, y, canvas.getBoundingClientRect());

  // 앞 단계(장비 들기·전원 버튼)가 잡으면 stopImmediatePropagation으로 여기까지 안 오고,
  // 케이블을 잡으면 controls.enabled가 꺼져 있다
  window.addEventListener(
    'pointerdown',
    (e) => {
      down = e.target === canvas && e.button === 0 && controls.enabled ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
    },
    { capture: true },
  );
  window.addEventListener('pointerup', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > CLICK_PX) return; // 카메라를 돌린 것
    const d = pick(e.clientX, e.clientY);
    if (d) {
      device = d;
      card.hidden = false;
      update();
    } else close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  events.on('placement:held', (id) => {
    if (id) close();
  });

  /** 케이블 매니저: 전기·포트 없이 고리만 */
  const renderManager = (d: Device): string => {
    const rings = d.u !== null && d.def.rings ? ringsOf(d.id, d.u, d.def.rings) : [];
    const hooked = rings.reduce((n, r) => n + hooksAt(room.world.cables, r.id).length, 0);
    return `
      <div class="head"><b>${d.def.name}</b> <small>U${d.u}</small><button class="x" data-act="close" aria-label="닫기">×</button></div>
      <div class="help">뒷면 고리에 케이블을 끌어 대고 Space로 걸기 · 고리를 클릭하면 빼기</div>
      <div class="line">고리 ${rings.length}개 · 걸린 선 ${hooked}가닥</div>
      <div class="acts"><button class="act" data-act="remove" title="랙에서 빼서 다른 칸에 끼움 (걸린 선은 풀림)">빼기</button></div>
    `;
  };

  const render = (d: Device): string => {
    if (d.def.rings) return renderManager(d);
    const p = d.power;
    const [label, baseHelp] = STATUS_TEXT[p.status];
    // 꺼져 있을 때: 배선이 끝났는지에 따라 (뒷면 파란 등 = 배선 완료)
    const help = p.status === 'off' ? (p.ready ? '배선 완료 · 앞면 전원 버튼을 누르면 가동' : '뒷면 전원선·랜선을 연결하고 앞면 전원 버튼을 누르세요') : baseHelp;
    const where = d.u !== null ? `U${d.u}${d.def.sizeU > 1 ? `–${d.u + d.def.sizeU - 1}` : ''}` : '옆면';
    const used = (kind: 'lan' | 'power') => {
      const ports = d.ports.filter((x) => x.kind === kind);
      return ports.length ? `${ports.filter((x) => x.plugged).length}/${ports.length}` : null;
    };
    const lines: string[] = [];
    if (p.role === 'pdu') {
      lines.push(`부하 ${(p.tripped ? p.demand : p.load).toLocaleString('ko-KR')} / ${p.capacity.toLocaleString('ko-KR')}W`);
      lines.push(`콘센트 ${used('power')} 사용`);
    } else {
      if (d.def.incomePerSec > 0) lines.push(`수익 ${formatRate(d.def.incomePerSec)}${p.status === 'running' ? '' : ' (멈춤)'}`);
      lines.push(`전력 ${d.def.watts}W`);
      const lan = used('lan');
      lines.push(`포트 ${lan ? `랜 ${lan} · ` : ''}전원 ${used('power')}`);
    }
    return `
      <div class="head"><b>${d.def.name}</b> <small>${where}</small><button class="x" data-act="close" aria-label="닫기">×</button></div>
      <div class="status s-${p.role === 'pdu' ? (p.tripped ? 'nolink' : 'running') : p.status}">● ${p.role === 'pdu' ? (p.tripped ? '차단됨 (과부하)' : '공급 중') : label}</div>
      ${p.role === 'pdu' && p.tripped ? '<div class="help">장비를 끄거나 전원선을 다른 PDU로 옮긴 뒤 리셋하세요</div>' : ''}
      ${help && p.role !== 'pdu' ? `<div class="help">${help}</div>` : ''}
      ${lines.map((l) => `<div class="line">${l}</div>`).join('')}
      ${p.role !== 'pdu' ? `<div class="acts"><button class="act" data-act="power">${d.on ? '끄기' : '켜기'}</button><button class="act" data-act="remove" title="랙에서 빼서 다른 칸에 끼움 (케이블은 뽑힘)">빼기</button></div>` : ''}
      ${p.role === 'pdu' && p.tripped ? '<button class="act" data-act="reset">차단기 리셋</button>' : ''}
    `;
  };

  const update = () => {
    if (!device) return;
    const html = render(device);
    if (html !== lastHtml) {
      card.innerHTML = html;
      lastHtml = html;
    }
    // 카메라 쪽 면의 오른쪽 모서리 옆에 붙임
    const front = camera.position.z >= 0;
    if (device.u === null) {
      const x = device.body.position.x;
      anchor.set(x + Math.sign(x) * PDU_LAYOUT.w, device.body.position.y, PDU_LAYOUT.z);
    } else {
      const right = front ? DEVICE_WIDTH / 2 : -DEVICE_WIDTH / 2;
      anchor.set(right, device.body.position.y, front ? DEVICE_DEPTH / 2 : -DEVICE_DEPTH / 2);
    }
    anchor.project(camera);
    const rect = canvas.getBoundingClientRect();
    const sx = ((anchor.x + 1) / 2) * rect.width;
    const sy = ((1 - anchor.y) / 2) * rect.height;
    const w = card.offsetWidth, h = card.offsetHeight;
    const left = Math.min(rect.width - w - 8, Math.max(8, sx + 14));
    const top = Math.min(rect.height - h - 70, Math.max(64, sy - h / 2));
    card.style.transform = `translate(${left}px, ${top}px)`;
  };

  return { update, close };
}
