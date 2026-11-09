# 선 정리 다시 만들기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 물리 로프를 손으로 묶던 정리를 "가이드에 끌어 놓기 → 벨크로로 가이드 구간을 착 묶기 → 전력 감소" 흐름으로 바꾸고, 공기 흐름·스로틀링을 없앤다.

**Architecture:** 가이드(가로·세로 케이블 매니저 하나 = 가이드 하나)를 헤드리스 모델(`src/cable/guide.ts`)로 만들고, 경로 찾기·경로 꺾은선·차선 배치를 `src/cable/route.ts`에 둔다. 경로에 들어간 케이블은 로프가 `frozen`이 되어 물리에서 빠지고, 마디는 경로 꺾은선을 따라 다시 깔린다. `Room`이 케이블의 `route`(지나는 가이드·묶인 가이드)를 관리하고, 묶인 비율로 장비별 전력 감소(`PowerDevice.saving`)를 정해 `power.ts`가 실제 전력으로 판정한다. 뷰는 끌어 놓기(`src/view/guide.ts`)와 묶기 연출(`src/view/tie.ts`)로 나뉜다.

**Tech Stack:** TypeScript 5.9, Three.js 0.186, Vite 8, vitest 5. 소리는 WebAudio 합성 (의존성 추가 없음).

**Spec:** `docs/superpowers/specs/2026-11-09-cable-tidy-redesign-design.md`

## Global Constraints

- 헤드리스 로직(`src/cable`, `src/game`)은 Three.js를 import하지 않는다. 테스트는 `tests/*.test.ts` (vitest), 실행 `npx vitest run`.
- 각 태스크 끝: `npx vitest run` 전부 통과 + `npm run build` 통과.
- 케이블 2m 고정(`CABLE_DEFAULT_LENGTH`), 케이블끼리 충돌 없음, 해금 없음.
- 가격·수익 수치는 건드리지 않는다 (매니저 100원 ×1.25 그대로).
- UI·안내 문구·주석은 한국어. 묶는 순간 화면에 글씨를 띄우지 않는다 (안내 바 문구도 묶을 때는 내지 않음).
- 사용자 저장(localStorage `untangle_the_rack.save`, `SAVE_VERSION` 1)이 깨지면 안 된다 — 옛 `ties`가 있어도 불러와져야 함.
- 커밋은 사용자가 태스크별 커밋을 승인한 경우에만, push는 항상 묻고 한다.
- 전력 감소율 `TIDY_POWER_CUT = 0.15` (첫 값, 플레이로 조정).

## Review Focus

1. 2m로 닿지 않는 높이(예: 시작 방 + U40 매니저)에 놓기 → 거절(빨간 깜빡임), 선은 늘어진 그대로, 예외 없음. → Task 4 테스트 `U40 매니저는 거절`
2. 한쪽만 꽂힌(또는 안 꽂힌) 선을 가이드에 놓기 → 거절. → Task 5 테스트 `양 끝이 꽂혀야 경로에 들어감`
3. 묶인 선이 지나는 매니저를 팔기 → 그 선들은 늘어진 로프로 돌아가고 전력 감소가 사라짐, 남은 매니저를 지나던 다른 선은 그대로. → Task 5 테스트 `가이드를 빼면 그 가이드를 지나던 선만 풀림`
4. 옛 저장(벨크로 `ties`, `hook` 포함) 불러오기 → 장비·돈·꽂힘 유지, 선은 늘어진 상태. → Task 5 테스트 `옛 ties 저장도 불러옴`
5. 같은 가이드에 선 여러 가닥 → 차선이 겹치지 않고, 이미 묶인 선은 새 선이 들어와도 묶인 채. → Task 5 테스트 `새 선이 들어와도 묶인 선은 유지`

---

### Task 1: 공기 흐름·스로틀링 걷어내기

**Files:**
- Delete: `src/game/thermal.ts`, `tests/thermal.test.ts`
- Modify: `src/rack/device.ts:18-25` (`EXHAUST_GAP`·`EXHAUST_DEPTH`·`EXHAUST_ZONE` 삭제), `src/view/room.ts` (`airflow` 필드, `incomeFactor` 사용, `new CableMesh(c, EXHAUST_ZONE)` → `new CableMesh(c)`), `src/cable/cableMesh.ts` (zone·blocked·깜빡임·`segmentInBox` import 삭제), `src/ui/hud.ts` (`airflow` 모델 필드·🌀 표시·가이드 첫 줄 삭제), `src/main.ts:323` (`airflow:` 인자 삭제), `src/cable/manager.ts` 주석 중 배기 통로 언급, `tests/manager.test.ts` (`EXHAUST_ZONE`·공기 흐름 기대값을 쓰는 테스트 삭제)

