# MVP 구현 계획 — 서버실 방치형

- 작성일: 2026-10-25
- 근거 문서: [GDD-피벗-서버실-방치형.md](GDD-피벗-서버실-방치형.md)
- 목적: 프로토타입이자 이후 확장의 뼈대. **핵심 루프 한 바퀴(돈 → 구매 → 설치 → 배선 → 수익 증가)만** 돈다
- 화면: 전체화면 3D 무대 + 그 위에 떠 있는 2D HUD

---

## 1. MVP 범위

GDD 마일스톤 P0~P2 전체 + P3 중 자연스럽게 따라오는 제약 두 개.

| 넣음 | 뺌 (뼈대만 열어 둠) |
|---|---|
| 3D 케이블 물리 (Verlet, 캡슐↔상자 충돌) | 케이블끼리 충돌·마찰 (M1 성능 여유 보고 결정) |
| 케이블 잡기·끌기·꽂기·뽑기 | 빗·벨크로·케이블 매니저 |
| 자유 카메라 + 앞/뒤 작업 시점 스냅 | 줄이기 도구 (케이블 `length` 필드만 둠) |
| 상점 → 손에 들기 → U 칸에 끼우기 | 발열·공기 흐름·스로틀링 |
| 전원 버튼 → 부팅 → 가동 판정 | 냉각 장비, 랙 증설 |
| 초당 수익(실제 시간), 가격 ×1.15, 해금 | 장애 이벤트, 효과음, 연출 |
| 스위치 포트 수 제약, PDU 용량 초과 시 차단기 | 오프라인 수익 (GDD상 영구 제외) |
| 저장/불러오기 (케이블 마디 좌표 포함) | |

**MVP 완료 기준**: 시작 상태(스위치+엔트리 서버 가동, 초당 1원)에서 15분 플레이하며 웹 서버 3대 이상을 손으로 사서 끼우고 배선해 수익을 올릴 수 있다. 새로고침해도 배치·배선·케이블 모양이 그대로 남는다.

---

## 2. 기술 스택

| 항목 | 선택 | 이유 |
|---|---|---|
| 빌드 | Vite + TypeScript | 웹 배포, 빠른 HMR |
| 3D | Three.js | GDD의 튜브 렌더링·카메라 구조와 맞음 |
| 카메라 | `OrbitControls` (three/examples) | 자유 회전·줌·팬 기본 제공 |
| HUD | 순수 DOM + CSS (프레임워크 없음) | 패널 몇 개뿐. 상태 구독 → 해당 DOM만 갱신 |
| 물리 | 자체 구현 Verlet 3D | 케이블 전용 조건(굽힘·포트 고정)이 많아 범용 엔진보다 단순 |
| 테스트 | Vitest (헤드리스) | 경제·포맷·저장·로프 안정성은 렌더 없이 검증 |
| 저장소 | https://github.com/tnghgks/untangle_the_rack (기본 브랜치 `main`) | |
| 배포 | GitHub Pages + GitHub Actions | 정적 빌드만으로 돌아가는 게임. 아래 2.1 |

> 참고: GDD 10장은 이전 게임 코드를 재사용한다고 되어 있지만, 원격 저장소는 비어 있고 이 폴더에도 문서만 있다. 따라서 **새로 시작**한다. 이전 코드를 따로 구할 수 있으면 `core/`·`cable/rope.ts`를 이식해 M0~M1을 줄인다.

### 2.1 GitHub Pages 배포

- 주소: `https://tnghgks.github.io/untangle_the_rack/`
- `vite.config.ts`의 `base: '/untangle_the_rack/'` — 에셋 경로가 하위 경로 기준이 되도록. 코드에서 정적 파일은 `import.meta.env.BASE_URL` 기준으로 참조
- 워크플로 `.github/workflows/deploy.yml`: `main`에 push 시 `npm ci` → `npm test` → `npm run build` → `actions/upload-pages-artifact`(`dist/`) → `actions/deploy-pages`. 테스트가 실패하면 배포하지 않음
- 저장소 설정 1회: Settings → Pages → Source를 **GitHub Actions**로 (사용자가 직접, 또는 승인 후 `gh api`로)
- 주의: `tnghgks.github.io` 아래 다른 저장소의 페이지와 origin이 같아 **localStorage를 공유**한다 → 저장 키는 `untangle_the_rack:save:v1`처럼 접두사와 버전을 붙임 (버전은 저장 형식이 바뀔 때 마이그레이션용)
- 라우팅 없는 단일 페이지라 404 대체 페이지는 필요 없음

