# 전용 랙·짝 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 종류 서버로 채운 랙(전용 랙)과 GPU↔스토리지 직결(짝)에 수익 보너스를 주고, 랙 위 색 띠·반짝임·정보 카드로 보여 준다.

**Architecture:** 판정은 Three.js 없는 순수 모듈 `src/game/bonus.ts`가 한다(장비 목록 + 포트 연결표 + "그 랙에 그 종류를 더 끼울 수 있나" 콜백 → 랙 테마·짝·장비별 보너스 비율). `Room.updatePower`가 기존 가동 판정 직후 이것을 불러 `summary.incomePerSec`를 보너스 포함으로 다시 계산하고, 테마·짝이 **새로 생길 때만** 이벤트를 내고 띠 재질을 바꾼다. 연출(`src/view/bonusFx.ts`)은 그 이벤트만 듣는다. 저장 형식은 안 바뀐다.

**Tech Stack:** TypeScript 5.9, Three.js 0.186, Vite 8, vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-11-rack-theme-pair-design.md`

## Global Constraints

- 보너스 값: 전용 `THEME_BONUS = 0.10`, 꽉 찬 전용 `THEME_FULL_BONUS = 0.25`(둘 중 하나), 짝 `PAIR_BONUS = 0.15`, 전용 최소 서버 `THEME_MIN_SERVERS = 2`. 숫자는 `src/data/catalog.ts` 한 곳에
- 수익 = 기본 수익 × (1 + 전용 보너스 + 짝 보너스), 가동(`running`) 서버만
- 가격·장비·포트·케이블 정의는 바꾸지 않는다. 저장 형식(`SAVE_VERSION`) 안 바꿈
- 매 프레임 도는 코드(`Room.updatePower`)에서 메시·재질·텍스처를 새로 만들지 않는다. 띠 재질은 테마가 바뀔 때만 손댐
- 화면 글씨를 늘리지 않음: 연출은 반짝임 + 효과음만, 설명은 정보 카드·가이드 패널에만
- 사용자에게 보이는 문구는 한국어. 코드 주석도 기존처럼 한국어
- 브랜치: main에서 `rack-theme-pair`. **커밋·push는 매번 사용자 승인 후** (사용자 방침) — 각 Task의 Commit 단계는 승인 받고 실행
- 테스트: `npx vitest run` 전체 통과, `npx tsc --noEmit` 오류 없음

## Review Focus

1. 이미 전용 랙·짝이 있는 저장을 불러오면 → 띠는 바로 켜져 있고 반짝임·소리는 한 번도 안 남 (Task 2·3 테스트)
2. 서버를 다른 랙으로 옮기면(빼기 → 끼우기) → 두 랙 테마가 둘 다 즉시 바뀜 (Task 2 테스트)
3. 스토리지 랜 포트 둘을 모두 GPU 쪽에 꽂아 스위치 링크가 없으면 → 스토리지 nolink → 짝 아님, GPU도 보너스 없음 (Task 1 테스트)
4. 같은 상태로 `updatePower`를 매 프레임 불러도 이벤트가 다시 나지 않고 띠 재질 객체가 그대로 (Task 2·3 테스트)
5. 짝 케이블을 뽑거나 한쪽을 끄면 → 그 순간 수익이 보너스 없는 값으로 돌아감 (Task 2 테스트)

---

### Task 1: 보너스 판정 (순수 모듈)

**Files:**
- Modify: `src/data/catalog.ts` (끝에 상수 추가)
- Create: `src/game/bonus.ts`
- Test: `tests/bonus.test.ts`

**Interfaces:**
- Produces (catalog.ts):
  - `export type ServerDefId = 'server-entry' | 'server-web' | 'server-storage' | 'server-gpu'`
  - `export const THEME_BONUS = 0.1`, `THEME_FULL_BONUS = 0.25`, `PAIR_BONUS = 0.15`, `THEME_MIN_SERVERS = 2`
  - `export const PAIR_KINDS: readonly [ServerDefId, ServerDefId] = ['server-gpu', 'server-storage']`
  - `export const THEME_COLOR: Record<ServerDefId, number> = { 'server-entry': 0xc0c8d0, 'server-web': 0x4fc3f7, 'server-storage': 0xffa040, 'server-gpu': 0xb070ff }`
- Produces (bonus.ts):
  - `export interface BonusDevice { id: string; defId: DeviceDefId; rack: string; role: PowerRole; status: PowerStatus; lanPorts: readonly string[] }`
  - `export interface RackTheme { kind: ServerDefId; full: boolean }`
  - `export interface Bonuses { themes: Map<string, RackTheme>; pairs: Map<string, string>; ratio: Map<string, number> }` — themes: rackId → 테마(전용 아닌 랙은 키 없음), pairs: 장비 id → 짝 장비 id(양방향 둘 다 들어감), ratio: 서버 id → 보너스 합(0이면 키 없어도 됨)
  - `export function computeBonuses(devices: readonly BonusDevice[], links: ReadonlyMap<string, string>, canFit: (rackId: string, kind: ServerDefId) => boolean): Bonuses`
  - `export const NO_BONUSES: Bonuses` (빈 맵 셋 — Room 초기값)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/bonus.test.ts`. 도우미 `srv(id, defId, rack, status = 'running', lan = ['<id>:l0'])`, `sw(id, rack)`로 `BonusDevice`를 만들고 `canFit` 기본값 `() => true`.
  - `서버 1대뿐인 랙은 전용 아님` → `themes.has('r1') === false`
  - `같은 종류 2대 + 스위치·PDU·매니저(passive) 섞여도 전용` → `themes.get('r1') toEqual { kind: 'server-web', full: false }`, 두 서버 `ratio === 0.1`
  - `다른 종류 서버가 섞이면 전용 아님` → `themes.has('r1') === false`, ratio 0
  - `서버가 꺼져 있거나 부팅 중이어도 전용 판정에 셈` → status `'off'`·`'booting'` 2대로도 테마 있음
  - `canFit이 false면 꽉 찬 전용` → `full: true`, ratio `0.25`; `canFit`이 `('r1', 'server-web')`로 불렸는지 확인
  - `랙마다 따로 판정` → r1 웹 2대, r2 엔트리 2대 → 두 테마 각각
  - `GPU와 스토리지 랜 직결 + 둘 다 running이면 짝` → links에 `gpu:l1 ↔ sto:l1`, `pairs.get('gpu') === 'sto'`, `pairs.get('sto') === 'gpu'`, 각 ratio `0.15`
  - `한쪽이 running이 아니면 짝 아님` → sto status `'booting'` / `'nolink'` 각각 `pairs.size === 0`
  - `GPU↔GPU, 웹↔스토리지는 짝 아님`
  - `꽉 찬 GPU 전용 + 짝 = 0.40` → `ratio.get('gpu')` toBeCloseTo `0.4`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/bonus.test.ts` / Expected: FAIL (`../src/game/bonus` 없음)
- [ ] **Step 3: 상수와 `computeBonuses` 구현** — 서버 판정은 `role === 'server'`. 테마: 랙별로 서버 defId를 모아 수 ≥ `THEME_MIN_SERVERS`이고 종류가 하나면 테마, `full = !canFit(rack, kind)`. 짝: 각 서버의 `lanPorts`마다 `links.get(port)`의 주인을 포트→장비 맵으로 찾고, `{defId, peer.defId}`가 `PAIR_KINDS` 두 종류와 같고 둘 다 `running`이면 짝. 반복은 장비·포트 수에 비례하는 한 번씩만
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/bonus.test.ts` / Expected: PASS
- [ ] **Step 5: Commit (승인 후)** — `git add src/data/catalog.ts src/game/bonus.ts tests/bonus.test.ts` → `git commit -m "Bonus rules: dedicated rack and GPU-storage pair"`

