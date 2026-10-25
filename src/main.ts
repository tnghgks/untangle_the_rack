import './styles.css';
import { startLoop } from './core/loop';
import { createStage } from './view/scene';
import { createCameraRig } from './view/camera';
import { createCableDrag } from './view/drag';
import { createShortenTool } from './view/shorten';
import { createStartRoom, restoreRoom } from './view/room';
import { createPowerButtons } from './view/powerButton';
import { createHover } from './view/hover';
import { createPlacement, type MovingDevice } from './rack/placement';
import { CABLES, DEVICES, START_MONEY, type DeviceDefId } from './data/catalog';
import { events, type ToolId } from './core/events';
import { createHud } from './ui/hud';
import { createShop } from './ui/shop';
import { createInspector } from './ui/inspector';
import { priceOf, spend, tick } from './game/economy';
import { boughtCount, createGameState } from './game/state';
import { loadSave, SAVE_KEY, SAVE_VERSION, writeSave, type SaveData } from './game/save';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;

// ?stress=50 → 케이블 50가닥 추가 (R로 다시 떨어뜨림, 저장 안 함), ?debug → 성능 표시, ?reset → 저장 지우고 새로 시작
const params = new URLSearchParams(location.search);
const stress = Math.max(0, Math.min(200, Number(params.get('stress')) || 0));
const debug = params.has('debug') || stress > 0;
// 저장소가 막힌 환경(사생활 모드 등)에선 localStorage 접근 자체가 throw → 저장 없이 진행
const store = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
if (params.has('reset')) store?.removeItem(SAVE_KEY);
const saved = stress > 0 || !store ? null : loadSave(store);

const stage = createStage(canvas);
const rig = createCameraRig(stage.camera, canvas);
// 새 게임: 저장을 지우고 다시 읽음. 떠날 때 저장(pagehide)이 지운 걸 되살리지 않게 막아 둠
let resetting = false;
const hud = createHud(hudRoot, () => {
  resetting = true;
  store?.removeItem(SAVE_KEY);
  location.reload();
}, !saved && stress === 0);
const room = saved ? restoreRoom(stage.scene, stage.rack, saved) : createStartRoom(stage.scene, stage.rack);
if (stress > 0) room.addStress(stress);
const state = createGameState(Date.now(), saved?.money ?? START_MONEY);
if (saved) state.bought = { ...saved.bought };
const price = (id: DeviceDefId) => priceOf(DEVICES[id], boughtCount(state, id));
/** 돈을 내고 구매 횟수를 셈. 모자라면 false */
const buy = (id: DeviceDefId): boolean => {
  if (!spend(state, price(id))) return false;
  state.bought[id] = boughtCount(state, id) + 1;
  return true;
};

// 입력 우선순위는 등록 순서: 장비 들기 → 전원 버튼 → 케이블 드래그(손)·줄이기 → 장비 정보 카드 → OrbitControls
const placement = createPlacement({
  canvas,
  camera: stage.camera,
  controls: rig.controls,
  room,
  // 장비 값은 끼울 때 낸다 (들기 취소 = 환불 필요 없음). 뺀 장비는 공짜로 다시 끼움
  install(id, u, moving) {
    if (!room.slots.canPlace(u, DEVICES[id].sizeU)) return moving && reinstall(id, moving.u, moving);
    if (moving) return reinstall(id, u, moving);
    if (!buy(id)) return flashHint('돈이 모자라요');
    room.install(id, u);
  },
  putBack(id, moving) {
    reinstall(id, moving.u, moving);
    flashHint(`${DEVICES[id].name}: 원래 자리(U${moving.u})로 돌려놨어요 · 케이블은 다시 꽂으세요`);
  },
});
/** 뺀 장비를 같은 id로 다시 끼움. 전원 버튼 상태는 뺄 때 그대로 */
const reinstall = (id: DeviceDefId, u: number, moving: MovingDevice) => {
  const device = room.install(id, u, moving.id);
  if (!device) return;
  if (moving.on) room.setPower(device, true);
  // device:installed의 "전원 버튼을 누르세요" 안내를 덮어씀 (켜진 채 뺐으면 이미 켜져 있음)
  flashHint(`${DEVICES[id].name}: U${u}에 다시 끼움 · 뒷면에서 케이블을 다시 꽂으세요${moving.on ? '' : ' · 앞면 전원 버튼을 누르세요'}`);
};
createPowerButtons(canvas, stage.camera, rig.controls, room);
let tool: ToolId = 'hand';
events.on('tool:set', (t) => {
  tool = t;
  if (t === 'shorten') flashHint('✂ 줄이기: 케이블을 누른 채 위로 끌면 줄고 아래로 끌면 늘어나요 · 1 손으로 돌아가기');
});
createCableDrag({
  canvas,
  camera: stage.camera,
  controls: rig.controls,
  world: room.world,
  enabled: () => tool === 'hand',
  showPortHint: room.showPortHint,
});
const shorten = createShortenTool({
  canvas,
  camera: stage.camera,
  controls: rig.controls,
  world: room.world,
  active: () => tool === 'shorten',
  show(text) {
    clearTimeout(hintTimer);
    hud.setHint(text ?? (placement.held ? holdHint(placement.held) : null));
  },
});
const inspector = createInspector({
  root: hudRoot,
  canvas,
  camera: stage.camera,
  controls: rig.controls,
  room,
  onRemove(device) {
    const moving: MovingDevice = { id: device.id, u: device.u!, on: device.on };
    if (!room.remove(device)) return;
    placement.hold(device.def.id, moving);
  },
});
createHover({ canvas, camera: stage.camera, room, busy: () => placement.held !== null, tool: () => tool });

