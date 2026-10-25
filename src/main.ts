import './styles.css';
import { startLoop } from './core/loop';
import { createStage } from './view/scene';
import { createCameraRig } from './view/camera';
import { createCableDrag } from './view/drag';
import { createStartRoom } from './view/room';
import { createPowerButtons } from './view/powerButton';
import { createPlacement } from './rack/placement';
import { CABLES, DEVICES, type DeviceDefId } from './data/catalog';
import { events } from './core/events';
import { createHud } from './ui/hud';
import { createShop } from './ui/shop';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;

// ?stress=50 → 케이블 50가닥 추가 (R로 다시 떨어뜨림), ?debug → 성능 표시
const params = new URLSearchParams(location.search);
const stress = Math.max(0, Math.min(200, Number(params.get('stress')) || 0));
const debug = params.has('debug') || stress > 0;

const stage = createStage(canvas);
const rig = createCameraRig(stage.camera, canvas);
const hud = createHud(hudRoot);
const room = createStartRoom(stage.scene, stage.rack);
if (stress > 0) room.addStress(stress);
// 입력 우선순위는 등록 순서: 장비 들기 → 전원 버튼 → 케이블 드래그 → OrbitControls
const placement = createPlacement({ canvas, camera: stage.camera, controls: rig.controls, room });
createPowerButtons(canvas, stage.camera, rig.controls, room);
createCableDrag({
  canvas,
  camera: stage.camera,
  controls: rig.controls,
  world: room.world,
  showPortHint: room.showPortHint,
});

let hintTimer = 0;
const flashHint = (text: string) => {
  hud.setHint(text);
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hud.setHint(placement.held ? holdHint(placement.held) : null), 3500);
};
const holdHint = (id: DeviceDefId) => `${DEVICES[id].name} 들고 있음 · 랙의 빈 칸을 클릭해 끼우기 · Esc 취소`;
events.on('placement:held', (id) => {
  clearTimeout(hintTimer);
  hud.setHint(id ? holdHint(id as DeviceDefId) : null);
});
events.on('device:installed', () => flashHint('설치 완료 · 뒷면에서 전원선·랜선을 연결하고 앞면 전원 버튼을 누르세요'));

// M3 전까지: 잠김은 catalog 해금 조건만 보고, 돈은 빠지지 않음. PDU 옆면 설치는 M4
createShop(hud.shopPanel, {
  isUnlocked: (def) => def.unlock === null && def.sizeU > 0,
  priceOf: (id) => DEVICES[id].price,
  onBuyDevice: (id) => (placement.held === id ? placement.cancel() : placement.hold(id)),
  onBuyCable: (id) => {
    room.spawnCable(CABLES[id].kind);
    flashHint(`${CABLES[id].name}이 랙 뒤 바닥에 놓였어요`);
  },
});
if (debug) Object.assign(window, { room, rig, stage, placement });
if (stress > 0) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') room.redrop();
  });
}

// M0: 더미 수치. M3에서 GameState·economy로 교체
const model = { money: 0, incomePerSec: 1, powerUsed: 180, powerCap: 3000 };
let lastRealMs = Date.now();

const perf = { physMs: 0, frames: 0, fps: 0, since: performance.now() };

startLoop({
  update(dt) {
    const t0 = performance.now();
    room.world.step(dt);
    perf.physMs += (performance.now() - t0 - perf.physMs) * 0.05;
  },
  render() {
    const now = Date.now();
    rig.update((now - lastRealMs) / 1000);
    model.money += model.incomePerSec * ((now - lastRealMs) / 1000);
    lastRealMs = now;
    hud.setModel(model);
    room.sync(performance.now() / 1000);
    stage.renderer.render(stage.scene, stage.camera);

    if (debug) {
      perf.frames++;
      const t = performance.now();
      if (t - perf.since >= 500) {
        perf.fps = (perf.frames * 1000) / (t - perf.since);
        perf.frames = 0;
        perf.since = t;
        const w = room.world;
        hud.setDebug(
          `${perf.fps.toFixed(0)} fps · 물리 ${perf.physMs.toFixed(2)} ms/스텝 · 케이블 ${w.awakeCount}/${w.cables.length} 움직이는 중` +
            (stress > 0 ? ' · R 다시 떨어뜨리기' : ''),
        );
      }
    }
  },
});