---

### Task 2: Room에 보너스 적용 (수익·이벤트)

**Files:**
- Modify: `src/core/events.ts` (GameEvents에 두 이벤트)
- Modify: `src/view/room.ts` (`updatePower` 224-251행, `restoreRoom` 609-615행, `createStartRoom` 618-635행)
- Test: `tests/bonusRoom.test.ts`

**Interfaces:**
- Consumes: Task 1 `computeBonuses`, `Bonuses`, `RackTheme`, `NO_BONUSES`, `ServerDefId`
- Produces:
  - GameEvents: `'rack:themed': { rackId: string; theme: RackTheme }` — 랙이 전용이 되거나, 종류가 바뀌거나, `full`이 false→true가 될 때 한 번. `'server:paired': { a: string; b: string }` — 새 짝마다 한 번 (a < b 사전순)
  - `Room.bonuses: Bonuses` (public, 초기 `NO_BONUSES`) — 정보 카드·띠가 읽음
  - `Room.quiet: boolean` (public, 초기 `true`) — true인 동안은 이전 상태만 갱신하고 이벤트를 안 냄. `createStartRoom`·`restoreRoom`이 끝에서 `false`로
  - `Room.updatePower`가 돌려주는 `summary.incomePerSec`는 보너스 포함

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/bonusRoom.test.ts`. `createStartRoom(new THREE.Scene())`에서 시작, 배선은 `room.wire(a, b)`, 부팅은 `room.updatePower(t); room.updatePower(t + BOOT_MS)` (tests/racks.test.ts의 `port`·`freeLan` 도우미 방식). 시작 PDU는 `room.devices.find(d => d.def.id === 'pdu')`, 빈 콘센트는 `pdu.ports.find(p => !p.plugged)`.
  - `엔트리 2대 → 전용 랙, 수익 2 × 1.1` → 엔트리를 U5에 끼우고 전원·랜 배선·켜기·부팅 → `incomePerSec` toBeCloseTo `2.2`, `room.bonuses.themes.get('rack-1')` toEqual `{ kind: 'server-entry', full: false }`
  - `웹 서버를 섞으면 전용이 풀림` → 위 상태에 웹 1대 추가·가동 → 수익 toBeCloseTo `1 + 1 + 3 = 5`
  - `GPU↔스토리지 짝: 둘 다 +15%` → 스토리지·GPU 끼우고 각각 전원 + 첫 랜 포트를 스위치에, 둘째 랜 포트끼리 `wire` → 가동 후 수익 toBeCloseTo `1 + 10 × 1.15 + 55 × 1.15 = 75.75`
  - `짝 선을 뽑으면 바로 보너스 없음` → 위에서 짝 케이블 한쪽 `unplug` 후 `updatePower` → toBeCloseTo `66`
  - `새 짝·새 테마마다 이벤트 한 번, 같은 상태로 다시 불러도 안 남` → `events.on`으로 세고, 짝 생긴 뒤 `updatePower` 3번 더 → `server:paired` 1번, `rack:themed`(엔트리 전용 때) 1번
  - `서버를 다른 랙으로 옮기면 두 랙 테마가 바로 바뀜` → rack-1 엔트리 2대 전용 상태에서 `addRack([1,0])`, 하나를 `remove` 후 `install('server-entry', 3, 'rack-2', 같은 id)` → `updatePower` 한 번 뒤 rack-1 테마 없음 (1대), rack-2 테마 없음 (1대); rack-2에 엔트리 하나 더 끼우면 rack-2 테마 생김 + `rack:themed` 1번
  - `불러오면 테마·짝이 그대로, 이벤트는 안 남` → 짝 상태 방을 `{ v: SAVE_VERSION, money: 0, bought: {}, ...room.snapshot() }`로 `restoreRoom` (tests/save.test.ts의 `toSave` 방식); 그 전에 이벤트 카운터 등록 → 복원 뒤 `pairs.size === 2`, 수익 75.75, 이벤트 0번
  - `시작 방은 조용함` → `createStartRoom` 동안 이벤트 0번, 반환된 방의 `quiet === false`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/bonusRoom.test.ts` / Expected: FAIL (수익이 보너스 없는 값 / `bonuses` 없음)