**Interfaces:**
- Produces: `Room.incomePerSec` = `this.summary.incomePerSec` (배율 없음). `HudModel`에서 `airflow` 제거.

- [ ] **Step 1:** 위 파일에서 공기 흐름 관련 코드·테스트 삭제. `grep -rn "airflow\|EXHAUST\|thermal\|incomeFactor\|공기 흐름" src tests` 결과가 비어야 함.
- [ ] **Step 2:** `npx vitest run` → PASS, `npm run build` → 성공.
- [ ] **Step 3:** Commit `Remove airflow score and throttling`

### Task 2: 옛 벨크로 띠·고리 걸기 걷어내기

**Files:**
- Delete: `src/cable/velcro.ts`, `src/view/velcro.ts`, `src/view/manager.ts`, `tests/velcro.test.ts`
- Create: `src/cable/reach.ts`
- Modify: `src/cable/manager.ts` (남길 것: `Ring`, `ringsOf`, `sideRingsOf`, `deviceRings`, `RING_OUT`, `RING_R`, `SIDE_RING_X`, `SIDE_RING_Z` — 고리 메시용. `hook`·`unhook`·`hooksAt`·`releaseDevice`·`deviceOfHook`·`tautNode`·`slideNode` 등 삭제), `src/cable/cable.ts` (`ties: Tie[]` 필드·import 삭제), `src/view/drag.ts` (`tieAt/untie` 떼어내기 로직 삭제, `snap` dep 삭제), `src/view/room.ts` (`releaseDevice`·`restoreTie`·`untie` 사용, snapshot의 `ties` 삭제 — restore는 `saved.ties`를 무시), `src/main.ts` (velcro·manager 도구 생성·`snap`·`sync`·Space 안내·`cable:untied` 안내 삭제, `canReach` import 경로 변경), `src/ui/inspector.ts` (`renderManager`의 `hooksAt` 사용 → 일단 "고리 N개"만), `tests/manager.test.ts` (hook 관련 테스트 삭제, 남는 게 `전기를 안 먹고 수익도 없음` 정도면 `tests/guide.test.ts`로 Task 3에서 옮겨도 됨)

**Interfaces:**
- Produces: `src/cable/reach.ts` — `export function canReach(cable: Cable, i: number, at: Vec3): boolean` (꽂힌 끝까지 직선거리 × 1.02 ≤ 마디 차 × segLen; 옛 velcro.ts와 같은 식, 고정점은 꽂힌 끝만).
- `SavedCable.ties`는 `save.ts`에 **선택 필드로 남겨** 검증만 통과시킨다 (옛 저장 호환). 쓰지 않음.

- [ ] **Step 1:** `tests/save.test.ts`에 실패하는 테스트 추가 — `옛 ties 저장도 불러옴`: `ties: [{ node: 10, pos: [0,1,0], hook: 'cable-manager#3:ring1' }]`가 든 `SaveData`를 `parseSave(JSON.stringify(...))`가 null 아닌 값으로 돌려주고, `restoreRoom(new THREE.Scene(), new THREE.Group(), data)` 뒤 해당 케이블의 `ends`가 저장대로 꽂혀 있음. (지금은 통과할 수도 있음 — 삭제 뒤에도 통과해야 하는 회귀 테스트)
- [ ] **Step 2:** 위 삭제·이동 수행. `grep -rn "velcro\|hook(\|ties\|strap\|untie" src` 결과는 `save.ts`의 선택 필드와 툴 id `'velcro'`(hud·events, Task 7에서 역할 변경)만.
- [ ] **Step 3:** `npx vitest run` → PASS, `npm run build` → 성공.
- [ ] **Step 4:** Commit `Remove pillar velcro straps and ring hooking`

### Task 3: 전력 감소 (`saving`)

**Files:**
- Modify: `src/game/power.ts`, `src/rack/device.ts` (`powerOf`가 `saving: 0`으로 만듦)
- Test: `tests/power.test.ts`

