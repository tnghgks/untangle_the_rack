import './styles.css';
import { startLoop } from './core/loop';
import { createStage } from './view/scene';
import { createCameraRig } from './view/camera';
import { createHud } from './ui/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;

const stage = createStage(canvas);
const rig = createCameraRig(stage.camera, canvas);
const hud = createHud(hudRoot);

// M0: 더미 수치. M3에서 GameState·economy로 교체
const model = { money: 0, incomePerSec: 1, powerUsed: 180, powerCap: 3000 };
let lastRealMs = Date.now();

startLoop({
  update() {},
  render() {
    const now = Date.now();
    rig.update((now - lastRealMs) / 1000);
    model.money += model.incomePerSec * ((now - lastRealMs) / 1000);
    lastRealMs = now;
    hud.setModel(model);
    stage.renderer.render(stage.scene, stage.camera);
  },
});