- [ ] **Step 3: 구현** — `updatePower`에서 기존 `updatePower(...)` 호출 뒤(LED 루프 전): 이미 만든 `links`로 `BonusDevice[]`(lanPorts = 그 장비 `ports` 중 `kind === 'lan'`의 id)를 만들어 `computeBonuses(…, (rackId, kind) => this.rack(rackId)?.slots.firstFree(DEVICES[kind].sizeU) !== null)` → `this.bonuses`. `this.summary.incomePerSec`를 `running` 서버의 `def.incomePerSec × (1 + ratio)` 합으로 다시 씀. 이전 `bonuses`와 비교해 위 규칙대로 이벤트 (quiet면 생략). `createStartRoom`·`restoreRoom` 마지막 줄에서 `room.quiet = false`
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run` / Expected: 전체 PASS (기존 `incomePerSec` 기대값을 쓰는 테스트는 시작 방이 엔트리 1대라 그대로여야 함 — 깨지면 테스트가 아니라 구현을 의심)
- [ ] **Step 5: Commit (승인 후)** — `git commit -m "Apply rack theme and pair bonuses to income"`

---

### Task 3: 랙 테마 띠

**Files:**
- Modify: `src/view/scene.ts` (띠 메시 함수 추가)
- Modify: `src/view/room.ts` (`RackSite`에 `band`, `addRack`에서 붙임, `updatePower`에서 바뀔 때만 갱신)
- Test: `tests/bonusRoom.test.ts` (describe 추가)

**Interfaces:**
- Consumes: Task 1 `RackTheme`, `THEME_COLOR`; Task 2 `Room.bonuses`와 변경 감지 지점
- Produces:
  - `export function createThemeBand(): THREE.Group` — 이름 `'theme-band'`, 랙 원점 기준 위 가로대 앞·뒤(z = ±(RACK.depth/2 + 약간))에 얇은 판 두 장, **재질 하나 공유**, `visible = false`, `userData.solid` 없음(충돌 상자 아님)
  - `export function setThemeBand(band: THREE.Group, theme: RackTheme | null): void` — null이면 숨김. 아니면 보이고 재질 `color`·`emissive` = `THEME_COLOR[kind]`, `emissiveIntensity` = 전용 `0.35` / 꽉 참 `1.0`
  - `RackSite.band: THREE.Group`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `전용이 되면 띠가 그 색으로 켜지고, 풀리면 꺼짐` → 엔트리 2대 전용 → `room.racks[0].band.visible === true`, 띠 메시 재질 `color.getHex() === THEME_COLOR['server-entry']`, `emissiveIntensity === 0.35`; 웹 섞으면 `visible === false`
  - `꽉 차면 밝아짐` → 엔트리로 랙을 채워 `firstFree(1) === null` (빈 U마다 `install('server-entry', u)`, 배선 없이도 테마는 셈) → `emissiveIntensity === 1`
  - `같은 상태로 매 프레임 불러도 재질이 그대로` → `updatePower` 전후 띠 메시 `material` 객체가 `toBe` 같음, 띠 그룹 자식 수 그대로
  - `불러온 방도 띠가 켜진 채` → 전용 방을 `restoreRoom` → `band.visible === true`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/bonusRoom.test.ts` / Expected: FAIL (`band` undefined)