**Interfaces:**
- Produces: `PowerDevice.saving: number` (0~1, 정격 대비 줄어드는 비율). `export function effectiveWatts(d: PowerDevice): number` = `d.watts * (1 - d.saving)`. `evaluate` 안의 `d.watts` 세 곳(`demand`, `powerUsed`, `load`)을 모두 `effectiveWatts(d)`로.

- [ ] **Step 1:** 실패하는 테스트 `saving만큼 PDU 부하가 줄어 차단되지 않음`: 용량 1000W PDU에 600W 서버 2대(합 1200 → 차단) → 두 서버 `saving = 0.2`(합 960)면 `tripped === false`, `summary.powerUsed === 960`.
- [ ] **Step 2:** 실패하는 테스트 `saving이 0으로 돌아가면 다시 차단`: 위 상태에서 `saving = 0`으로 바꾸고 `updatePower` → PDU `tripped === true`.
- [ ] **Step 3:** `npx vitest run tests/power.test.ts` → 새 테스트 FAIL.
- [ ] **Step 4:** 구현.
- [ ] **Step 5:** `npx vitest run` → PASS. Commit `Power saving factor per device`

### Task 4: 가이드 모델과 경로 찾기 (헤드리스)

**Files:**
- Create: `src/cable/guide.ts`, `src/cable/route.ts`
- Test: `tests/route.test.ts`

**Interfaces:**
- Consumes: `Port` (`cable.ts`), `RING_OUT`·`SIDE_RING_X`·`SIDE_RING_Z`·`deviceRings` (`manager.ts`), `BACK_Z` 값(manager.ts 내부 상수와 같음 — `guide.ts`에서 같은 식으로 계산하거나 manager.ts에서 export).
- Produces (`guide.ts`):
  - `export interface Guide { id: string; axis: 0 | 1; a: Vec3; b: Vec3 }` — `id` = 매니저 장비 id. 선이 `a`↔`b` 선분을 따라 지남. `axis` 0 = x를 따라(가로), 1 = y를 따라(세로).
  - `export function guideOf(d: { id: string; u: number | null; side: number | null; def: { rings?: readonly number[] } }): Guide | null` — 가로: 고리들 x 최소~최대, y = 고리 y, z = `BACK_Z - RING_OUT`. 세로: x = ∓`SIDE_RING_X`, z = `SIDE_RING_Z`, y = 고리 높이 최소~최대. 매니저가 아니면 null.
- Produces (`route.ts`):
  - `export const MAX_GUIDES = 3`, `export const FREE_WEIGHT = 3`, `export const STUB = 0.03` (포트에서 곧게 나오는 길이), `export const REACH_SLACK = 1.02`
  - `export function routePath(a: Port, b: Port, seq: readonly Guide[], lanes?: readonly LaneOffset[]): Vec3[]` — 꺾은선: `a.pos` → `a.pos + a.dir*STUB` → 각 가이드마다 [들어가는 점, 나가는 점] → `b.pos + b.dir*STUB` → `b.pos`. 들어가는/나가는 점은 가이드 선분 위에서 앞·뒤 점에 가장 가까운 점(선분으로 clamp). `lanes[k]`가 있으면 k번째 가이드 안의 두 점에 그 오프셋을 더함.
  - `export interface LaneOffset { d: [number, number] }` — 가이드 축에 수직인 두 방향(가로 가이드: [y, z], 세로 가이드: [x, z]) 오프셋 m.
  - `export function pathLength(pts: readonly Vec3[]): number`
  - `export function findRoute(a: Port, b: Port, guides: readonly Guide[], dropped: string, maxLen: number): Guide[] | null` — `dropped`를 포함하는 서로 다른 가이드 1~`MAX_GUIDES`개의 모든 순서를 훑어, `pathLength(routePath(...)) * REACH_SLACK <= maxLen`인 것 중 점수 최소. 점수 = 전체 길이 + `FREE_WEIGHT` × (가이드 밖 구간 길이, 즉 STUB 이후 가이드 사이·포트까지 구간 합). 없으면 null. (점수 덕에 가이드를 더 많이 지나는 사진 같은 경로가 고름)
  - `export function laneOffset(k: number, tight: number, radius: number): LaneOffset` — k번째 차선. 촘촘(tight=1): 간격 `2*radius + 0.001`, 4줄씩 쌓은 격자. 느슨(tight=0): 간격 0.014. 사이는 선형 보간. 묶이지 않은 구간의 "살짝 구불거림"은 Task 5의 마디 배치에서 진폭 `WOBBLE = 0.008 × (1 - tight)`로 더한다.

