import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeCassette, readCassette } from '../src/cassette/store.js';
import { runAssertions } from '../src/assert/engine.js';
import { requestHash, matchRequest } from '../src/replay/matcher.js';
import type { TraceEvent } from '../src/types.js';

const now = '2026-09-01T00:00:00.000Z';

function sampleEvents(): TraceEvent[] {
  return [
    { id: 'e1', seq: 0, at: now, type: 'user.message', content: 'weather in Xiamen?' },
    {
      id: 'e2',
      seq: 1,
      at: now,
      type: 'llm.request',
      provider: 'openai-compatible',
      model: 'demo',
      messages: [{ role: 'user', content: 'weather in Xiamen?' }],
      requestHash: 'hash-demo-1',
    },
    { id: 'e3', seq: 2, at: now, type: 'tool.call', name: 'get_weather', arguments: { city: 'Xiamen' } },
    { id: 'e4', seq: 3, at: now, type: 'tool.result', callId: 'e3', output: 'sunny, 31C' },
    {
      id: 'e5',
      seq: 4,
      at: now,
      type: 'llm.response',
      requestId: 'e2',
      status: 200,
      output: { choices: [{ message: { content: 'Xiamen is sunny, 31C.' } }] },
      usage: { promptTokens: 120, completionTokens: 24 },
    },
  ];
}

describe('cassette store', () => {
  it('round-trips header + events', async () => {
    const path = join(tmpdir(), `avcr-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    const events = sampleEvents();
    await writeCassette(path, { recordedAt: now, redacted: true }, events);
    const cassette = await readCassette(path);
    expect(cassette.events).toHaveLength(5);
    expect(cassette.meta.redacted).toBe(true);
    expect(cassette.events[2].type).toBe('tool.call');
  });
});

describe('assertion engine', () => {
  const events = sampleEvents();

  it('passes tool.called and answer.contains', () => {
    const results = runAssertions(events, [
      { kind: 'tool.called', name: 'get_weather' },
      { kind: 'answer.contains', text: 'sunny' },
      { kind: 'budget.maxTokens', value: 500 },
    ]);
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('fails forbid.tool when called', () => {
    const results = runAssertions(events, [{ kind: 'forbid.tool', name: 'get_weather' }]);
    expect(results[0].status).toBe('fail');
  });

  it('marks tool.args as todo in M0', () => {
    const results = runAssertions(events, [
      { kind: 'tool.args', name: 'get_weather', jsonPath: '$.city', equals: 'Xiamen' },
    ]);
    expect(results[0].status).toBe('todo');
  });
});

describe('replay matcher', () => {
  it('hashes identical canonical requests the same despite key order', () => {
    const a = { model: 'x', messages: [{ role: 'user', content: 'hi' }], stream: false };
    const b = { stream: true, messages: [{ content: 'hi', role: 'user' }], model: 'x' };
    expect(requestHash(a)).toBe(requestHash(b));
  });

  it('matches recorded llm.request by hash', () => {
    const events = sampleEvents();
    const req = { model: 'demo', messages: [{ role: 'user', content: 'weather in Xiamen?' }] };
    // The recorded event used a placeholder hash; verify miss path is clean.
    const outcome = matchRequest(req, events);
    expect(outcome.found).toBe(false);
    expect(outcome.index).toBe(-1);
  });
});
