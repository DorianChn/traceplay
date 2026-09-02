import { describe, expect, it } from 'vitest';
import {
  matchRequest,
  similarity,
  structuredSimilarity,
  bigramDice,
  tokenSequence,
} from '../src/replayer/matcher.js';
import { requestHash, semanticRequestHash } from '../src/core/hash.js';
import type { TraceEvent } from '../src/types.js';

const now = '2026-09-01T00:00:00.000Z';

function eventsWith(question: string): TraceEvent[] {
  const body = { model: 'demo', messages: [{ role: 'user', content: question }] };
  return [
    { id: 'u1', seq: 0, at: now, type: 'user.message', content: question },
    {
      id: 'r1',
      seq: 1,
      at: now,
      type: 'llm.request',
      provider: 'openai-compatible',
      model: 'demo',
      messages: body.messages,
      requestHash: requestHash(body),
      semanticHash: semanticRequestHash(body),
    },
    {
      id: 's1',
      seq: 2,
      at: now,
      type: 'llm.response',
      requestId: 'r1',
      status: 200,
      output: { choices: [{ message: { content: 'answer' } }] },
      usage: { promptTokens: 10, completionTokens: 5 },
    },
  ];
}

describe('replayer/matcher — layered fallback', () => {
  it('matches L0 exact, then L1 semantic, then L2 structured under --fuzzy', () => {
    const recordedQuestion = 'what is the weather in Xiamen today?';
    const events = eventsWith(recordedQuestion);

    // identical wording -> L0 exact
    const same = matchRequest(
      { model: 'demo', messages: [{ role: 'user', content: recordedQuestion }] },
      events,
    );
    expect(same.found).toBe(true);
    expect(same.strategy).toBe('exact');

    // one wording change, fuzzy OFF -> L0 and L1 both miss (deterministic)
    const miss = matchRequest(
      { model: 'demo', messages: [{ role: 'user', content: 'what is the weather in Xiamen now?' }] },
      events,
    );
    expect(miss.found).toBe(false);
    expect(miss.strategy).toBe('semantic');
    expect(miss.ambiguous).toBe(false);

    // same request with fuzzy -> rescued by L2 structured similarity
    const fuzzy = matchRequest(
      { model: 'demo', messages: [{ role: 'user', content: 'what is the weather in Xiamen now?' }] },
      events,
      { fuzzy: true },
    );
    expect(fuzzy.found).toBe(true);
    expect(fuzzy.strategy).toBe('structured');
    expect(fuzzy.requestIndex).toBe(1);
    expect(fuzzy.responseIndex).toBe(2);
    expect(fuzzy.score ?? 0).toBeGreaterThan(0.8);
  });

  it('L1 semantic hash absorbs whitespace and seed noise without fuzzy', () => {
    // Recorded with seed and single spaces; incoming with different seed and
    // extra whitespace — semantically identical, so L1 matches deterministically.
    const recorded = {
      model: 'demo',
      seed: 7,
      messages: [{ role: 'user', content: 'book a table for two' }],
    };
    const events = eventsWith('book a table for two');
    (events[1] as { seed?: number }).seed = 7;

    const incoming = {
      model: 'demo',
      seed: 9999,
      messages: [{ role: 'user', content: 'book   a\ttable  for  two' }],
    };
    // recorded event carries a semanticHash computed at record time
    (events[1] as { semanticHash?: string }).semanticHash = semanticRequestHash(recorded);

    const out = matchRequest(incoming, events);
    expect(out.found).toBe(true);
    expect(out.strategy).toBe('semantic');
  });

  it('rejects probabilistic matches below every threshold', () => {
    const events = eventsWith('hello world foo bar');
    const result = matchRequest(
      { model: 'demo', messages: [{ role: 'user', content: 'completely different topic about something else entirely' }] },
      events,
      { fuzzy: true, threshold: 0.8, structuredThreshold: 0.8 },
    );
    expect(result.found).toBe(false);
    expect(result.ambiguous).toBe(false);
  });
});

describe('replayer/matcher — L3 Jaccard primitive', () => {
  it('similarity is 1 for identical token sets and 0 for disjoint sets', () => {
    expect(similarity([{ role: 'user', content: 'hello world' }], [{ role: 'user', content: 'hello world' }])).toBe(1);
    expect(similarity([{ role: 'user', content: 'aaa bbb' }], [{ role: 'user', content: 'ccc ddd' }])).toBe(0);
  });

  it('is order-insensitive (the weakness L2 fixes)', () => {
    const ab = [{ role: 'user', content: 'alpha beta gamma' }];
    const ba = [{ role: 'user', content: 'gamma beta alpha' }];
    expect(similarity(ab, ba)).toBe(1);
  });
});

describe('replayer/matcher — L2 structured similarity', () => {
  it('bigram Dice is order-sensitive', () => {
    const forward = tokenSequence('alpha beta gamma delta');
    const reversed = tokenSequence('delta gamma beta alpha');
    // Fully reversed order shares no adjacent bigram.
    expect(bigramDice(forward, reversed)).toBe(0);
    expect(bigramDice(forward, forward)).toBe(1);
    // A local swap still scores below the identical sequence.
    const swapped = tokenSequence('alpha gamma beta delta');
    expect(bigramDice(forward, swapped)).toBeLessThan(bigramDice(forward, forward));
  });

  it('penalizes reordered conversation vs identical order', () => {
    const ordered = {
      messages: [
        { role: 'user', content: 'first do X then do Y' },
        { role: 'assistant', content: 'ok X done' },
        { role: 'user', content: 'now do Y' },
      ],
    };
    const same = { messages: ordered.messages.map((m) => ({ ...m })) };
    const swapped = {
      messages: [
        { role: 'user', content: 'first do Y then do X' },
        { role: 'assistant', content: 'ok Y done' },
        { role: 'user', content: 'now do X' },
      ],
    };
    expect(structuredSimilarity(ordered, same)).toBeGreaterThan(0.99);
    expect(structuredSimilarity(ordered, swapped)).toBeLessThan(
      structuredSimilarity(ordered, same),
    );
  });

  it('weights the last user message (current intent) above shared boilerplate', () => {
    const base = {
      messages: [
        { role: 'system', content: 'you are a helpful assistant' },
        { role: 'user', content: 'please answer carefully' },
        { role: 'user', content: 'what is 2 + 2' },
      ],
    };
    const sameIntent = {
      messages: [
        { role: 'system', content: 'you are a helpful assistant' },
        { role: 'user', content: 'please answer carefully and think step by step' },
        { role: 'user', content: 'what is 2 + 2' },
      ],
    };
    const wrongIntent = {
      messages: [
        { role: 'system', content: 'you are a helpful assistant' },
        { role: 'user', content: 'please answer carefully' },
        { role: 'user', content: 'what is the capital of France' },
      ],
    };
    expect(structuredSimilarity(base, sameIntent)).toBeGreaterThan(
      structuredSimilarity(base, wrongIntent),
    );
  });

  it('applies a structural penalty for different message counts / role sequences', () => {
    const one = { messages: [{ role: 'user', content: 'tell me a joke about robots' }] };
    const three = {
      messages: [
        { role: 'user', content: 'tell me a joke about robots' },
        { role: 'assistant', content: 'why did the robot cross the road' },
        { role: 'user', content: 'haha another one' },
      ],
    };
    // identical first user text, but turn count differs (3 vs 1) -> penalty
    expect(structuredSimilarity(one, three)).toBeLessThan(0.9);
  });
});