---

## 3. 화면 구성

```
┌──────────────────────────────────────────────────────────┐
│ 💰 1.23만원   +45원/초   ⚡ 1,250/3,000W            [⚙]  │ ← 상단 바
│                                              ┌─────────┐ │
│                                              │ 상점     │ │
│                3D 랙 (전체화면 캔버스)         │ 웹서버   │ │ ← 오른쪽 패널
│                                              │ 400원    │ │   (접기 가능)
│        [장비 클릭 시 정보 카드가 근처에 뜸]     │ ...     │ │
│                                              └─────────┘ │
│        [앞면] [뒷면] [자유]      [✋ 손]                  │ ← 하단 툴바
└──────────────────────────────────────────────────────────┘
```

- 캔버스: `position: fixed; inset: 0`, 창 크기 변경 시 렌더러·카메라 비율 갱신, `devicePixelRatio` 최대 2
- HUD 루트: 캔버스 위 `position: fixed; inset: 0; pointer-events: none`. 패널·버튼만 `pointer-events: auto` → 빈 곳 클릭은 3D로 통과
- 정보 카드: 장비의 3D 위치를 화면 좌표로 투영해 따라다님

### 3.1 입력 매핑

| 입력 | 빈 공간 | 케이블·커넥터 위 | 장비를 든 상태 |
|---|---|---|---|
| 좌클릭 드래그 | 카메라 회전 | 잡고 끌기 | — |
| 좌클릭 | 장비 선택(정보 카드) | 꽂힌 커넥터 뽑기 | 미리보기 칸에 끼우기 |
| 우클릭 드래그 | 팬 | 팬 | 팬 |
| 휠 | 줌 | (끄는 중) 잡은 점 앞뒤 이동 | 줌 |
| Esc | — | 끌기 취소 | 들기 취소(환불) |

- 포인터 다운 시 레이캐스트로 먼저 판정 → 케이블/커넥터면 `OrbitControls.enabled = false`, 놓으면 복구
- 끄는 점은 카메라를 바라보는 평면 위에서 이동 (GDD 6.2 안). 포트 반경 안에선 자석 보정

---

## 4. 코드 구조

```
src/
  main.ts                 부트스트랩: 씬·루프·HUD·저장 불러오기 연결
  core/
    loop.ts               60Hz 고정 스텝 + 렌더 분리, 따라잡기 최대 4스텝
    events.ts             이벤트 버스 (타입 있는 emit/on)
    rng.ts                시드 RNG
  data/
    catalog.ts            장비 정의 표 (GDD 3.1 그대로, 숫자 한 곳에 모음)
    units.ts              U 높이(0.04445m), 랙 치수, 케이블 기본 2m
  game/
    state.ts              GameState: 돈, 구매 횟수, 장비, 케이블, 해금 — 단일 소스
    economy.ts            가격 성장, 수익 계산(Date.now 차이), 해금 판정
    power.ts              가동 판정 그래프 + PDU 용량·차단기
    save.ts               직렬화/역직렬화, 10초 자동 저장 + beforeunload
  rack/
    rack.ts               42U 슬롯 점유표, 빈 칸 찾기
    device.ts             장비 엔티티: 포트 목록, 전원 상태(off/booting/running/tripped)
    placement.ts          '손에 든' 장비 미리보기 → 끼우기
  cable/
    rope.ts               Verlet 3D: 위치·이전 위치, 길이 제약, 굽힘, 감쇠
    collide.ts            캡슐↔AABB 밀어내기 (랙 프레임·장비·바닥)
    cable.ts              케이블 엔티티: 마디, 양 끝 커넥터, 꽂힌 포트
    plug.ts               스냅 반경 판정, 종류 일치(랜/전원) 확인, 뽑기
    cableMesh.ts          튜브 지오메트리 (버퍼 재사용, 매 프레임 정점만 갱신)
  view/
    scene.ts              렌더러·조명·바닥·랙 메시
    camera.ts             OrbitControls + 작업 시점 스냅(트윈)
    pick.ts               레이캐스트 (케이블·커넥터·장비·포트 레이어 분리)
    drag.ts               카메라 평면 드래그 + 휠 깊이 + 자석
  ui/
    hud.ts                HUD 루트, 상태 구독
    topbar.ts             돈·초당 수익·전원
    shop.ts               장비 카드, 잠김 표시, 구매
    inspector.ts          장비 정보 카드 (화면 투영)
    toolbar.ts            작업 시점 버튼, 도구 선택
    format.ts             만·억·조 축약, 유효숫자 3자리
  styles.css
.github/workflows/
  deploy.yml              main push → 테스트 → 빌드 → Pages 배포
vite.config.ts            base: '/untangle_the_rack/'
tests/
  format.test.ts  economy.test.ts  power.test.ts  save.test.ts  rope.test.ts
```

