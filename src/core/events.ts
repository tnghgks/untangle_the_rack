// 타입 있는 이벤트 버스. 이벤트 이름과 페이로드는 GameEvents 한 곳에서 정의한다.

export type ViewMode = 'front' | 'back' | 'free';

export interface GameEvents {
  'view:set': ViewMode;
  'view:changed': ViewMode;
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