- [ ] **Step 1:** 테스트 헬퍼: `createStartRoom(new THREE.Scene(), new THREE.Group())` + `room.install('cable-manager', u)` → `guideOf(manager)`. 케이블 3가닥의 `ends[0]!`, `ends[1]!`.
- [ ] **Step 2:** 실패하는 테스트들:
  - `시작 방 3가닥 모두 U2·U5·U10·U15 매니저로 경로가 나옴`: 각 u마다 3가닥 모두 `findRoute(..., [g], g.id, 2.0)`가 `[g]`.
  - `U40 매니저는 거절`: `findRoute`가 null.
  - `경로는 포트에서 시작해 포트에서 끝남`: `routePath` 첫 점 = `a.pos`, 끝 점 = `b.pos`, 길이 × 1.02 ≤ 2.
  - `세로 매니저가 있으면 가로 매니저에 놓아도 더 가이드 안을 많이 지나는 경로를 고름`: 시작 방 + U20 가로 매니저 + 세로 매니저(`room.addSide('cable-manager-v')`), PDU 전원선을 가로에 놓으면 결과에 두 가이드가 다 들어 있거나(닿으면) 가로 하나 — 어느 쪽이든 결과 경로의 `FREE_WEIGHT` 점수가 `[가로]` 단독보다 작거나 같음.
  - `laneOffset 차선끼리 안 겹침`: k=0..7, tight=1, radius 0.003 → 서로 거리 ≥ 0.006.
- [ ] **Step 3:** `npx vitest run tests/route.test.ts` → FAIL (모듈 없음).
- [ ] **Step 4:** `guide.ts`, `route.ts` 구현.
- [ ] **Step 5:** `npx vitest run` → PASS. Commit `Guide model and route finding`

### Task 5: 경로에 넣기·묶기·풀기 상태와 저장 (`Room`)

**Files:**
- Modify: `src/cable/rope.ts` (`frozen`), `src/cable/cable.ts` (`route`), `src/view/room.ts`, `src/game/save.ts`, `src/core/events.ts`
- Test: `tests/tidy.test.ts`

