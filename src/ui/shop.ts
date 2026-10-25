import { events } from '../core/events';
import { CABLES, DEVICES, SHOP_CABLES, SHOP_DEVICES, unlockText, type CableDefId, type DeviceDef, type DeviceDefId } from '../data/catalog';
import { formatMoney } from './format';

// 상점 패널: 장비 카드 + 케이블 카드. M3 전까지 가격은 표시만 하고 돈은 빠지지 않는다.

export interface ShopDeps {
  isUnlocked(def: DeviceDef): boolean;
  /** 지금 가격 (구매 횟수 반영은 M3) */
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
      const open = deps.isUnlocked(def);
      b.disabled = !open;
      b.classList.toggle('held', held === def.id);
      const size = def.sizeU > 0 ? `${def.sizeU}U` : '옆면';
      const stats = def.incomePerSec > 0 ? `+${def.incomePerSec}원/초 · ${def.watts}W` : def.capacity ? `+${def.capacity.toLocaleString('ko-KR')}W` : `${def.watts}W`;
      b.innerHTML = `<span class="name">${def.name} <small>${size}</small></span>
        <span class="price">${formatMoney(deps.priceOf(def.id))}</span>
        <span class="meta">${open ? stats : `🔒 ${unlockText(def.unlock) || '준비 중'}`}</span>`;
    });
  };
  events.on('placement:held', (id) => {
    held = id;
    refresh();
  });
  refresh();
  return { refresh };
}