**의존 방향**: `data` ← `game` ← `rack`/`cable` ← `view`/`ui` ← `main`. `game`·`cable/rope`는 Three.js를 import하지 않아 헤드리스 테스트가 가능하다 (벡터는 `Float32Array`로 직접 다룸).

### 4.1 핵심 데이터 모델

```ts
type PortKind = 'lan' | 'power';
interface Port   { id: string; deviceId: string; kind: PortKind; role: 'in' | 'out'; local: Vec3; cableEnd?: CableEndRef }
interface Device { id: string; defId: DeviceDefId; u: number | null /* PDU는 옆면 */; on: boolean; bootUntil: number; ports: Port[] }
interface CableEnd { portId: string | null; }      // null = 늘어져 있음
interface Cable  { id: string; kind: PortKind; length: number /* 2.0m */; nodes: Float32Array; a: CableEnd; b: CableEnd }
interface GameState { money: number; lastTick: number; bought: Record<DeviceDefId, number>; devices: Device[]; cables: Cable[]; held: DeviceDefId | null }
```

### 4.2 가동 판정 (`power.ts`)

장비가 **running**이려면: `on` && 부팅 끝남 && 전원 포트 ↔ 차단 안 된 PDU 콘센트 && (서버면) 랜 포트 ↔ running 상태 스위치 포트.
배선이 바뀔 때마다(이벤트) 다시 계산하고, PDU별 소비 전력 합이 용량을 넘으면 그 PDU를 `tripped`로 → 연결된 장비 전부 off. 리셋은 PDU 클릭.

### 4.3 수익 (`economy.ts`)

- `setInterval(250ms)`와 렌더 루프 양쪽에서 `tick(Date.now())` 호출. `money += incomePerSec × (now − lastTick) / 1000` → 백그라운드 탭에서도 실제 시간 기준 (GDD 3.2)
- 저장 시 `lastTick`은 저장하지 않음: 불러온 시점부터 다시 쌓음 (오프라인 수익 없음)
- 가격 = `basePrice × 1.15^bought[def]`

### 4.4 시작 상태

랙 42U, 옆면 PDU 1개(3,000W), U1에 스위치 8포트, U3에 엔트리 서버. 전원선 2가닥·랜선 1가닥이 이미 꽂혀 가동 중. 초당 1원.
> 가정: GDD 시작 상태엔 PDU가 없지만 전원 연결이 필요하므로 시작 PDU를 지급한다.

---

## 5. 구현 순서

리스크가 가장 큰 3D 케이블을 먼저 검증하고(GDD 11장 원칙), 그 뒤로 루프를 이어 붙인다. 각 단계 끝에 실행해서 확인한다.