let hintTimer = 0;
const flashHint = (text: string) => {
  hud.setHint(text);
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hud.setHint(placement.held ? holdHint(placement.held) : null), 3500);
};
const holdHint = (id: DeviceDefId) =>
  `${DEVICES[id].name} 들고 있음 · 랙의 빈 칸을 클릭해 끼우기 · Esc ${placement.moving ? '원래 자리로' : '취소'}`;
events.on('placement:held', (id) => {
  clearTimeout(hintTimer);
  hud.setHint(id ? holdHint(id as DeviceDefId) : null);
});
events.on('device:installed', () => flashHint('설치 완료 · 뒷면에서 전원선·랜선을 연결하고 앞면 전원 버튼을 누르세요'));

// 해금 없음: 막히는 건 자리 부족과 돈뿐
const shop = createShop(hud.shopPanel, {
  blockedReason: (def) =>
    def.sizeU === 0
      ? room.freePduSide() === null ? '옆면 자리 없음' : state.money < price(def.id) ? '돈 부족' : null
      : room.slots.firstFree(def.sizeU) === null ? `빈 ${def.sizeU}U 자리 없음` : state.money < price(def.id) ? '돈 부족' : null,
  cableBlocked: (id) => (state.money < CABLES[id].price ? '돈 부족' : null),
  priceOf: price,
  onBuyDevice: (id) => {
    if (id === 'pdu') {
      // 옆면은 고를 자리가 없어 바로 붙임
      if (room.freePduSide() === null || !buy(id)) return;
      room.addPdu();
      shop.refresh();
      flashHint('PDU를 랙 옆면에 달았어요 · 뒷면에서 콘센트에 전원선을 꽂으세요');
      return;
    }
    if (placement.held === id) placement.cancel();
    else placement.hold(id);
  },
  onBuyCable: (id) => {
    if (!spend(state, CABLES[id].price)) return;
    room.spawnCable(CABLES[id].kind);
    shop.refresh();
    flashHint(`${CABLES[id].name}이 랙 뒤 바닥에 놓였어요`);
  },
});
if (debug) Object.assign(window, { room, rig, stage, placement, state, inspector, save: () => save() });
if (stress > 0) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') room.redrop();
  });
}

// 수익: 밀린 시간을 먼저 직전 수익으로 더하고(부팅이 숨긴 탭에서 끝나도 그 시간은 안 셈) 가동 판정을 갱신
const advance = () => {
  const now = Date.now();
  tick(state, now, room.incomePerSec);
  room.updatePower(now);
};
// 배선·전원·설치가 바뀌면 바로 LED·수익에 반영
events.on('cable:plugged', advance);
events.on('cable:unplugged', advance);
events.on('device:power', advance);
events.on('device:installed', advance);
events.on('device:removed', advance);
events.on('pdu:reset', advance);
events.on('pdu:tripped', () => flashHint('PDU 과부하 · 차단기가 내려갔어요 · 부하를 줄이고 PDU를 클릭해 리셋하세요'));
// 렌더 루프가 멈추는 백그라운드 탭에서도 돌도록 (브라우저가 1초 이상으로 늦춰도 시간 차이로 계산)
window.setInterval(() => {
  advance();
  shop.refresh();
}, 250);
let lastRealMs = Date.now();

// 저장: 10초마다 + 탭을 숨기거나 떠날 때. 측정 모드(?stress)는 저장하지 않음
const save = () => {
  if (stress > 0 || !store || resetting) return;
  advance();
  const data: SaveData = { v: SAVE_VERSION, money: state.money, bought: { ...state.bought }, ...room.snapshot() };
  // 손에 든 뺀 장비는 원래 자리에 있는 것으로 저장 (그 칸은 다른 장비가 못 씀 — 한 번에 하나만 듦)
  const m = placement.moving;
  if (m && placement.held) data.devices.push({ id: m.id, defId: placement.held, u: m.u, side: null, on: m.on, tripped: false });
  writeSave(store, data);
};
window.setInterval(save, 10_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
window.addEventListener('pagehide', save);

/** 상단 바 경고: 차단된 PDU > 부하 85% 이상인 PDU (전체 합만 보면 한 PDU가 가득 찬 걸 놓침) */
const PDU_WARN_RATIO = 0.85;
const pduWarn = (): string | null => {
  const pdus = room.devices.filter((d) => d.power.role === 'pdu');
  if (pdus.some((d) => d.power.tripped)) return '⚠ PDU 차단됨';
  const worst = Math.max(0, ...pdus.map((d) => d.power.load / d.power.capacity));
  return worst >= PDU_WARN_RATIO ? `⚠ PDU 부하 ${Math.round(worst * 100)}%` : null;
};

const perf = { physMs: 0, frames: 0, fps: 0, since: performance.now() };

startLoop({
  update(dt) {
    const t0 = performance.now();
    shorten.update(dt);
    room.world.step(dt);
    perf.physMs += (performance.now() - t0 - perf.physMs) * 0.05;
  },
  render() {
    const now = Date.now();
    rig.update((now - lastRealMs) / 1000);
    placement.refresh();
    lastRealMs = now;
    advance();
    hud.setModel({ money: state.money, ...room.summary, incomePerSec: room.incomePerSec, airflow: room.airflow, pduWarn: pduWarn() });
    inspector.update();
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
