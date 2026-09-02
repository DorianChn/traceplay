import { describe, expect, it } from 'vitest';
import { runAssertions } from '../src/assert/engine.js';
import { matchRequest } from '../src/replayer/matcher.js';
import { requestHash } from '../src/core/hash.js';
import { extractAnswerText } from '../src/assert/matchers/answer.js';
import type { TraceEvent } from '../src/types.js';

const now = '2026-09-01T00:00:00.000Z';

function sampleEvents(): TraceEvent[] {
  const requestBody = { model: 'demo', messages: [{ role: 'user', content: 'weather in Xiamen?' }] };
  return [
    { id: 'u1', seq: 0, at: now, type: 'user.message', content: 'weather in Xiamen?' },
    { id: 'r1', seq: 1, at: now, type: 'llm.request', provider: 'openai-compatible', model: 'demo', messages: requestBody.messages, requestHash: requestHash(requestBody) },
    { id: 't1', seq: 2, at: now, type: 'tool.call', name: 'get_weather', arguments: { city: 'Xiamen', units: 'celsius' } },
    { id: 't2', seq: 3, at: now, type: 'tool.result', callId: 't1', output: 'sunny, 31C' },
    { id: 's1', seq: 4, at: now, type: 'llm.response', requestId: 'r1', status: 200, output: { choices: [{ message: { content: 'Xiamen is sunny, 31C.' } }] }, usage: { promptTokens: 120, completionTokens: 24 } },
  ];
}

describe('replayer/matcher', () => {
  it('matches recorded request by hash', () => {
    const events = sampleEvents();
    const req = { model: 'demo', messages: [{ role: 'user', content: 'weather in Xiamen?' }] };
    const outcome = matchRequest(req, events);
    expect(outcome.found).toBe(true);
    expect(outcome.requestIndex).toBe(1);
    expect(outcome.responseIndex).toBe(4);
  });

  it('returns not found for unknown request', () => {
    const events = sampleEvents();
    const outcome = matchRequest({ model: 'x', messages: [{ role: 'user', content: 'different' }] }, events);
    expect(outcome.found).toBe(false);
    expect(outcome.requestIndex).toBe(-1);
  });
});

describe('assert/engine — tool assertions', () => {
  const events = sampleEvents();

  it('tool.called passes when tool invoked', async () => {
    const results = await runAssertions(events, [{ kind: 'tool.called', name: 'get_weather' }]);
    expect(results[0].status).toBe('pass');
  });

  it('tool.called with exact times', async () => {
    const pass = await runAssertions(events, [{ kind: 'tool.called', name: 'get_weather', times: 1 }]);
    expect(pass[0].status).toBe('pass');
    const fail = await runAssertions(events, [{ kind: 'tool.called', name: 'get_weather', times: 2 }]);
    expect(fail[0].status).toBe('fail');
  });

  it('tool.args matches by jsonpath', async () => {
    const results = await runAssertions(events, [
      { kind: 'tool.args', name: 'get_weather', jsonPath: '$.city', equals: 'Xiamen' },
    ]);
    expect(results[0].status).toBe('pass');
  });

  it('tool.args fails on mismatch', async () => {
    const results = await runAssertions(events, [
      { kind: 'tool.args', name: 'get_weather', jsonPath: '$.city', equals: 'Beijing' },
    ]);
    expect(results[0].status).toBe('fail');
  });

  it('tool.args fails gracefully when jsonPath is missing', async () => {
    const results = await runAssertions(events, [
      { kind: 'tool.args', name: 'get_weather', equals: 'Xiamen' } as never,
    ]);
    expect(results[0].status).toBe('fail');
    expect(results[0].message).toContain('jsonPath');
  });

  it('tool.args equals ignores object key insertion order', async () => {
    // Recorded args are { city, units }; assert with the same content but
    // reversed key order plus a nested object — must still pass.
    const results = await runAssertions(
      [
        ...events.slice(0, 2),
        { id: 't1', seq: 2, at: now, type: 'tool.call', name: 'get_weather', arguments: { filter: { a: 1, b: 2 }, city: 'Xiamen' } },
        ...events.slice(3),
      ],
      [{ kind: 'tool.args', name: 'get_weather', jsonPath: '$.filter', equals: { b: 2, a: 1 } }],
    );
    expect(results[0].status).toBe('pass');
  });

  it('forbid.tool fails when called', async () => {
    const results = await runAssertions(events, [{ kind: 'forbid.tool', name: 'get_weather' }]);
    expect(results[0].status).toBe('fail');
  });

  it('forbid.tool passes when not called', async () => {
    const results = await runAssertions(events, [{ kind: 'forbid.tool', name: 'execute_shell' }]);
    expect(results[0].status).toBe('pass');
  });

  it('tool.order checks subsequence', async () => {
    const pass = await runAssertions(events, [{ kind: 'tool.order', names: ['get_weather'] }]);
    expect(pass[0].status).toBe('pass');
    const fail = await runAssertions(events, [{ kind: 'tool.order', names: ['other_tool', 'get_weather'] }]);
    expect(fail[0].status).toBe('fail');
  });
});

describe('assert/engine — answer assertions', () => {
  const events = sampleEvents();

  it('answer.contains', async () => {
    const pass = await runAssertions(events, [{ kind: 'answer.contains', text: 'sunny' }]);
    expect(pass[0].status).toBe('pass');
    const fail = await runAssertions(events, [{ kind: 'answer.contains', text: 'rainy' }]);
    expect(fail[0].status).toBe('fail');
  });

  it('answer.matches regex', async () => {
    const results = await runAssertions(events, [{ kind: 'answer.matches', regex: '\\d+C' }]);
    expect(results[0].status).toBe('pass');
  });

  it('answer.judge is todo without API key', async () => {
    const results = await runAssertions(events, [{ kind: 'answer.judge', rubric: 'mentions weather' }]);
    expect(results[0].status).toBe('todo');
  });

  it('extractAnswerText gets last response content', () => {
    expect(extractAnswerText(events)).toBe('Xiamen is sunny, 31C.');
  });
});

describe('assert/engine — budget assertions', () => {
  const events = sampleEvents();

  it('budget.maxTokens', async () => {
    const pass = await runAssertions(events, [{ kind: 'budget.maxTokens', value: 500 }]);
    expect(pass[0].status).toBe('pass');
    const fail = await runAssertions(events, [{ kind: 'budget.maxTokens', value: 100 }]);
    expect(fail[0].status).toBe('fail');
  });

  it('budget.maxSteps', async () => {
    const pass = await runAssertions(events, [{ kind: 'budget.maxSteps', value: 3 }]);
    expect(pass[0].status).toBe('pass');
    const fail = await runAssertions(events, [{ kind: 'budget.maxSteps', value: 0 }]);
    expect(fail[0].status).toBe('fail');
  });
});