- [ ] **Step 3: 구현** — `addRack`에서 `group.add(site.band = createThemeBand())`. `updatePower`에서 랙마다 새 테마가 이전과 다를 때만(종류 또는 full이 다름, 또는 있음↔없음) `setThemeBand`. quiet 중에도 띠는 갱신(이벤트만 생략)
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run` / Expected: 전체 PASS
- [ ] **Step 5: Commit (승인 후)** — `git commit -m "Rack theme band"`

---

### Task 4: 생기는 순간 연출 (반짝임·효과음)

**Files:**
- Create: `src/view/sparkle.ts` (tie.ts의 반짝임 코드를 옮김)
- Modify: `src/view/tie.ts` (144-156행 `sparkleTexture`, 213-222행 `sparkleAt`, 326-339행 반짝임 갱신 → `sparkle.ts` 사용)
- Modify: `src/ui/sfx.ts` (`playChime` 추가)
- Create: `src/view/bonusFx.ts`
- Modify: `src/main.ts` (생성·`sync` 호출·오디오 깨우기)

**Interfaces:**
- Consumes: Task 2 이벤트 `'rack:themed'`, `'server:paired'`; `Room.rack(id)`, `Room.device(id)`, `Room.bonuses.pairs`
- Produces:
  - `export interface Sparkles { at(p: THREE.Vector3): void; sync(dtMs: number): void }`, `export function createSparkles(scene: THREE.Scene): Sparkles` — 지금 tie.ts 동작 그대로(텍스처 한 번만, SPARKLE_MS 동안 커지며 흐려짐, 끝나면 재질 dispose)
  - `export function playChime(): void` — 짧게 올라가는 사인 두 음(합 250ms 안쪽), `VOLUME` 공유, `playTie`와 소리가 구별되게. 컨텍스트 없으면 조용히
  - `export function createBonusFx(deps: { scene: THREE.Scene; room: Room }): { sync(dtSec: number): void }` — `'rack:themed'` → 그 랙 띠 앞·뒤 양 끝과 가운데(랙 원점 + 띠 위치)에 반짝임 + `playChime()`; `'server:paired'` → 두 장비에서 서로 이어진 랜 포트 `pos`에 반짝임 + `playChime()`

- [ ] **Step 1: `sparkle.ts`로 옮기고 tie.ts가 쓰게 바꿈** — 동작 변화 없음
- [ ] **Step 2: 기존 테스트 확인** — Run: `npx vitest run tests/tie.test.ts && npx tsc --noEmit` / Expected: PASS, 타입 오류 없음
- [ ] **Step 3: `playChime`, `createBonusFx` 구현, main 연결** — main.ts 렌더 루프의 `tieTool.sync(dtSec)` 옆에서 `bonusFx.sync(dtSec)`. 짝은 부팅이 끝난 뒤(클릭 밖) 생기므로 첫 클릭에 오디오가 깨어 있게 `window.addEventListener('pointerdown', primeAudio, { capture: true })`를 main에 한 번
- [ ] **Step 4: 화면 확인** — `npx vite --port 5199 --strictPort` → `http://localhost:5199/untangle_the_rack/?debug` 를 headless Chrome으로 열고, 콘솔에서 `window.room`으로 엔트리 서버 하나를 더 끼워 배선·켜기 → 3초 뒤 띠가 켜지고 반짝임이 뜨는 스크린샷. 디버그 줄 `물리 ms/스텝`이 바꾸기 전과 같은 수준인지 기록. 끝나면 Chrome·vite 프로세스 종료
- [ ] **Step 5: Commit (승인 후)** — `git commit -m "Sparkle and chime when a theme or pair forms"`