**Interfaces:**
- Consumes: Task 3 `PowerDevice.saving`, Task 4 전부.
- Produces:
  - `Rope.frozen: boolean` — true면 `step()`이 아무것도 안 함. `Rope.setPath(points: readonly Vec3[]): void` = `setFromPolyline` 후 `frozen = true`, `sleeping = true`, `version++`. `frozen = false`로 풀 때는 `wake()`.
  - `Cable.route: Route | null`, `export interface Route { guides: string[]; tied: string[] }` (`cable.ts`). `createCable`은 `route: null`.
  - `export const TIDY_POWER_CUT = 0.15` (`room.ts`)
  - `export function tidyDegree(r: Route | null): number` (`route.ts`) — `r ? r.tied.filter(g => r.guides.includes(g)).length / r.guides.length : 0`
  - `Room.guides(): Guide[]` — 설치된 매니저들의 `guideOf`.
  - `Room.routeCable(cable: Cable, guideId: string): boolean` — 양 끝이 꽂혀 있고 `findRoute`가 있으면 `cable.route = { guides, tied: [] }`, 경로가 바뀐 가이드들 `relayout`, `events.emit('cable:routed', { cableId })`, true. 아니면 false (상태 그대로).
  - `Room.routeWith(cable: Cable, guideIds: readonly string[], tied: readonly string[]): boolean` — 저장·옮기기 복원용: 그 가이드 순서 그대로 경로 길이만 검사.
  - `Room.unroute(cable: Cable): void` — `route = null`, `rope.frozen = false`, `wake()`, 그 가이드들 `relayout`, `events.emit('cable:unrouted', { cableId })`. route가 없으면 아무것도 안 함.
  - `Room.tieGuide(guideId: string): Cable[]` — 그 가이드를 지나고 아직 그 가이드가 `tied`에 없는 선들에 추가, 돌려줌. 하나라도 있으면 `relayout(guideId)`·`events.emit('cable:tied', { guideId, cableIds })`.
  - `Room.relayout(guideId?: string, tight?: ReadonlyMap<string, number>): void` — 해당(없으면 모든) 가이드를 지나는 경로 선들의 마디를 다시 깖. 차선 k = 그 가이드를 지나는 선들 중 `world.cables` 순서상 몇 번째. 가이드별 tight = `tight?.get(guideId) ?? (그 선이 그 가이드에 묶였으면 1, 아니면 0)`. 마디 = `rope.setPath(routePath(a, b, seq, lanes))` + 묶이지 않은 가이드 구간 마디에 진폭 `WOBBLE × (1 - tight)` 사인 흔들림(주기 0.25m).
  - `updatePower` 안에서 장비마다 `power.saving = TIDY_POWER_CUT × (그 장비 포트에 꽂힌 선들의 tidyDegree 평균, 꽂힌 선 없으면 0)`.
  - 이벤트(`events.ts`): `'cable:routed': { cableId: string }`, `'cable:unrouted': { cableId: string }`, `'cable:tied': { guideId: string; cableIds: string[] }` (옛 `cable:tied`·`cable:untied` 페이로드 교체, `cable:untied` 삭제).
  - 풀리는 규칙: Room 생성자에서 `events.on('cable:unplugged', …)` → 그 케이블 `unroute`. `Room.remove(device)`가 매니저면 그 가이드를 지나는 선 모두 `unroute` (다른 가이드만 지나는 선은 그대로). `removeCable`도 `unroute` 먼저.
  - 저장: `SavedCable.route?: { guides: string[]; tied: string[] }` (`save.ts` 검증: 문자열 배열 둘). `snapshot`이 씀. `restore`는 꽂기 뒤 `saved.route`가 있으면 `routeWith`, 실패하면 늘어진 로프(저장된 nodes 그대로).

- [ ] **Step 1:** 실패하는 테스트 (`tests/tidy.test.ts`, 시작 방 + U5 매니저):
  - `경로에 넣으면 로프가 멈추고 포트에서 포트까지 이어짐`: `routeCable` true, `rope.frozen`, 첫 마디 ≈ `ends[0].pos`, 끝 마디 ≈ `ends[1].pos` (1mm), `world.step` 60번 뒤 `pos` 그대로.
  - `양 끝이 꽂혀야 경로에 들어감`: `unplug(c, 1)` 뒤 `routeCable` false, `route === null`.
  - `묶기 전엔 전력 그대로, 묶으면 15% × 비율만큼 줄어듦`: 3가닥 route → `updatePower` 뒤 스위치 `saving === 0` → `tieGuide(g.id)` 뒤 스위치(꽂힌 선 2가닥 모두 묶임) `saving ≈ 0.15`, `summary.powerUsed`가 정격 합보다 작음.
  - `가이드 한 구간만 묶으면 부분 보상`: 세로+가로 매니저로 두 가이드를 지나는 선 하나를 `routeWith(c, [h, v], [])` → `tieGuide(h)`만 → `tidyDegree === 0.5`.
  - `새 선이 들어와도 묶인 선은 유지`: 2가닥 route+tie → 3번째 route → 앞 2가닥 `tied`에 그 가이드 그대로, 3번째는 `[]`. 세 선의 그 가이드 안 마디가 서로 ≥ 5mm 떨어짐.
  - `가이드를 빼면 그 가이드를 지나던 선만 풀림`: 매니저 두 개(U5, U10), 선 A는 U5, 선 B는 U10 → `room.remove(U5 매니저)` → A `route === null`·`frozen === false`, B 그대로.
  - `선을 뽑으면 경로에서 빠짐`: route된 선 `unplug` → `route === null`.
  - `저장하고 불러와도 경로·묶음 유지`: route+tie → `snapshot` → `parseSave(JSON.stringify({...}))` → `restoreRoom` → 같은 id 케이블 `route`가 같음.
