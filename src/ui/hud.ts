import { events, type ToolId, type ViewMode } from '../core/events';
import { incomeFactor } from '../game/thermal';
import { LED_COLOR, type LedState } from '../rack/device';
import { formatMoney, formatRate } from './format';

// HUD 루트는 pointer-events: none — 빈 곳 입력은 그대로 3D 캔버스로 통과한다.
// 패널·버튼만 .hud-panel 로 입력을 받는다.

export interface HudModel {
  money: number;
  incomePerSec: number;
  powerUsed: number;
  powerCap: number;
  /** 공기 흐름 0~1 (thermal.ts). incomePerSec은 이미 스로틀링을 뺀 값 */
  airflow: number;
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

const LED_HELP: [LedState, string][] = [
  ['running', '가동 중'],
  ['booting', '부팅 중'],
  ['ready', '배선 완료 · 켜면 가동'],
  ['fault', '켰는데 안 돎 · 전원선·랜선 확인'],
  ['dark', '꺼짐 · 배선 덜 됨'],
];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const TOOL_KEYS: Record<string, ToolId> = { '1': 'hand', '2': 'velcro', '3': 'sell' };

/** 규칙 요약 (상단 바 가이드 버튼으로 열고 닫음) */
const GUIDE_HTML = `
  <div class="head"><b>가이드</b><button class="x" data-act="close-guide" aria-label="닫기">×</button></div>
  <p>서버를 사서 랙에 끼우고 선을 꽂아 <b>초당 수익</b>을 늘리세요. 게임을 켜 둔 동안에만 돈이 쌓여요.</p>
  <h3>설치 순서</h3>
  <ol>
    <li>상점에서 장비를 고르고 랙의 빈 칸을 클릭</li>
    <li>상점에서 전원선·랜선 구매 → 한쪽 커넥터를 든 채로 시작, 포트 위에서 클릭하면 꽂힘 (나머지 끝은 랙 뒤 바닥)</li>
    <li>뒷면에서 케이블 끝을 끌어 포트에 꽂기: 전원선 → 옆면 PDU 콘센트, 랜선 → 스위치</li>
    <li>앞면 전원 버튼 → 3초 부팅 → 수익 시작</li>
  </ol>
  <h3>상태등 (앞면·뒷면)</h3>
  <ul class="leds">${LED_HELP.map(([k, t]) => `<li><i style="background:${hex(LED_COLOR[k])}"></i>${t}</li>`).join('')}</ul>
  <h3>제약</h3>
  <ul>
    <li>스위치 랜 포트가 다 차면 스위치 24포트</li>
    <li>PDU는 콘센트 8개·3,000W. 넘으면 차단기가 내려가니 PDU를 추가해 나눠 꽂기</li>
    <li>랙 뒤로 늘어진 케이블은 배기를 막아 🌀 공기 흐름이 떨어지고 수익이 최대 50% 줄어요. 막는 부분은 주황빛으로 깜빡여요 · 🔗 벨크로로 뒷면 기둥에 묶거나 🧷 케이블 매니저 고리에 걸기</li>
  </ul>
  <h3>조작</h3>
  <ul>
    <li>가운데 버튼 드래그: 회전 · 오른쪽 또는 Shift+왼쪽 드래그: 이동 · 휠: 확대</li>
    <li>케이블 끄는 중 휠: 앞뒤로 밀기 · 꽂힌 커넥터는 직접 잡고 끌어야 뽑힘 (케이블을 당겨도 안 빠짐)</li>
    <li>🔗 벨크로 (2): 케이블을 끌어 뒷면 기둥 위에 대면 기둥에 붙음 → 든 채로 Space(또는 오른쪽 클릭)로 띠 감기 · 같은 높이에 또 감으면 한 다발 · 띠를 클릭하면 풀기 · 세게 당기면 떨어져요</li>
    <li>🧷 케이블 매니저 (상점, 1U): 뒷면 고리에 케이블을 끌어 대고 Space(또는 오른쪽 클릭)로 걸기 · 손·벨크로 도구 둘 다 · 고리를 클릭하면 빼기 · 높이 달수록 남는 선이 덜 늘어져요</li>
    <li>🧷 세로 케이블 매니저 (상점, 옆면): 랙 옆 세로 고리 줄 · 포트에서 옆으로 끌어 위쪽 고리에 걸었다가 아래 고리로 다시 내려 걸면 남는 선이 덕트를 따라 정리돼요 (랙 폭 밖이라 배기를 안 막음)</li>
    <li>💰 판매 (3): 장비나 케이블을 클릭하면 바로 판매, 산 값의 50% 환급 (시작 지급은 0원)</li>
    <li>장비 클릭: 정보 카드 (켜기·끄기·빼기) · 장비 끌기: 다른 칸으로 옮기기 (꽂힌 케이블은 닿으면 그대로) · Esc: 취소</li>
  </ul>
`;

/** 새 게임 버튼 → 확인 뒤 onNewGame. guideOpen: 처음 시작이면 가이드를 펼친 채로 */
export function createHud(root: HTMLElement, onNewGame: () => void, guideOpen = false): Hud {
  root.innerHTML = `
    <header class="hud-panel hud-top">
      <span class="stat money" data-k="money"></span>
      <span class="stat rate" data-k="rate"></span>
      <span class="stat power" data-k="power"></span>
      <span class="stat air" data-k="air"></span>
      <span class="stat warn" data-k="warn" hidden></span>
      <button class="guide-toggle" type="button" aria-expanded="false">가이드</button>
      <button class="new-game" type="button" title="저장을 지우고 처음부터">새 게임</button>
    </header>
    <section class="hud-panel hud-guide" hidden>${GUIDE_HTML}</section>
    <aside class="hud-panel hud-shop"></aside>
    <div class="hud-hint" hidden></div>
    <nav class="hud-panel hud-toolbar">
      <div class="group" role="group" aria-label="작업 시점">
        <button data-view="front">앞면</button>
        <button data-view="back">뒷면</button>
        <button data-view="free" class="on">자유</button>
      </div>
      <div class="group" role="group" aria-label="도구">
        <button class="on" data-tool="hand" title="케이블 잡아 끌기·꽂기 (1)">✋ 손</button>
        <button data-tool="velcro" title="케이블을 끌어 기둥에 대고 Space로 띠 감기, 띠를 클릭하면 풀기 (2)">🔗 벨크로</button>
        <button data-tool="sell" title="장비나 케이블을 클릭하면 바로 판매, 산 값의 50% 환급 (3)">💰 판매</button>
      </div>
    </nav>
    <div class="hud-debug" hidden></div>
  `;

  const field = (k: string) => root.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const money = field('money');
  const rate = field('rate');
  const power = field('power');
  const air = field('air');
  const warn = field('warn');
  root.querySelector('.new-game')!.addEventListener('click', () => {
    if (window.confirm('저장을 지우고 처음부터 시작할까요? 되돌릴 수 없어요.')) onNewGame();
  });
  const guide = root.querySelector<HTMLElement>('.hud-guide')!;
  const guideToggle = root.querySelector<HTMLButtonElement>('.guide-toggle')!;
  const setGuide = (open: boolean) => {
    guide.hidden = !open;
    guideToggle.classList.toggle('on', open);
    guideToggle.setAttribute('aria-expanded', String(open));
  };
  guideToggle.addEventListener('click', () => setGuide(guide.hidden));
  guide.querySelector('[data-act="close-guide"]')!.addEventListener('click', () => setGuide(false));
  setGuide(guideOpen);
  const debug = root.querySelector<HTMLElement>('.hud-debug')!;
  const hint = root.querySelector<HTMLElement>('.hud-hint')!;

  const viewButtons = root.querySelectorAll<HTMLButtonElement>('[data-view]');
  viewButtons.forEach((b) => b.addEventListener('click', () => events.emit('view:set', b.dataset.view as ViewMode)));
  events.on('view:changed', (mode) => {
    viewButtons.forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
  });

  const toolButtons = root.querySelectorAll<HTMLButtonElement>('[data-tool]');
  toolButtons.forEach((b) => b.addEventListener('click', () => events.emit('tool:set', b.dataset.tool as ToolId)));
  events.on('tool:set', (tool) => {
    toolButtons.forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  });
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = TOOL_KEYS[e.key];
    if (tool) events.emit('tool:set', tool);
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
      const cut = Math.round((1 - incomeFactor(m.airflow)) * 100);
      air.textContent = `🌀 공기 흐름 ${Math.round(m.airflow * 100)}%` + (cut > 0 ? ` · 수익 −${cut}%` : '');
      air.classList.toggle('bad', cut > 0);
      warn.hidden = m.pduWarn === null;
      warn.textContent = m.pduWarn ?? '';
    },
    setDebug(text) {
      debug.hidden = false;
      debug.textContent = text;
    },
  };
}
