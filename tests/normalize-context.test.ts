import { describe, expect, it } from 'vitest';
import { normalizeRequest, nextId, resetCounter } from '../src/cassette/normalize.js';

const body = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

describe('R4 stage 1: request context metadata', () => {
  it('records turn and parentId when context is supplied', () => {
    const first = normalizeRequest('/v1/chat/completions', body, 0, { turn: 0 });
    const second = normalizeRequest('/v1/chat/completions', body, 2, { turn: 1, parentId: first!.event.id });
    expect(first?.event.turn).toBe(0);
    expect(first?.event.parentId).toBeUndefined();
    expect(second?.event.turn).toBe(1);
    expect(second?.event.parentId).toBe(first!.event.id);
  });

  it('omits turn/parentId for back-compat when no context is supplied', () => {
    const legacy = normalizeRequest('/v1/chat/completions', body, 0);
    expect(legacy?.event).not.toHaveProperty('turn');
    expect(legacy?.event).not.toHaveProperty('parentId');
  });
});

describe('§6.3 collision-free event ids under concurrency', () => {
  it('generates unique ids even when called in a tight loop', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(nextId('req'));
    expect(ids.size).toBe(5000);
  });

  it('keeps resetCounter as a harmless no-op', () => {
    expect(() => resetCounter()).not.toThrow();
    const a = nextId('x');
    resetCounter();
    const b = nextId('x');
    expect(a).not.toBe(b);
  });
});
