import { events } from '../core/events';
import { CABLES, DEVICES, SHOP_CABLES, SHOP_DEVICES, type CableDefId, type DeviceDef, type DeviceDefId } from '../data/catalog';
import { formatMoney } from './format';

// 상점 패널: 장비 카드 + 케이블 카드. 모든 장비가 처음부터 열려 있다.
// M3 전까지 가격은 표시만 하고 돈은 빠지지 않는다.

export interface ShopDeps {
  /** 지금 살 수 없는 이유 (null = 살 수 있음). 해금은 없고 자리 부족 같은 물리 제약만 */
  blockedReason(def: DeviceDef): string | null;
  /** 지금 가격 (구매 횟수 반영) */
  priceOf(defId: DeviceDefId): number;
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

  const deviceCards = SHOP_DEVICES.map((id) => {
    const b = document.createElement('button');
    b.className = 'shop-card';
    b.dataset.def = id;
    b.addEventListener('click', () => deps.onBuyDevice(id));
    deviceList.append(b);
    return b;
  });

  for (const id of SHOP_CABLES) {
    const def = CABLES[id];
    const b = document.createElement('button');
    b.className = 'shop-card';
    b.innerHTML = `<span class="name">${def.name}</span><span class="price">${formatMoney(def.price)}</span>
      <span class="meta">랙 뒤 바닥에 놓임</span>`;
    b.addEventListener('click', () => deps.onBuyCable(id));
    cableList.append(b);
  }

  let held: string | null = null;
  const refresh = () => {
    deviceCards.forEach((b) => {
      const def = DEVICES[b.dataset.def as DeviceDefId];
      const blocked = deps.blockedReason(def);
      b.disabled = blocked !== null;
      b.classList.toggle('held', held === def.id);
      const size = def.sizeU > 0 ? `${def.sizeU}U` : '옆면';
      const stats = def.incomePerSec > 0 ? `+${def.incomePerSec}원/초 · ${def.watts}W` : def.capacity ? `+${def.capacity.toLocaleString('ko-KR')}W` : `${def.watts}W`;
      b.innerHTML = `<span class="name">${def.name} <small>${size}</small></span>
        <span class="price">${formatMoney(deps.priceOf(def.id))}</span>
        <span class="meta">${blocked ?? stats}</span>`;
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
