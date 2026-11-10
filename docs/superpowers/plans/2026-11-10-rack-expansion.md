# 새 랙 사기·랙끼리 잇기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상점에서 랙을 사서 바닥 칸에 세우고, 새 랙 스위치를 온라인 랙 스위치에 긴 랜선(랙 위 트레이 경로)으로 이어야 그 랙 서버가 돈을 벌게 한다. 랙 여러 대 상태로 저장·불러오기.

**Architecture:** `Room` 하나가 랙 목록(`RackSite`: id·칸·원점·슬롯표·메시 그룹)과 공유 케이블 월드를 든다. 랙 안 좌표 상수(BACK_Z·가이드·PDU·덕트)는 그대로 두고, 장비·포트·가이드는 생성할 때 랙 원점만큼 옮긴다(`Device.origin`, `Port.rack`, `Guide.rack`·`origin`). 랙마다 위에 트레이 가이드(`${rackId}:tray`)가 붙어 있고, `findRoute`는 두 끝이 다른 랙이면 `[가로?, 세로?, 트레이들…, 세로?, 가로?]` 경로를 만든다(선 길이 안에서만). 온라인 판정은 `power.ts`에서 첫 랙 스위치(`uplink`)부터 랜으로 이어진 가동 스위치를 따라 퍼지고, 온라인이 아닌 가동 스위치는 `nolink`가 되어 그 스위치에 꽂힌 서버도 `nolink`가 된다.

