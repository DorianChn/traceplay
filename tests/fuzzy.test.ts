import { describe, expect, it } from 'vitest';
import { matchRequest, similarity } from '../src/replayer/matcher.js';
import { requestHash } from '../src/core/hash.js';
import type { TraceEvent } from '../src/types.js';

const now = '2026-09-01T00:00:00.000Z';

function eventsWith(question: string): TraceEvent[] {
  const body = { model: 'demo', messages: [{ role: 'user', content: question }] };
  return [
    { id: 'u1', seq: 0, at: now, type: 'user.message', content: question },
    { id: 'r1', seq: 1, at: now, type: 'llm.request', provider: 'openai-compatible', model: 'demo', messages: body.messages, requestHash: requestHash(body) },
    { id: 's1', seq: 2, at: now, type: 'llm.response', requestId: 'r1', status: 200, output: { choices: [{ message: { content: 'answer' } }] }, usage: { promptTokens: 10, completionTokens: 5 } },
  ];
}

describe('replayer/matcher — fuzzy', () => {
  it('falls back to fuzzy match when exact hash misses', () => {
    const recordedQuestion = 'what is the weather in Xiamen today?';
    const events = eventsWith(recordedQuestion);

    // same wording -> exact match
    const same = matchRequest({ model: 'demo', messages: [{ role: 'user', content: recordedQuestion }] }, events);
    expect(same.found).toBe(true);
    expect(same.strategy).toBe('exact');

    // slightly different wording -> miss by default
    const miss = matchRequest(
      { model: 'demo', messages: [{ role: 'user', content: 'what is the weather in Xiamen now?' }] },
      events,
    );
    expect(miss.found).toBe(false);
    expect(miss.strategy).toBe('exact');

    // same request, fuzzy enabled -> match
    const fuzzy = matchRequest(
      { model: 'demo', messages: [{ role: 'user', content: 'what is the weather in Xiamen now?' }] },
      events,
      { fuzzy: true },
    );
    expect(fuzzy.found).toBe(true);
    expect(fuzzy.strategy).toBe('fuzzy');
    expect(fuzzy.requestIndex).toBe(1);
    expect(fuzzy.responseIndex).toBe(2);
  });

  it('rejects fuzzy matches below the threshold', () => {
    const events = eventsWith('hello world foo bar', 'h');
    const result = matchRequest(
      { model: 'demo', messages: [{ role: 'user', content: 'completely different topic about something else entirely' }] },
      events,
      { fuzzy: true, threshold: 0.8 },
    );
    expect(result.found).toBe(false);
  });

  it('similarity is 1 for identical text and 0 for disjoint text', () => {
    expect(similarity([{ role: 'user', content: 'hello world' }], [{ role: 'user', content: 'hello world' }])).toBe(1);
    expect(similarity([{ role: 'user', content: 'aaa bbb' }], [{ role: 'user', content: 'ccc ddd' }])).toBe(0);
  });
});
