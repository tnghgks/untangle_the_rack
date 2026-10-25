import { events, type ViewMode } from '../core/events';
import { formatMoney, formatRate } from './format';

// HUD 루트는 pointer-events: none — 빈 곳 입력은 그대로 3D 캔버스로 통과한다.
// 패널·버튼만 .hud-panel 로 입력을 받는다.

export interface HudModel {
  money: number;
  incomePerSec: number;
  powerUsed: number;
  powerCap: number;
  /** 가장 위험한 PDU 경고 (차단·과부하 직전). null = 괜찮음 */
  pduWarn: string | null;
}

export interface Hud {
  setModel(m: HudModel): void;
  /** 상점 패널 (내용은 shop.ts가 채움) */
  shopPanel: HTMLElement;
  /** 화면 아래 안내 문구 (null = 숨김) */
  setHint(text: string | null): void;
  /** 개발용 성능 표시 (왼쪽 아래). 처음 호출될 때 나타남 */
  setDebug(text: string): void;
}

/** 새 게임 버튼 → 확인 뒤 onNewGame */
export function createHud(root: HTMLElement, onNewGame: () => void): Hud {
  root.innerHTML = `
    <header class="hud-panel hud-top">
      <span class="stat money" data-k="money"></span>
      <span class="stat rate" data-k="rate"></span>
      <span class="stat power" data-k="power"></span>
      <span class="stat warn" data-k="warn" hidden></span>
      <button class="new-game" type="button" title="저장을 지우고 처음부터">새 게임</button>
    </header>
    <aside class="hud-panel hud-shop"></aside>
    <div class="hud-hint" hidden></div>
    <nav class="hud-panel hud-toolbar">
      <div class="group" role="group" aria-label="작업 시점">
        <button data-view="front">앞면</button>
        <button data-view="back">뒷면</button>
        <button data-view="free" class="on">자유</button>
      </div>
      <div class="group" role="group" aria-label="도구">
        <button class="on" data-tool="hand">✋ 손</button>
      </div>
    </nav>
    <div class="hud-debug" hidden></div>
  `;

  const field = (k: string) => root.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const money = field('money');
  const rate = field('rate');
  const power = field('power');
  const warn = field('warn');
  root.querySelector('.new-game')!.addEventListener('click', () => {
    if (window.confirm('저장을 지우고 처음부터 시작할까요? 되돌릴 수 없어요.')) onNewGame();
  });
  const debug = root.querySelector<HTMLElement>('.hud-debug')!;
  const hint = root.querySelector<HTMLElement>('.hud-hint')!;

  const viewButtons = root.querySelectorAll<HTMLButtonElement>('[data-view]');
  viewButtons.forEach((b) => b.addEventListener('click', () => events.emit('view:set', b.dataset.view as ViewMode)));
  events.on('view:changed', (mode) => {
    viewButtons.forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
  });

  return {
    shopPanel: root.querySelector<HTMLElement>('.hud-shop')!,
    setHint(text) {
      hint.hidden = text === null;
      hint.textContent = text ?? '';
    },
    setModel(m) {
      money.textContent = `💰 ${formatMoney(m.money)}`;
      rate.textContent = formatRate(m.incomePerSec);
      power.textContent = `⚡ ${m.powerUsed.toLocaleString('ko-KR')} / ${m.powerCap.toLocaleString('ko-KR')}W`;
      warn.hidden = m.pduWarn === null;
      warn.textContent = m.pduWarn ?? '';
    },
    setDebug(text) {
      debug.hidden = false;
      debug.textContent = text;
    },
  };
}
