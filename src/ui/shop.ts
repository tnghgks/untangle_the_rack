import { events } from '../core/events';
import { CABLES, DEVICES, SHOP_CABLES, SHOP_DEVICES, type CableDefId, type DeviceDef, type DeviceDefId } from '../data/catalog';
import { formatMoney } from './format';

// 상점 패널: 장비 카드 + 케이블 카드. 모든 장비가 처음부터 열려 있다.
// 돈이 계속 바뀌므로 refresh()를 자주 부른다 — 내용이 바뀐 카드만 다시 그린다.

export interface ShopDeps {
  /** 지금 살 수 없는 이유 (null = 살 수 있음). 해금은 없고 자리 부족 같은 물리 제약만 */
  blockedReason(def: DeviceDef): string | null;
  /** 케이블을 지금 살 수 없는 이유 (돈 부족) */
  cableBlocked(defId: CableDefId): string | null;
  /** 지금 가격 (구매 횟수 반영) */
  priceOf(defId: DeviceDefId): number;
  /** 랙 카드: 지금 가격·살 수 없는 이유·자리 고르는 중인지 */
  rackPrice(): number;
  rackBlocked(): string | null;
  placingRack(): boolean;
  onBuyRack(): void;
  onBuyDevice(defId: DeviceDefId): void;
  onBuyCable(defId: CableDefId): void;
}

export interface Shop {
  refresh(): void;
}

export function createShop(panel: HTMLElement, deps: ShopDeps): Shop {
  panel.innerHTML = `
    <h2>상점</h2>
    <div class="shop-list" data-k="devices"></div>
    <h3>케이블</h3>
    <div class="shop-list" data-k="cables"></div>
  `;
  const deviceList = panel.querySelector<HTMLElement>('[data-k="devices"]')!;
  const cableList = panel.querySelector<HTMLElement>('[data-k="cables"]')!;

  // 랙 카드는 장비 목록 맨 위
  const rackCard = document.createElement('button');
  rackCard.className = 'shop-card';
  rackCard.addEventListener('click', () => deps.onBuyRack());
  deviceList.append(rackCard);

  const deviceCards = SHOP_DEVICES.map((id) => {
    const b = document.createElement('button');
    b.className = 'shop-card';
    b.dataset.def = id;
    b.addEventListener('click', () => deps.onBuyDevice(id));
    deviceList.append(b);
    return b;
  });

  const cableCards = SHOP_CABLES.map((id) => {
    const b = document.createElement('button');
    b.className = 'shop-card';
    b.dataset.def = id;
    b.addEventListener('click', () => deps.onBuyCable(id));
    cableList.append(b);
    return b;
  });

  const draw = (b: HTMLButtonElement, html: string, blocked: boolean) => {
    b.disabled = blocked;
    if (b.dataset.html !== html) {
      b.innerHTML = html;
      b.dataset.html = html;
    }
  };

  let held: string | null = null;
  const refresh = () => {
    const placing = deps.placingRack();
    const rackBlocked = deps.rackBlocked();
    rackCard.classList.toggle('held', placing);
    draw(
      rackCard,
      `<span class="name">랙 <small>42U · 바닥에 세움</small></span>
        <span class="price">${formatMoney(deps.rackPrice())}</span>
        <span class="meta">${placing ? '자리 고르는 중 · 다시 누르면 취소' : rackBlocked ?? '바닥 초록 칸에 세우고 랜선 10m로 잇기'}</span>`,
      // 고르는 중인 카드는 눌러서 취소할 수 있어야 함
      rackBlocked !== null && !placing,
    );
    deviceCards.forEach((b) => {
      const def = DEVICES[b.dataset.def as DeviceDefId];
      const blocked = deps.blockedReason(def);
      b.classList.toggle('held', held === def.id);
      const size = def.sizeU > 0 ? `${def.sizeU}U` : '옆면';
      const stats = def.rings ? '선 정리 가이드' : def.incomePerSec > 0 ? `+${def.incomePerSec}원/초 · ${def.watts}W` : def.capacity ? `+${def.capacity.toLocaleString('ko-KR')}W` : `${def.watts}W`;
      draw(
        b,
        `<span class="name">${def.name} <small>${size}</small></span>
        <span class="price">${formatMoney(deps.priceOf(def.id))}</span>
        <span class="meta">${blocked ?? stats}</span>`,
        // 들고 있는 카드는 눌러서 내려놓을 수 있어야 함
        blocked !== null && held !== def.id,
      );
    });
    cableCards.forEach((b) => {
      const def = CABLES[b.dataset.def as CableDefId];
      const blocked = deps.cableBlocked(def.id);
      draw(
        b,
        `<span class="name">${def.name}</span><span class="price">${formatMoney(def.price)}</span>
        <span class="meta">${blocked ?? '랙 뒤 바닥에 놓임'}</span>`,
        blocked !== null,
      );
    });
  };
  events.on('placement:held', (id) => {
    held = id;
    refresh();
  });
  // 설치하면 가격·남은 자리가 바뀜
  events.on('device:installed', refresh);
  refresh();
  return { refresh };
}