---

### Task 5: 정보 카드·가이드 문구

**Files:**
- Modify: `src/ui/format.ts` (`formatBonus` 추가)
- Modify: `src/ui/inspector.ts` (`render` 안 수익 줄, 152행 근처)
- Modify: `src/ui/hud.ts` (`GUIDE_HTML` "제약" 뒤에 "보너스" 소제목)
- Test: `tests/format.test.ts`

**Interfaces:**
- Consumes: Task 1 `RackTheme`, 상수; Task 2 `Room.bonuses`
- Produces: `export function formatBonus(theme: RackTheme | null, paired: boolean): string` — 둘 다 없으면 `''`. 있으면 앞에 공백을 붙인 괄호: `' (전용 랙 +10%)'`, `' (꽉 찬 전용 랙 +25%)'`, `' (짝 +15%)'`, `' (전용 랙 +10% · 짝 +15%)'`. 퍼센트는 상수에서 `Math.round(x * 100)`

- [ ] **Step 1: 실패하는 테스트 작성** — `describe('formatBonus')`에 `it.each`로 위 다섯 경우 (`null,false → ''` 포함)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/format.test.ts` / Expected: FAIL (`formatBonus` 없음)
- [ ] **Step 3: 구현** — `formatBonus`. 정보 카드: 서버면 수익 줄을 `수익 ${formatRate(def.incomePerSec × (1 + ratio))}${formatBonus(theme, paired)}${멈춤 표시}`로 (theme = 그 장비 랙의 `room.bonuses.themes`, paired = `room.bonuses.pairs.has(id)`, ratio = `room.bonuses.ratio.get(id) ?? 0`). 짝이면 다음 줄 `짝: ${짝 장비 def.name}`. 가이드:
  ```html
  <h3>보너스</h3>
  <ul>
    <li>전용 랙: 한 랙의 서버를 한 종류로만 2대 이상 → 수익 +10% · 그 종류를 더 못 넣을 만큼 차면 +25% · 랙 위에 색 띠</li>
    <li>짝 연결: GPU 서버와 스토리지 서버의 남는 랜 포트를 랜선으로 직접 이으면 둘 다 +15% (다른 랙끼리도 돼요)</li>
  </ul>
  ```
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run && npx tsc --noEmit` / Expected: 전체 PASS, 타입 오류 없음
- [ ] **Step 5: Commit (승인 후)** — `git commit -m "Show bonuses in inspector and guide"`

---

### Task 6: GDD 반영·마무리 확인

**Files:**
- Modify: `docs/GDD-피벗-서버실-방치형.md` (5장 뒤에 "5.2 전용 랙·짝 연결 ✅" — 스펙 3장 규칙과 값, 결정일 2026-11-11, 스펙 경로 링크)

- [ ] **Step 1: GDD 절 추가** — 규칙·값·보이는 것을 스펙에서 옮겨 적음 (새 결정 없음)
- [ ] **Step 2: 전체 확인** — Run: `npx vitest run && npm run build` / Expected: 모든 테스트 PASS, 빌드 성공. 결과 숫자(파일 수·테스트 수)를 기록
- [ ] **Step 3: Commit (승인 후)** — `git commit -m "GDD: dedicated rack and pair bonuses"`
- [ ] **Step 4: 사용자 화면 확인 목록 전달** — ①엔트리 2대로 띠가 켜지고 반짝·소리 ②웹 섞으면 꺼짐 ③GPU↔스토리지 직결 시 반짝·정보 카드 "짝" ④불러오면 띠가 켜진 채, 반짝 없음 ⑤버벅임 없음(디버그 줄 fps)