| 단계 | 내용 | 확인 방법 |
|---|---|---|
| **M0 뼈대** | Vite+TS+Three 세팅, 전체화면 캔버스, 랙 메시(박스 조합), OrbitControls, 고정 스텝 루프, HUD 루트에 더미 상단 바·툴바, 앞/뒤/자유 시점 스냅. **Pages 배포 워크플로까지 함께** 올려 이후 단계마다 바로 웹에서 확인 | 랙을 자유롭게 돌려 보고, HUD 버튼은 클릭되고 빈 곳 드래그는 카메라로 감. 배포 주소에서 같은 화면이 뜸 |
| **M1 케이블 프로토타입** ⚠️ | `rope.ts`·`collide.ts`·`cableMesh.ts`, 레이캐스트로 잡기, 카메라 평면 드래그 + 휠 깊이, 포트 스냅·뽑기. 테스트용 장비 상자 몇 개에 케이블 5가닥 | 장비·랙을 뚫지 않음, 놓으면 몇 초 안에 멈춤. **스트레스 씬 50가닥 60fps** 측정 |
| ↳ 판정 | 성능·조작감이 안 되면 GDD 대안(배선만 앞/뒷면 평면)으로 전환 검토 | 사용자와 결정 |
| **M2 장비 설치** | `catalog`, `rack` 슬롯표, 상점 패널 → 들기 → 빈 칸 미리보기(초록/빨강) → 끼우기. 뒷면 포트 표시(빈 포트 깜빡임), 앞면 전원 버튼·LED | 웹 서버를 사서 원하는 칸에 끼움, 뒷면에서 포트 보임 |
| **M3 가동·경제** | `power.ts` 가동 판정, 부팅(3초, LED 노랑→초록), `economy.ts` 수익·가격 성장·해금, 상단 바 갱신, `format.ts`, 장비 정보 카드 | 시작 상태에서 초당 1원, 새 서버 배선 후 켜면 수익 증가. 탭을 숨겼다 돌아와도 밀린 시간만큼 더해짐 |
| **M4 제약** | 스위치 포트 부족(스위치 24포트 판매), PDU 용량 초과 → 차단기·리셋, PDU 추가 구매 | 일부러 과부하를 걸어 차단기 내려감 → PDU 추가로 해결 |
| **M5 저장** | 상태 직렬화(마디 좌표 소수 3자리), 10초 자동 저장 + 창 닫을 때, 불러온 직후 물리 몇 스텝 안정화 | 엉킨 상태로 새로고침 → 모양 그대로 |
| **M6 다듬기** | 15분 플레이로 가격·수익 첫 조정, 버그 정리 | 배포 주소에서 MVP 완료 기준 통과 |

헤드리스 테스트는 단계마다 같이 추가: M1 `rope`(정지 수렴·길이 유지), M3 `economy`·`power`·`format`, M5 `save` 왕복.

---

## 6. 수치 기준 (첫 짐작)

| 항목 | 값 |
|---|---|
| 랙 | 폭 0.6m × 깊이 1.0m × 42U(1.87m) |
| 케이블 | 기본 2m, 마디 간격 4cm → 50마디, 반지름 랜 3mm / 전원 4mm |
| 물리 | 60Hz, 제약 반복 8회, 감쇠 0.98, 스텝당 이동 상한 2cm |
| 포트 스냅 반경 | 3cm (자석 보정 시작 6cm) |
| 부팅 시간 | 3초 |

---

## 7. 확장 지점 (MVP 이후 붙일 자리)

- **발열·공기 흐름**: `device.ts`에 배기구 상자 정의만 두고, `game/thermal.ts`가 케이블 마디↔배기구 상자 교차 길이로 점수 계산 → `economy` 수익 배율 하나로 연결
- **정리 도구**: `toolbar`의 도구 슬롯 + `cable.ts`의 `length` 필드 → 줄이기·빗·벨크로가 같은 드래그 경로를 공유
- **장애 이벤트**: `events.ts`에 이벤트 타입 추가, `plug.ts`의 강제 뽑기 함수 재사용
- **랙 증설**: `rack.ts`를 배열로 — `GameState.racks[]`로 처음부터 배열로 잡아 둔다

## 8. 확인이 필요한 것

1. ~~이전 게임 코드 재사용~~ → 원격 저장소가 비어 있어 새로 시작 (10-25)
2. ~~시작 PDU 지급 가정 (4.4)~~ → 기본 지급 확정 (10-25)
3. Pages Source를 GitHub Actions로 바꾸는 저장소 설정 (M0 배포 전 1회)
4. ~~케이블 구매 방식~~ → 상점에서 따로 구매 (10-25). 랜선 2m 10원·전원선 2m 15원(첫 짐작), 랙 뒤 바닥에 U자로 놓임
