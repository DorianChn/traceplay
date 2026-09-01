import { describe, expect, it, beforeEach } from 'vitest';
import { runAssertions } from '../src/assert/engine.js';
import { registerAssertion, listCustomAssertions, hasCustomAssertion } from '../src/assert/registry.js';
import type { Assertion, TraceEvent } from '../src/types.js';

const events: TraceEvent[] = [
  { id: 'a', seq: 0, at: '2026-09-01T00:00:00.000Z', type: 'user.message', content: 'hi' },
  { id: 'b', seq: 1, at: '2026-09-01T00:00:00.000Z', type: 'tool.call', name: 'search', arguments: {} },
];

beforeEach(() => {
  // registry is global across tests; reset is not provided, so register unique kinds per test
});

describe('assert/plugin registry', () => {
  it('runs a registered custom assertion', async () => {
    registerAssertion('custom.minEvents', ({ events: ev, assertion }) => {
      const min = (assertion.min as number) ?? 0;
      const ok = ev.length >= min;
      return { status: ok ? 'pass' : 'fail', assertion: { kind: 'custom.minEvents' } as unknown as Assertion, message: `events=${ev.length} >= ${min}` };
    });

    const pass = await runAssertions(events, [{ kind: 'custom.minEvents', min: 2 } as unknown as Assertion]);
    expect(pass[0].status).toBe('pass');

    const fail = await runAssertions(events, [{ kind: 'custom.minEvents', min: 10 } as unknown as Assertion]);
    expect(fail[0].status).toBe('fail');
    expect(fail[0].message).toContain('events=');
  });

  it('fails with a hint for unknown kinds', async () => {
    const results = await runAssertions(events, [{ kind: 'does.not.exist' } as unknown as Assertion]);
    expect(results[0].status).toBe('fail');
    expect(results[0].message).toContain('unknown assertion kind');
    expect(results[0].message).toContain('registerAssertion');
  });

  it('tracks registered kinds', () => {
    expect(hasCustomAssertion('custom.minEvents')).toBe(true);
    expect(listCustomAssertions()).toContain('custom.minEvents');
  });

  it('surfaces errors thrown by a custom assertion', async () => {
    registerAssertion('custom.throws', () => {
      throw new Error('boom');
    });
    const results = await runAssertions(events, [{ kind: 'custom.throws' } as unknown as Assertion]);
    expect(results[0].status).toBe('fail');
    expect(results[0].message).toContain('boom');
  });
});