- [ ] **Step 2:** `npx vitest run tests/tidy.test.ts` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npx vitest run` → PASS, `npm run build` → 성공. Commit `Routed and tied cable state, power saving, save`

### Task 6: 가이드에 끌어 놓기 (뷰)

**Files:**
- Create: `src/view/guide.ts`
- Modify: `src/view/drag.ts`, `src/main.ts`, `src/rack/placement.ts`·`src/view/deviceDrag.ts`·`src/main.ts` `reinstall` (옮길 때 경로 복원), `src/ui/hud.ts`·`src/ui/inspector.ts`·`src/ui/shop.ts` (문구)

**Interfaces:**
- Consumes: `Room.guides/routeCable/routeWith/unroute`, `findRoute`, `routePath`.
- Produces:
  - `drag.ts` deps에 `onGrab?(cable: Cable): void` (잡는 순간, `rope.grab` 전에 호출 — main은 `room.unroute`를 넘김: 경로에 든 선을 잡으면 빠져나와 다시 끌 수 있음) 와 `onRelease?(cable: Cable, ray: THREE.Ray): boolean` (커넥터가 아닌 가운데를 끌다 놓을 때 `finish(true)`에서 호출, true면 처리됨).
  - `createGuideTool(deps: { canvas; camera; scene: THREE.Scene; room: Room; drag(): CableDrag; active(): boolean }): { onRelease(cable: Cable, ray: THREE.Ray): boolean; sync(): void; rayToGuide(ray: THREE.Ray): Guide | null }`
    - `rayToGuide`: 광선과 가이드 선분 사이 거리 ≤ `max(0.04, t × 0.035)`인 것 중 각도 최소.
    - `sync()` (매 프레임): 손에 든 선이 있고 커서 광선이 가이드 위면 그 가이드 강조(emissive 0x2d6cdf, 매니저 메시 `userData.deviceId`로 찾음) + `findRoute` 결과를 점선(`THREE.LineDashedMaterial`, 0x8cc8ff)으로 미리보기. 경로가 없으면 강조만 빨강(0x8a1c1c).
    - `onRelease`: 가이드 위면 `room.routeCable`; 실패하면 가이드 300ms 빨강 깜빡임 + false(선은 그 자리에서 다시 물리로). 가이드 위가 아니면 false.
  - 장비 끌어 옮기기: `MovingDevice.plugs[]`에 `route: Route | null` 추가(뺄 때 잡아 둠). `reinstall`에서 꽂은 뒤 `route`가 있으면 `room.routeWith(cable, route.guides, route.tied)`.
  - 문구: 설치 안내 "🧷 케이블 매니저 설치 · 늘어진 선을 끌어다 매니저에 놓으면 정리돼요", hud 가이드 줄에서 기둥 벨크로·Space 설명 삭제하고 "늘어진 선을 끌어 매니저에 놓기 → 🔗 벨크로로 다발 묶기 → ⚡ 전력이 줄어요", 상점 매니저 meta "선 정리 가이드", inspector 매니저 카드 "지나는 선 N가닥 · 묶음 M가닥".

- [ ] **Step 1:** 구현 (뷰라 자동 테스트 없음 — 로직은 Task 4·5에서 검증됨).
- [ ] **Step 2:** `npm run build` → 성공, `npx vitest run` → PASS.
- [ ] **Step 3:** 브라우저 확인 (`npm run dev`, `?debug` — **`?reset` 쓰기 전 사용자 저장을 sessionStorage `userSaveBackup`에 백업하고 끝나면 되돌릴 것**): 시작 방에 매니저 U5 설치 → 선 가운데를 끌어 매니저 위에 대면 파란 강조 + 점선 → 놓으면 선이 경로로 자리 잡음. U40 매니저에 놓으면 빨간 깜빡임 후 늘어진 그대로. 경로에 든 선을 잡으면 빠져나와 끌림. 서버를 끌어 옮긴 뒤 경로 유지.
- [ ] **Step 4:** Commit `Drag slack onto a guide to route it`

### Task 7: 벨크로로 묶기 연출과 전력 반짝

**Files:**
- Create: `src/view/tie.ts`, `src/ui/sfx.ts`
- Modify: `src/main.ts`, `src/ui/hud.ts` (전력 칸 짧은 강조), `src/styles.css`

**Interfaces:**
- Consumes: `Room.tieGuide/relayout`, `createGuideTool().rayToGuide`, `pickCable` (`src/view/pick.ts`).
- Produces:
  - `export function playTie(): void` (`sfx.ts`) — 첫 호출 때 `AudioContext` 생성, 짧은 "탁"(노이즈 버스트 30ms + 낮은 클릭, 전체 < 150ms, 볼륨 작게).
  - `createTieTool(deps: { canvas; camera; scene; room: Room; guides: { rayToGuide(ray): Guide | null }; active(): boolean; onTied(): void }): { sync(dtSec: number): void }`
    - 벨크로 도구(2)에서 window 캡처 pointerdown: 광선이 가이드 위거나, 경로에 든 케이블 위면(그 케이블 경로의 가이드 중 맞은 점에서 가장 가까운 것) → `room.tieGuide(id)`. 묶인 선이 없으면 아무 일 없음.
    - 연출 `TIE_ANIM_MS = 350`: 그 가이드 tight를 0→1로 ease-out 보간하며 매 프레임 `room.relayout(id, tightMap)` → 끝에서 띠 메시가 x축 0→1로 커짐(가로 가이드는 고리 자리마다, 세로 가이드는 다발이 지나는 구간에 `STRAP_SPACING = 0.15`m 간격; 검은 고리 0x111111, 다발을 감싸는 납작한 상자/토러스) + 띠마다 반짝 스프라이트 200ms + `playTie()` + `onTied()`.
    - 띠 메시는 `cable:tied`/`cable:unrouted`/`device:removed` 때 그 가이드 기준으로 다시 만듦(묶인 선이 하나도 없으면 띠 없음). 불러온 저장의 묶음도 처음에 그림.
    - 커서: 벨크로 도구로 가이드·경로 선 위면 `pointer`.
  - `hud.pulsePower(): void` — 전력 칸에 400ms CSS 클래스(밝아졌다 돌아옴). main은 `onTied`에서 `advance()` 후 `hud.pulsePower()`.
  - 묶을 때 `flashHint` 문구를 내지 않는다.
  - hud 툴바 벨크로 버튼 title: "경로에 든 다발을 클릭해 묶기 (2)", `tool:set` 안내: "🔗 벨크로: 매니저에 들어간 다발을 클릭하면 묶여요".

- [ ] **Step 1:** 구현.
- [ ] **Step 2:** `npm run build` → 성공, `npx vitest run` → PASS.
- [ ] **Step 3:** 브라우저 확인 (같은 백업 절차): 시작 방 + U5 매니저, 3가닥 경로에 넣기 → 벨크로로 다발 클릭 → 선이 모이며 곧게 펴짐 → 띠 감김 → 반짝 + 소리, 상단 ⚡ 숫자가 그 순간 줄고 깜빡임, 글씨 없음. 4번째 선을 넣으면 앞 3가닥은 띠 그대로. 매니저 판매 → 띠 사라지고 선 늘어짐, 전력 원래대로. 3가닥 경로+묶기가 1분 안쪽.
- [ ] **Step 4:** Commit `Velcro ties a guide bundle with strap animation and sound`

### Task 8: 문서 정리와 마무리 확인

**Files:**
- Modify: `docs/GDD-피벗-서버실-방치형.md` (1.1 기둥 3 → "엉켜도 손해는 없고, 정리하면 이득(전력 여유)", 5장을 새 흐름으로 다시 씀 — 옛 벨크로·고리·공기 흐름 단락은 "(10-25~26 기록, 11-09 교체)" 한 줄 요약으로, 6.4 케이블 길이 문단 갱신, 11장 P4 완료 기준 "정리하면 전력 여유가 생겨 같은 PDU에 서버를 더 꽂을 수 있음", 12장 결정 로그에 11-09 줄들: 정리 방식 교체·공기 흐름 제거·전력 보상·가이드 구간 단위 묶기)
- Modify: `README.md` (조작 설명에 옛 벨크로·Space가 있으면 갱신)

- [ ] **Step 1:** 문서 갱신.
- [ ] **Step 2:** `npx vitest run` → PASS, `npm run build` → 성공. `grep -rn "Space\|공기 흐름\|기둥에 묶" src README.md` → 남은 것 없음(카메라 등 무관한 Space가 있으면 그대로).
- [ ] **Step 3:** 사용자 저장 복원 확인: 브라우저에서 `?debug`로 사용자 저장 불러와 장비·돈·꽂힘 유지, 선은 늘어진 상태.
- [ ] **Step 4:** Commit `Docs: cable tidy redesign in GDD`
