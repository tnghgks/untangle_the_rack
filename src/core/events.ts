// 타입 있는 이벤트 버스. 이벤트 이름과 페이로드는 GameEvents 한 곳에서 정의한다.

export type ViewMode = 'front' | 'back' | 'free';

export interface GameEvents {
  'view:set': ViewMode;
  'view:changed': ViewMode;
  'cable:plugged': { cableId: string; portId: string };
  'cable:unplugged': { cableId: string; portId: string };
  'device:installed': { deviceId: string };
  /** 랙에서 뺌 (손에 들림 — 다시 끼우면 같은 id로 device:installed) */
  'device:removed': { deviceId: string };
  'device:power': { deviceId: string; on: boolean };
  /** PDU 과부하로 차단기가 내려감 / 다시 올림 */
  'pdu:tripped': { deviceId: string };
  'pdu:reset': { deviceId: string };
  /** 상점에서 장비를 든/내려놓은 상태 (null = 빈손) */
  'placement:held': string | null;
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<E[K]>)(payload));
  }
}

export const events = new EventBus<GameEvents>();
