import './styles.css';
import { startLoop } from './core/loop';
import { createStage } from './view/scene';
import { createCameraRig } from './view/camera';
import { createCableDrag } from './view/drag';
import { createTestbed } from './view/testbed';
import { createHud } from './ui/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;

// ?stress=50 → 케이블 50가닥 추가 (R로 다시 떨어뜨림), ?debug → 성능 표시
const params = new URLSearchParams(location.search);
const stress = Math.max(0, Math.min(200, Number(params.get('stress')) || 0));
const debug = params.has('debug') || stress > 0;

const stage = createStage(canvas);
const rig = createCameraRig(stage.camera, canvas);
const hud = createHud(hudRoot);
const bed = createTestbed(stage.scene, stage.rack, stress);
createCableDrag({
  canvas,
  camera: stage.camera,
  controls: rig.controls,
  world: bed.world,
  showPortHint: bed.showPortHint,
});
if (debug) Object.assign(window, { bed, rig, stage });
if (stress > 0) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') bed.redrop();
  });
}

// M0: 더미 수치. M3에서 GameState·economy로 교체
const model = { money: 0, incomePerSec: 1, powerUsed: 180, powerCap: 3000 };
let lastRealMs = Date.now();

const perf = { physMs: 0, frames: 0, fps: 0, since: performance.now() };

startLoop({
  update(dt) {
    const t0 = performance.now();
    bed.world.step(dt);
    perf.physMs += (performance.now() - t0 - perf.physMs) * 0.05;
  },
  render() {
    const now = Date.now();
    rig.update((now - lastRealMs) / 1000);
    model.money += model.incomePerSec * ((now - lastRealMs) / 1000);
    lastRealMs = now;
    hud.setModel(model);
    bed.sync();
    stage.renderer.render(stage.scene, stage.camera);

    if (debug) {
      perf.frames++;
      const t = performance.now();
      if (t - perf.since >= 500) {
        perf.fps = (perf.frames * 1000) / (t - perf.since);
        perf.frames = 0;
        perf.since = t;
        const w = bed.world;
        hud.setDebug(
          `${perf.fps.toFixed(0)} fps · 물리 ${perf.physMs.toFixed(2)} ms/스텝 · 케이블 ${w.awakeCount}/${w.cables.length} 움직이는 중` +
            (stress > 0 ? ' · R 다시 떨어뜨리기' : ''),
        );
      }
    }
  },
});