**Tech Stack:** TypeScript 5.9, Three.js 0.186, Vite 8, vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-10-rack-expansion-design.md` (11-10 계획 단계에서 고친 내용 포함: 긴 랜선 10m 50원, 트레이 경로 길이 제한, 칸 1m×2m, 랙 값은 세울 때 냄)

## Global Constraints

- 헤드리스 로직(`src/cable`, `src/game`, `src/rack/floor.ts`, `src/rack/rack.ts`)은 Three.js를 import하지 않는다. 테스트는 `tests/*.test.ts`, 실행 `npx vitest run`.
- 각 태스크 끝: `npx vitest run` 전부 통과 + `npm run build` 성공.
- 랙: 값 100,000원, 살 때마다 ×1.25(`PRICE_GROWTH`), 해금 없음, 언제든 살 수 있음. 회전·옮기기·판매 없음. 모든 랙 앞면 +Z. 새 랙은 빈 랙(트레이만 붙어 옴).
- 긴 랜선: `'cable-lan-long'` 이름 `랜선 10m`, 값 50원, 길이 10m. 기존 `랜선 2m` 10원·`전원선 2m` 15원 그대로. 가격·수익 수치는 이것 말고 건드리지 않는다.
- 칸: 가로 `CELL_X = 1.0`m × 앞뒤 `CELL_Z = 2.0`m. 첫 랙 id `rack-1`, 칸 (0, 0), 원점 = 월드 원점 (옛 저장·케이블 마디 좌표가 그대로 맞음). 바닥은 칸 x −7..7, z −7..7.
- 트레이 경로(트레이 가이드를 하나라도 지나는 경로)는 `pathLength(routePath(...)) × REACH_SLACK(1.02) ≤ cable.rope.length`일 때만 들어간다. 랙 안 매니저 경로는 지금처럼 길이 제한 없음.
- 첫 랙(`racks[0]`) 스위치는 늘 인터넷에 닿아 있음. 온라인 = 가동 중 && (첫 랙 스위치 || 온라인 스위치와 랜선으로 직접 이어짐). 체인 허용.
- 사용자 저장(localStorage `untangle_the_rack.save`)이 깨지면 안 된다: v1 저장은 "랙 `rack-1` 한 대가 (0,0), 모든 장비가 그 랙"으로 읽는다.
- UI·안내 문구·주석은 한국어. 묶는 순간 글씨 띄우지 않기(①의 규칙 유지).
- 커밋은 사용자가 태스크별 커밋을 승인한 경우에만, push는 항상 묻고 한다.

## Review Focus

1. 중간 랙 스위치를 끄거나 업링크 선을 뽑음 → 그 뒤 체인의 모든 랙 서버가 `nolink`, 다시 켜고/꽂으면 부팅 뒤 복구. → Task 1 `체인 중간 스위치가 꺼지면 하류 전부 nolink`
2. 첫 랙과 안 이어진 랙 둘이 서로만 이어짐(섬) → 둘 다 오프라인. → Task 1 `첫 랙과 안 이어진 섬은 오프라인`
3. 초록 칸 가장자리에 세운 랙, 양쪽 스위치 U1, 24포트 스위치 맨 끝 포트 → 10m 선이 실제로 트레이 경로에 들어감 (초록인데 안 닿으면 실패). → Task 4 `초록 칸 가장자리는 U1 스위치끼리도 10m로 닿음`
4. 옛 v1 저장, 그리고 경로 필드 하나만 깨진 저장 → 둘 다 불러와짐 (깨진 선만 늘어진 로프). → Task 5 `v1 저장은 rack-1 한 대로 읽음`, `경로 하나가 깨져도 나머지는 불러옴`
5. 랙 사이 선이 꽂힌 스위치를 끌어 다른 칸으로 옮김 → 트레이 경로가 선 길이 안이면 다시 꽂히고 경로 유지, 넘으면 경로만 풀리고 꽂힘은 `canReach` 기준. → Task 4 `옮긴 뒤 트레이 경로가 길이를 넘으면 경로만 풀림`

---

### Task 1: 업링크 온라인 판정 (`power.ts`)

**Files:**
- Modify: `src/game/power.ts` (`PowerDevice.uplink`, `evaluate`의 2단계 앞에 온라인 퍼뜨리기, 118행 주석 교체), `src/rack/device.ts` (`powerOf`가 `uplink: false`)
- Modify: `src/ui/inspector.ts:19` (스위치 nolink 안내 따로)
- Test: `tests/power.test.ts` (`dev()` 헬퍼에 `uplink: false` 기본값 추가)

**Interfaces:**
- Produces: `PowerDevice.uplink: boolean` — 스위치가 인터넷에 직접 닿아 있음 (첫 랙 스위치). Room이 매 판정 전에 채움(Task 3).
- 판정 규칙: 1단계 뒤, `status === 'running'`인 스위치 중 `uplink`인 것에서 시작해 랜 링크(`links`)로 이어진 `running` 스위치로 퍼짐(BFS). 닿지 않은 `running` 스위치는 `status = 'nolink'`. 기존 2단계(서버 ↔ `running` 스위치)는 그대로 → 오프라인 스위치에 꽂힌 서버도 `nolink`. 스위치 `nolink`도 전기는 먹음(기존 합산 그대로).
- inspector: 스위치가 `nolink`면 안내 `'인터넷에 닿은 랙의 스위치에 랜선으로 이으세요 (랙 사이는 랜선 10m)'`, 서버는 기존 문구.

- [ ] **Step 1:** 실패하는 테스트 (`tests/power.test.ts`, 기존 `wired()`의 `sw`는 `uplink: true`로):
  - `업링크 스위치에 이어진 스위치의 서버는 가동`: `sw`(uplink) ↔ `sw2`(uplink false) 랜 연결, `srv2` ↔ `sw2`, 모두 전기·켜짐 → `BOOT_MS` 뒤 `sw2.status === 'running'`, `srv2.status === 'running'`.
  - `업링크 없는 스위치는 nolink, 그 서버도 nolink`: `sw2`만(uplink false) → `sw2.status === 'nolink'`, `srv2.status === 'nolink'`, `summary.powerUsed`에 둘 다 포함.
  - `체인 중간 스위치가 꺼지면 하류 전부 nolink`: sw(uplink) → sw2 → sw3, 각 서버 하나 → 모두 running → `sw2.on = false` 후 판정 → `srv2`·`srv3`·`sw3` nolink, `sw2` off → 다시 켜고 `BOOT_MS` 뒤 전부 running.
  - `첫 랙과 안 이어진 섬은 오프라인`: sw2 ↔ sw3만 연결(둘 다 uplink false) → 둘 다 nolink.
- [ ] **Step 2:** `npx vitest run tests/power.test.ts` → 새 테스트 FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npx vitest run` → PASS (Room이 아직 `uplink`를 안 채우므로 시작 방 스위치는 오프라인이 됨 → **이 태스크 안에서** `Room.updatePower`에 임시로 `if (d.power.role === 'switch') d.power.uplink = true`를 넣어 기존 테스트를 지킨다. Task 3에서 첫 랙 기준으로 바꿈). `npm run build` 성공.
- [ ] **Step 5:** Commit `Switch uplink: servers earn only behind an online switch`

### Task 2: 바닥 칸·트레이·초록 칸 판정 (헤드리스)

**Files:**
- Create: `src/rack/floor.ts`
- Modify: `src/cable/guide.ts` (`Guide`에 `rack`·`origin`·`tray` 필드)
- Test: `tests/floor.test.ts`

**Interfaces:**
- Produces (`guide.ts`): `Guide`에 `rack: string`, `origin: Vec3`(그 랙 원점), `tray?: true`. `guideOf`의 인자 타입에 선택 필드 `rack?: string; origin?: Vec3`를 더하고 결과에 `rack: d.rack ?? 'rack-1'`, `origin: d.origin ?? [0, 0, 0]`을 채움 (좌표 계산은 그대로 — 원점만큼 옮기는 건 Task 3에서 `deviceRings`가 함).
- Produces (`floor.ts`):
  - `export type Cell = readonly [number, number]` (x칸, z칸)
  - `export const CELL_X = 1.0, CELL_Z = 2.0, FLOOR_MIN = -7, FLOOR_MAX = 7`
  - `export interface RackPlace { id: string; cell: Cell }`
  - `export function cellOrigin(cell: Cell): Vec3` = `[cell[0] * CELL_X, 0, cell[1] * CELL_Z]`
  - `export function cellAt(x: number, z: number): Cell` = 반올림
  - `export function inFloor(cell: Cell): boolean`
  - `export const TRAY_Y = RACK_HEIGHT + 0.06`, `export const TRAY_Z = SIDE_RING_Z` (세로 매니저에서 트레이로 z 이동 없이 곧장 오르게)
  - `export const trayId = (rackId: string) => \`${rackId}:tray\``
  - `export function trayGuide(r: RackPlace): Guide` — axis 0, `a = origin + [-CELL_X/2, TRAY_Y, TRAY_Z]`, `b = origin + [CELL_X/2, TRAY_Y, TRAY_Z]` (옆 칸 트레이와 끝이 맞닿음), `tray: true`.
  - `export const LONG_LAN_LENGTH = 10`
  - `export function worstUplinkLength(a: Cell, b: Cell): number` = `2 * CLIMB + 2 * SIDE_RUN + SAG_ALLOW + |dx| * CELL_X + |dz| * CELL_Z`. `CLIMB = TRAY_Y - (uBottomY(1) + U / 2)` (U1 포트 → 트레이), `SIDE_RUN = SIDE_RING_X + 0.2` (24포트 스위치 맨 끝 포트 x −0.2 → 반대쪽 랙 옆), `SAG_ALLOW = 0.4` (늘어뜨림·처짐·둥근 꺾임 여유 — Task 4의 보증 테스트가 이 값이 실제 경로보다 큼을 확인).
  - `export function reachableCells(racks: readonly RackPlace[], cableLen = LONG_LAN_LENGTH): Cell[]` — 바닥 안, 랙 없는 칸 중 어떤 랙과 `worstUplinkLength × REACH_SLACK ≤ cableLen`인 칸 전부.
  - `export function canPlaceRack(racks: readonly RackPlace[], cell: Cell): boolean` = `reachableCells`에 들어 있음.

- [ ] **Step 1:** 실패하는 테스트 (`tests/floor.test.ts`):
  - `첫 랙 원점은 월드 원점`: `cellOrigin([0,0])` = `[0,0,0]`, `cellOrigin([2,-1])` = `[2,0,-2]`.
  - `트레이는 칸 폭만큼, 옆 칸 트레이와 끝이 맞닿음`: `trayGuide({id:'rack-1',cell:[0,0]}).b[0] === trayGuide({id:'rack-2',cell:[1,0]}).a[0]`, `a[1] > RACK_HEIGHT`.
  - `바로 옆 칸은 초록, 랙 있는 칸·바닥 밖은 아님`: 랙 `[0,0]` → `[1,0]`·`[-1,0]`·`[0,1]` 포함, `[0,0]` 불포함, `[8,0]` 불포함.
  - `너무 먼 칸은 초록 아님`: 랙 `[0,0]` → `[7,0]`·`[0,4]` 불포함.
  - `체인: 새 랙 옆 칸도 초록`: 랙 `[0,0]`,`[4,0]` → `[6,0]`은 `[4,0]` 덕에 포함 여부가 `worstUplinkLength([4,0],[6,0]) * 1.02 <= 10`과 같음.
- [ ] **Step 2:** `npx vitest run tests/floor.test.ts` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npx vitest run` → PASS, `npm run build`. Commit `Floor cells, rack tray guide, reachable cells`

### Task 3: 랙 여러 대 Room

**Files:**
- Modify: `src/view/room.ts`, `src/rack/device.ts`, `src/cable/cable.ts` (`Port.rack`), `src/cable/manager.ts` (`deviceRings`가 `origin`을 더함), `src/cable/guide.ts`, `src/view/scene.ts` (랙 메시 export, Stage에서 `rack` 제거, 트레이 메시), `src/main.ts` (`createStartRoom(stage.scene)`·`restoreRoom(stage.scene, saved)`), `src/rack/placement.ts`·`src/main.ts`의 `room.rack`·`room.slots` 사용처 (임시로 `room.racks[0].group`·`room.racks[0].slots` — Task 7에서 여러 랙), `src/view/tie.ts:83-84`(그대로 동작 확인만)
- Modify: 테스트 25곳의 `createStartRoom(new THREE.Scene(), new THREE.Group())`·`restoreRoom(new THREE.Scene(), new THREE.Group(), …)` → 두 번째 인자 삭제 (`sed -i 's/, new THREE.Group()//' tests/*.ts`)
- Test: `tests/racks.test.ts`

**Interfaces:**
- Consumes: Task 1 `PowerDevice.uplink`, Task 2 `floor.ts` 전부, `Guide.rack/origin/tray`.
- Produces:
  - `scene.ts`: `export function createRackMesh(): THREE.Group` (지금 `createRack` 그대로, 원점 기준), `export function createTrayMesh(trayId: string): THREE.Group` (트레이 바닥판+양 옆 낮은 벽, 랙 원점 기준 `TRAY_Y`·`TRAY_Z`, 폭 `CELL_X`, 깊이 0.12; 메시마다 `userData.deviceId = trayId` — 가이드 밝힘용, `solid` 아님). `Stage`에서 `rack` 필드 삭제.
  - `Device.rack: string`, `Device.origin: Vec3`. `createRackDevice(id, defId, u, site: { id: string; origin: Vec3 })`, `createPdu(id, side, site)`, `createSideManager(id, side, site)` — `group.position`을 origin으로, 포트 `pos`에 origin을 더하고 `port.rack = site.id`. 메시 로컬 좌표는 지금 그대로.
  - `Port.rack: string`.
  - `deviceRings(d)`가 `d.origin`(없으면 원점)을 더함 → `guideOf(d)`가 장비의 `rack`·`origin`을 그대로 받음.
  - `export interface RackSite { id: string; cell: Cell; origin: Vec3; slots: RackSlots; group: THREE.Group }`
  - `Room` 생성자 `constructor(scene: THREE.Scene)` (랙 그룹 인자 없음). `readonly racks: RackSite[]`. `Room.slots` 삭제 → `rack.slots`.
  - `Room.addRack(cell: Cell, id = \`rack-${this.racks.length + 1}\`): RackSite | null` — 이미 그 칸에 랙이 있으면 null. 랙 메시+트레이 메시를 origin에 두고 장면에 추가, 프레임 충돌 상자를 월드에 더함, `layoutVersion++`, `events.emit('rack:added', { rackId })`. 초록 판정은 하지 않음(호출하는 쪽 몫 — 불러오기는 판정 없이 세움).
  - `Room.rack(id: string): RackSite | undefined`, `Room.rackAt(cell: Cell): RackSite | undefined`.
  - `Room.install(defId, u, rackId = this.racks[0].id, id?)`, `Room.freeSide(defId, rackId = first)`, `Room.addSide(defId, rackId = first, side?, id?)`, `Room.addPdu(rackId = first, side?, id?)` — 해당 랙 슬롯·옆면 기준.
  - `Room.guides()` = 장비 가이드 + 랙마다 `trayGuide`.
  - `Room.layoutVersion: number` — 가이드가 생기거나 없어질 때(매니저 설치·제거, 랙 추가) 1 늘림 (Task 4 미리보기 캐시용).
  - `Room.updatePower`: 판정 전에 `d.power.uplink = d.power.role === 'switch' && d.rack === this.racks[0].id` (Task 1 임시 코드 교체).
  - `snapshot()`에 `racks: { id, cell }[]`, 장비마다 `rack` (저장 형식 자체는 Task 5 — 여기서는 타입 `SaveData`에 `racks?`·`SavedDevice.rack?`을 선택 필드로 먼저 더해 둠). `restore`는 `data.racks ?? [{ id: 'rack-1', cell: [0, 0] }]`로 랙을 먼저 세우고, 장비는 `d.rack ?? 'rack-1'` 랙에 (그 랙이 없으면 건너뜀).
  - `createStartRoom(scene)`: `addRack([0,0])` 뒤 지금과 같음. `restoreRoom(scene, data)`.
  - 이벤트(`events.ts`): `'rack:added': { rackId: string }`.

- [ ] **Step 1:** 테스트 인자 일괄 수정 (`sed`) — 아직 컴파일만 깨짐.
- [ ] **Step 2:** 실패하는 테스트 (`tests/racks.test.ts`):
  - `둘째 랙을 세우면 그 칸 원점에 장비·포트·가이드가 옮겨짐`: 시작 방 + `addRack([1,0])` → `install('switch-8', 1, 'rack-2')` 포트 `pos[0]`이 첫 랙 같은 스위치 포트 x + 1.0 (1e-9), `port.rack === 'rack-2'`; `install('cable-manager', 5, 'rack-2')`의 가이드 x 범위 중심 ≈ 1.0.
  - `같은 칸엔 두 번 못 세움`: `addRack([0,0])` → null.
  - `랙마다 슬롯이 따로`: `rack-2`의 U1이 비어 있어 `install('server-entry', 1, 'rack-2')` 성공(첫 랙 U1은 스위치).
  - `트레이가 가이드 목록에 랙마다 하나`: 랙 2대 → `guides().filter(g => g.tray).length === 2`.
  - `둘째 랙 서버는 업링크 전엔 nolink, 첫 랙 스위치에 랜선을 이으면 가동`: rack-2에 PDU·스위치·엔트리 서버 + `wire`로 전원·랜 배선, 전원 켬 → `BOOT_MS` 뒤 `incomePerSec === 1`(첫 랙 엔트리만), 엔트리2 `nolink` → `room.wire(첫 랙 스위치 빈 랜 포트, rack-2 스위치 빈 랜 포트)` → `BOOT_MS` 뒤 `incomePerSec === 2`.
- [ ] **Step 3:** `npx vitest run` → 새 테스트 FAIL, 기존 테스트는 컴파일 에러.
- [ ] **Step 4:** 구현. `grep -rn "room.slots\|stage.rack\|room.rack\b" src tests` 결과 비어야 함.
- [ ] **Step 5:** `npx vitest run` → PASS, `npm run build` 성공. Commit `Multiple racks in one room`

### Task 4: 랙 사이 트레이 경로·길이 판정·미리보기 캐시

**Files:**
- Modify: `src/cable/route.ts`, `src/view/room.ts` (`addCable`·`spawnCable` 길이, `routeCable`, `routeWith`, 새 `routeFits`·`canReplug`), `src/main.ts:91-104` (`reinstall`의 `canReach` → `room.canReplug`), `src/view/guide.ts` (미리보기 `findRoute` 캐시)
- Test: `tests/uplinkRoute.test.ts`

**Interfaces:**
- Consumes: Task 2 `trayGuide`·`worstUplinkLength`·`cellOrigin`, Task 3 `Port.rack`·`Guide.rack/origin/tray`·`Room.addRack`·`layoutVersion`.
- Produces (`route.ts`):
  - `findRoute(a: Port, b: Port, guides: readonly Guide[], dropped: string, maxLen = Infinity): Guide[] | null`
    - 같은 랙(`a.rack === b.rack`): 지금 규칙 그대로, 단 후보는 `g.rack === a.rack && !g.tray`인 가이드만. `dropped`가 트레이면 null.
    - 다른 랙: `seq = [hA, vA, ...트레이, vB, hB]`에서 없는 것은 뺌. `hA` = a 랙 가로 매니저 중 `NEAR` 안 가장 가까운 것, `vA` = a 랙 세로 매니저 중 b 랙 쪽 옆(b 원점 x가 크면 오른쪽 side 1, 작으면 왼쪽 0, 같으면 a 포트 x 쪽) — 그쪽이 없으면 반대쪽, 둘 다 없으면 없음. 트레이 = a 랙 트레이, (두 랙이 같은 줄 `cell[1]`이면) 사이 x칸에 있는 랙들의 트레이를 x 순서로, b 랙 트레이. b 쪽은 대칭. `dropped`가 seq에 없으면 null. `pathLength(routePath(a, b, seq)) * REACH_SLACK > maxLen`이면 null.
  - `export const REACH_SLACK = 1.02` (`reach.ts`의 같은 이름 상수를 이것으로 import해 하나로)
  - `export function hasTray(seq: readonly Guide[]): boolean`
  - `routeLayout` 변경: (1) 랙 옆 x(`hangLeg`의 `side * SIDE_RING_X`)와 `sideOf`의 부호 판정을 그 가이드의 `origin[0]` 기준으로. (2) 끝마다 따로 옆을 정함: 트레이에 붙는 끝은 `directEnds`가 false(늘 랙 옆으로 늘어뜨려 오름)이고, 옆 = 그 끝 랙에서 상대 랙 쪽(위 `vA` 규칙과 같은 방향). (3) 트레이에 붙을 때 늘어뜨리는 출발점은 트레이 끝이 아니라 트레이 위 `x = origin[0] + side * SIDE_RING_X` 점.
- Produces (`room.ts`):
  - `Room.spawnCable(kind: PortKind, paid = 0, length = CABLE_DEFAULT_LENGTH, rackId = first): Cable` (`addCable`도 `length`를 받음) — 그 랙 원점 기준 뒤 바닥(지금 자리)에, 선 길이만큼 지그재그로 접어 깖: 폭 0.92m 줄을 z로 0.06m씩 뒤로 늘려 총 길이 ≥ `length`가 될 때까지 (2m는 지금 모양과 같은 U자 한 번).
  - `routeCable(cable, guideId)`가 `findRoute(..., cable.rope.length)`.
  - `routeFits(cable: Cable, guideIds: readonly string[]): boolean` — 양 끝 꽂힘, 가이드 모두 있음, 트레이가 있으면 길이 조건. `routeWith`는 이걸로 먼저 검사(트레이 없는 경로는 지금처럼 길이 무시).
  - `canReplug(cable: Cable, end: CableEnd, port: Port, route: Route | null): boolean` — `canReach(cable, endNode(cable, end), port.pos)`이거나, `route`가 있고 그 경로를 이 포트로 깔았을 때 `routeFits`와 같은 조건(트레이 없으면 참, 있으면 길이)을 만족. 반대쪽 끝이 안 꽂혀 있으면 `canReach`만.
- `guide.ts` 미리보기: `findRoute` 결과를 키 `${cable.id}|${guide.id}|${a.id}|${b.id}|${room.layoutVersion}`로 기억해 키가 같으면 다시 부르지 않음 (지금 `previewKey`와 합침).

- [ ] **Step 1:** 실패하는 테스트 (`tests/uplinkRoute.test.ts`, 헬퍼: 시작 방 + `addRack(cell)` + 그 랙 U1 `switch-24` + 첫 랙 스위치, 선은 `room.spawnCable('lan', 0, 10)` + `plug` 두 번):
  - `10m 선은 길이 10, 2m 선은 지금과 같은 모양`: `spawnCable('lan', 0, 10).rope.length` ≈ 10, 마디가 모두 y < 0.05 (바닥에 접힘), `spawnCable('lan').rope.length` ≈ 2.
  - `옆 랙 스위치끼리 트레이를 지나는 경로`: `[1,0]` 랙, 10m 선을 두 스위치 랜 포트에 꽂고 `routeCable(c, 'rack-1:tray')` → true, `route.guides`가 `['rack-1:tray', 'rack-2:tray']`, 경로 점 최고 y ≥ `TRAY_Y - 0.01`, 어느 점도 두 랙 몸체(원점 ± [0.3, ·, 0.5], y < RACK_HEIGHT)의 안쪽 2cm 안으로 안 들어감.
  - `2m 선은 트레이 경로 거절`: 같은 배치, 2m 선 → `routeCable` false, `route === null`.
  - `사이 랙 트레이를 차례로 지남`: 랙 `[1,0]`, `[2,0]`, 첫 랙 ↔ `[2,0]` 랙 → guides에 `rack-2:tray`(가운데)가 순서대로 들어 있음.
  - `세로 매니저가 있으면 그걸 타고 오름`: 첫 랙 오른쪽에 세로 매니저 → 첫 랙 쪽 seq가 `[세로, 'rack-1:tray', …]`.
  - `같은 랙 안에선 다른 랙 매니저를 안 씀`: 랙 2대 다 U5 가로 매니저, 첫 랙 안 선을 첫 랙 매니저에 놓으면 결과에 rack-2 가이드 없음; rack-2 매니저에 놓으면 null.
  - `초록 칸 가장자리는 U1 스위치끼리도 10m로 닿음`: `reachableCells([{id:'rack-1',cell:[0,0]}])` 중 `worstUplinkLength`가 가장 큰 칸 셋(같은 줄 가장 먼 칸, 다른 줄 칸, 대각선)마다: 거기 랙을 세우고 양쪽 U1 `switch-24`의 상대 랙에서 먼 쪽 끝 포트(x −0.2 또는 +0.2 중 상대 랙 반대쪽)끼리 10m 선 → `routeCable` true, 실제 `pathLength(routePath(...))` ≤ `worstUplinkLength(...)`.
  - `옮긴 뒤 트레이 경로가 길이를 넘으면 경로만 풀림`: 트레이 경로 10m 선(rack-1 ↔ `[1,0]` rack-2 스위치)의 route를 복사해 두고 rack-2 스위치를 `remove`. (a) 같은 스위치를 rack-2 U2에 같은 id로 다시 끼움 → `canReplug(c, end, 그 포트, route)` true, `plug` 뒤 `routeWith(c, route.guides, route.tied)` true. (b) 대신 `addRack([6,0])`(판정 없이) 랙 U1에 같은 id로 끼움 → 직선거리 < 10m라 `canReplug` true(`canReach`), `plug` 뒤 `routeWith` false(경로 > 10m), `c.route === null`, 두 끝 다 꽂힘.
- [ ] **Step 2:** `npx vitest run tests/uplinkRoute.test.ts` → FAIL.
- [ ] **Step 3:** 구현. 기존 `tests/route.test.ts`·`tests/tidy.test.ts`는 손대지 않고 통과해야 함 (한 랙 동작 그대로).
- [ ] **Step 4:** `npx vitest run` → PASS, `npm run build`. Commit `Route cables between racks over the tray`

### Task 5: 긴 랜선과 저장 v2

**Files:**
- Modify: `src/data/catalog.ts` (`CableDef.length`, `'cable-lan-long'`, `SHOP_CABLES`), `src/view/room.ts` (`snapshot`·`restore`), `src/game/save.ts`, `src/main.ts` (`onBuyCable`이 `CABLES[id].length` 전달 — 고른 랙은 Task 7)
- Test: `tests/save.test.ts`

**Interfaces:**
- Produces:
  - `CableDefId`에 `'cable-lan-long'`. `CableDef.length: number` (기존 둘은 `CABLE_DEFAULT_LENGTH`). `CABLES['cable-lan-long'] = { id, name: '랜선 10m', kind: 'lan', price: 50, length: LONG_LAN_LENGTH }`. `SHOP_CABLES = ['cable-lan', 'cable-lan-long', 'cable-power']`.
  - `SAVE_VERSION = 2`. `SaveData.racks: SavedRack[]` (`{ id: string; cell: [number, number] }`), `SavedDevice.rack: string`, `SavedCable.length?: number` (없으면 2). Task 3에서 선택으로 둔 필드를 필수로.
  - `parseSave`: `v === 1`이면 형식 검사 뒤 `racks = [{ id: 'rack-1', cell: [0, 0] }]`, 장비마다 `rack = 'rack-1'`, `v = 2`로 바꿔 돌려줌. `v === 2`는 racks(id 문자열·cell 정수 둘)·device.rack 문자열 검사. **선 하나의 `route`가 형식이 틀리면 그 선의 `route`만 지우고** 나머지는 통과 (지금은 전체 null). `ties`도 같음.
  - `restore`: `addCable`이 `saved.length ?? CABLE_DEFAULT_LENGTH`로 로프를 만듦. 장비의 `rack`이 저장된 랙 목록에 없으면 그 장비만 건너뜀.

- [ ] **Step 1:** 실패하는 테스트 (`tests/save.test.ts`):
  - `랙 2대·10m 선 왕복`: 시작 방 + `addRack([1,0])` + rack-2 스위치 + `spawnCable('lan', 50, 10, 'rack-2')`를 두 스위치에 꽂고 트레이 경로 → `roundTrip` → `back.racks.map(r => [r.id, r.cell])` 같음, 그 선 `rope.length === 10`, `route` 같음, rack-2 스위치 포트 위치 같음.
  - `v1 저장은 rack-1 한 대로 읽음`: 시작 방 snapshot에서 `racks`·`rack`을 지우고 `v: 1`로 만든 JSON → `parseSave` null 아님, `racks`가 `[{id:'rack-1',cell:[0,0]}]`, `restoreRoom` 뒤 `incomePerSec === 1`.
  - `경로 하나가 깨져도 나머지는 불러옴`: 선 두 개에 route, 하나의 `route.guides`를 `[1]`로 망가뜨림 → `parseSave` null 아님, 망가진 선만 `route` 없음, 다른 선 route 그대로.
  - `상점 10m 랜선은 50원, 길이 10`: `CABLES['cable-lan-long']`이 `{ price: 50, length: 10, kind: 'lan' }`를 포함, 기존 두 케이블 `length === 2`.
- [ ] **Step 2:** `npx vitest run tests/save.test.ts` → FAIL.
- [ ] **Step 3:** 구현. 상점 카드는 `CABLES[id].name`을 그대로 쓰므로 따로 손볼 것 없음 (확인만).
- [ ] **Step 4:** `npx vitest run` → PASS, `npm run build`. Commit `Long LAN cable and save format v2 with rack list`

### Task 6: 랙 사기와 자리 고르기

**Files:**
- Modify: `src/data/catalog.ts` (`RACK_DEF`), `src/game/state.ts` (`bought` 키에 `'rack'`), `src/ui/shop.ts` (랙 카드), `src/main.ts`, `src/view/camera.ts` (내려다보기)
- Create: `src/view/rackPlacement.ts`
- Test: `tests/economy.test.ts`

**Interfaces:**
- Consumes: Task 2 `reachableCells`·`cellAt`·`cellOrigin`·`CELL_X/Z`, Task 3 `Room.addRack`·`racks`.
- Produces:
  - `catalog.ts`: `export const RACK_DEF = { id: 'rack', name: '랙', price: 100000 } as const`. `priceOf`가 `{ price: number }`만 받게 타입을 넓힘 (`priceOf(def: Pick<DeviceDef, 'price'>, bought)`).
  - `GameState.bought: Partial<Record<DeviceDefId | 'rack', number>>`, `boughtCount(state, id: DeviceDefId | 'rack')`.
  - `ShopDeps`에 `rackPrice(): number`, `rackBlocked(): string | null`, `onBuyRack(): void`, `placingRack(): boolean`(카드에 "자리 고르는 중 · 다시 누르면 취소" 표시). 랙 카드는 장비 목록 맨 위 `랙 · 42U · 바닥에 세움`.
  - `rackPlacement.ts`: `createRackPlacement(deps: { canvas; camera; scene; room: Room; rig: CameraRig; place(cell: Cell): void }): RackPlacement`, `interface RackPlacement { readonly active: boolean; start(): void; cancel(): void }`.
    - `start()`: 초록 칸(`reachableCells(room.racks)`)마다 바닥 위 반투명 초록 사각(칸 크기보다 각 변 6cm 작게, y 0.003)을 깔고, `rig.overview(가운데)`. 커서 칸(바닥 평면 y=0 레이캐스트 → `cellAt`)에 반투명 랙 상자(폭 0.6, 높이 `RACK_HEIGHT`, 깊이 1.0) — 초록 칸이면 초록, 아니면 빨강.
    - 왼쪽 클릭: window 캡처 단계에서 먼저 받아 `stopImmediatePropagation`. 초록 칸이면 `place(cell)` 후 끝냄, 아니면 아무것도 안 함. Esc·`cancel()`: 끝냄. 끝낼 때 표시를 지우고 `rig.leaveOverview()`.
  - main: `onBuyRack` = 고르는 중이면 `cancel`, 아니면 돈이 랙 값 이상일 때 `start`. `place(cell)`: `spend(state, price)` 실패면 `flashHint('돈이 모자라요')`; 성공이면 `bought.rack++`, `room.addRack(cell)`, 고른 랙을 새 랙으로(Task 7 `selectRack`, 이 태스크에선 카메라만 `rig.focus`), 안내 `'랙을 세웠어요 · 스위치·PDU를 달고, 스위치를 인터넷에 닿은 랙 스위치에 랜선 10m로 이으세요'`. 고르는 동안 다른 입력(장비 들기·케이블)은 막힘: `placement.cancel()` 먼저, `busy()` 계열 deps에 `rackPlacement.active` 더함.
  - `camera.ts`: `CameraRig.overview(center: Vec3): void` — 지금 카메라·target을 기억하고 `center + (0, 9, 6)`에서 `center`를 보도록 0.6초 tween. `CameraRig.leaveOverview(): void` — 기억한 자리로 tween (그새 `focus`가 불렸으면 그 랙 기준 자리). `maxDistance` 7 → 14.

- [ ] **Step 1:** 실패하는 테스트 (`tests/economy.test.ts`): `랙 값은 100,000원에서 1.25배씩`: `priceOf(RACK_DEF, 0) === 100000`, `priceOf(RACK_DEF, 1) === 125000`; `boughtCount(createGameState(0), 'rack') === 0`.
- [ ] **Step 2:** `npx vitest run tests/economy.test.ts` → FAIL.
- [ ] **Step 3:** 구현 (헤드리스 부분 → 뷰·main).
- [ ] **Step 4:** `npx vitest run` → PASS, `npm run build`. 수동 확인(사용자 화면): 상점 랙 카드 → 내려다보기 + 초록 칸 → 초록 칸 클릭 시 돈 빠지고 랙이 섬, 빨간 칸 클릭은 아무 일 없음, Esc는 돈 그대로.
- [ ] **Step 5:** Commit `Buy a rack and pick its floor cell`

### Task 7: 랙 고르기·카메라·여러 랙 입력

**Files:**
- Create: `src/view/rackSelect.ts`
- Modify: `src/view/camera.ts` (`focus`, 랙 기준 앞뒤 프리셋), `src/rack/placement.ts` (여러 랙 면, `install`에 rackId), `src/ui/inspector.ts:146-152` (랙 원점 기준), `src/main.ts` (고른 랙 상태, 옆면 장비·케이블 생성 위치, 상점 막힘 이유)
- Test: 없음 (뷰). 헤드리스 판단은 Task 2·3에 있음.

**Interfaces:**
- Consumes: Task 3 `Room.racks`·`rack()`·`rackAt()`·`Device.rack/origin`, Task 5 `spawnCable(..., rackId)`, Task 6 `rackPlacement.active`.
- Produces:
  - `camera.ts`: `CameraRig.focus(origin: Vec3, aisle: { front: number; back: number }): void` — target을 `origin + (0, WORK_Y, 0)`로, 카메라는 지금 target과의 차이를 유지한 채 0.6초 tween. 앞면·뒷면 프리셋은 `origin + (0, WORK_Y, ±aisle.front|back)`. main이 `aisle`을 정함: 앞 칸(z+1)에 랙이 있으면 `front = 1.3`, 없으면 `2.7`; 뒤 칸(z−1)도 같은 규칙으로 `back`.
  - `rackSelect.ts`: `createRackSelect(deps: { canvas; camera; room: Room; busy(): boolean; select(rackId: string): void })` — 캡처 단계 pointerdown이 `defaultPrevented`가 아니고 `busy()`가 아닐 때 기록, 6px 안에서 pointerup이면 레이캐스트: 첫 맞은 물체가 **장비가 아닌** 랙 메시(프레임·트레이)이고 그 랙이 지금 고른 랙이 아니면 `select`. 장비 클릭은 지금처럼 정보 카드(카메라 안 움직임). 등록은 inspector 다음.
  - `placement.ts`: `PlacementDeps.install(defId, rackId: string, u: number, moving)`, `MovingDevice.rack: string`. `update()`는 랙마다 카메라 쪽 면(카메라 z ≥ 그 랙 원점 z면 앞면) 평면과 만나는 점을 구해 `|x − 원점 x| ≤ REACH_X`·높이 범위 안인 것 중 카메라에서 가장 가까운 랙을 고름. 미리보기 상자는 장면에 두고 월드 좌표로.
  - `inspector.ts`: 앞뒤 판정·카드 앵커에 `device.origin`을 더함.
  - main: `let selected = room.racks[0].id`. `selectRack(id)` → `selected = id`, `rig.focus(...)`. 옆면 장비(PDU·세로 매니저) 구매는 고른 랙에 붙임, `blockedReason`은 고른 랙의 옆면 자리 기준(`'이 랙 옆면 자리 없음'`), 랙 칸 장비는 어느 랙이든 빈 자리가 있으면 살 수 있음(`'모든 랙에 빈 {n}U 자리 없음'`). 케이블은 `spawnCable(kind, price, length, selected)`. `reinstall`·`save`의 손에 든 장비는 `moving.rack`으로. 장비를 든 상태 안내 문구는 `'… 랙의 빈 칸을 클릭해 끼우기'` 그대로(어느 랙이든).
  - 불러오기 직후 고른 랙 = 첫 랙.

- [ ] **Step 1:** 구현.
- [ ] **Step 2:** `npx vitest run` → PASS, `npm run build` 성공.
- [ ] **Step 3:** 수동 확인 목록(사용자 화면, `?debug`): 둘째 랙 프레임 클릭 → 카메라 이동 · 앞면/뒷면 버튼이 그 랙 기준 · 첫 랙에 있으면서 둘째 랙 칸에 서버 끼우기 · 둘째 랙 스위치 포트에 10m 선 꽂기 · 그 선을 트레이에 끌어 놓으면 점선 미리보기 → 경로 · 벨크로로 트레이 묶기 · 둘째 랙 서버 LED 빨강 → 업링크 뒤 초록 · 새로고침 뒤 그대로.
- [ ] **Step 4:** Commit `Select racks, camera follows, work on any rack`

### Task 8: 마무리 검증

- [ ] **Step 1:** `npx vitest run` 전부 통과, `npm run build` 성공 — 출력 그대로 기록.
- [ ] **Step 2:** `grep -rn "MVP 밖\|room.slots\|stage.rack" src` 비어 있음.
- [ ] **Step 3:** spec 대조: 3.1~3.6, 4, 5, 6의 각 항목이 어느 태스크에서 됐는지 한 줄씩 확인, 빠진 것 보고.
- [ ] **Step 4:** 사용자에게 화면 확인 요청(`git pull` 후 `npm run dev`), Task 7 Step 3 목록 전달. push는 묻고.
