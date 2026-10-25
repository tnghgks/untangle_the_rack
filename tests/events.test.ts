import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';

describe('EventBus', () => {
  it('구독·해제', () => {
    const bus = new EventBus<{ ping: number }>();
    const got: number[] = [];
    const off = bus.on('ping', (n) => got.push(n));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(got).toEqual([1]);
  });
});
