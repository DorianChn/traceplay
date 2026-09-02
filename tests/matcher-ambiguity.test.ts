import { describe, expect, it } from 'vitest';
import { matchRequest, structuredSimilarity } from '../src/replayer/matcher.js';
import { requestHash, semanticRequestHash } from '../src/core/hash.js';
import { normalizeRequest } from '../src/cassette/normalize.js';
import type { LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../src/types.js';

const AT = '2026-09-01T00:00:00.000Z';

/** Build a recorded request+response pair from a full message array. */
function recordedTurn(seq: number, messages: unknown[]): TraceEvent[] {
  const body = { model: 'demo', messages };
  const req: LLMRequestEvent = {
    id: `r${seq}`,
    seq: seq * 2,
    at: AT,
    type: 'llm.request',
    provider: 'openai-compatible',
    model: 'demo',
    messages,
    requestHash: requestHash(body),
    semanticHash: semanticRequestHash(body),
  };
  const res: LLMResponseEvent = {
    id: `s${seq}`,
    seq: seq * 2 + 1,
    at: AT,
    type: 'llm.response',
    requestId: `r${seq}`,
    status: 200,
    output: { choices: [{ message: { content: `answer-${seq}` } }] },
  };
  return [req, res];
}

describe('matcher — ambiguity detection (R2)', () => {
  function parisEvents(): TraceEvent[] {
    // Two recorded intents that differ in exactly one token.
    return [
      ...recordedTurn(1, [{ role: 'user', content: 'book a flight to Paris tomorrow' }]),
      ...recordedTurn(2, [{ role: 'user', content: 'book a flight to Paris today' }]),
    ];
  }

  it('refuses to guess when top-1 and top-2 are almost tied', () => {
    const events = parisEvents();
    const incoming = {
      model: 'demo',
      messages: [{ role: 'user', content: 'book a flight to Paris next week' }],
    };
    const out = matchRequest(incoming, events, { fuzzy: true, ambiguityGap: 0.1 });
    expect(out.found).toBe(false);
    expect(out.ambiguous).toBe(true);
    expect(out.strategy).toBe('structured');
    expect(out.runnerUpScore).toBeDefined();
    expect(Math.abs((out.score ?? 0) - (out.runnerUpScore ?? 1))).toBeLessThan(0.1);
    expect(out.diagnostic).toMatch(/ambiguous/i);
  });

  it('accepts when the gap is wide enough', () => {
    const events = parisEvents();
    const incoming = {
      model: 'demo',
      messages: [{ role: 'user', content: 'book a flight to Paris tomorrow morning please' }],
    };
    const out = matchRequest(incoming, events, { fuzzy: true, ambiguityGap: 0.1 });
    expect(out.ambiguous).toBe(false);
    expect(out.found).toBe(true);
    // request r1 ("...tomorrow") is at index 0.
    expect(out.requestIndex).toBe(0);
  });
});

describe('matcher — adversarial negative cases (R2)', () => {
  it('does not match requests that share only filler words', () => {
    const events = [
      ...recordedTurn(1, [
        { role: 'user', content: 'what is the weather like today in Beijing' },
      ]),
    ];
    const incoming = {
      model: 'demo',
      messages: [{ role: 'user', content: 'what is the stock price today for the market' }],
    };
    // Sanity: they overlap on filler words but mean different things.
    expect(structuredSimilarity(incoming, { model: 'demo', messages: events[0] ? (events[0] as LLMRequestEvent).messages : [] })).toBeLessThan(0.55);

    const out = matchRequest(incoming, events, { fuzzy: true });
    expect(out.found).toBe(false);
    expect(out.ambiguous).toBe(false);
  });

  it('does not match a question to its role-reversed counterpart', () => {
    const events = [
      ...recordedTurn(1, [
        { role: 'user', content: 'how do I export the report to PDF' },
        { role: 'assistant', content: 'use the export menu' },
        { role: 'user', content: 'and then email it' },
      ]),
    ];
    const reversed = {
      model: 'demo',
      messages: [
        { role: 'assistant', content: 'how do I export the report to PDF' },
        { role: 'user', content: 'use the export menu' },
        { role: 'assistant', content: 'and then email it' },
      ],
    };
    const out = matchRequest(reversed, events, { fuzzy: true });
    // Role sequence differs and the final user intent differs -> no confident hit.
    expect(out.found).toBe(false);
  });
});

describe('matcher — multi-step context drift (R1 acceptance)', () => {
  function fiveStepRun(): { events: TraceEvent[]; turns: unknown[][] } {
    const u1 = 'check the weather in Xiamen for me please';
    const a1 = 'Xiamen is sunny at 28 degrees';
    const u2 = 'what about tomorrow';
    const a2 = 'tomorrow will be cloudy';
    const u3 = 'will it rain in the afternoon';
    const a3 = 'no rain is expected';
    const u4 = 'and the humidity level';
    const a4 = 'humidity around seventy percent';
    const u5 = 'thanks please summarize';
    const a5 = 'here is your weather summary';
    const turns = [
      [{ role: 'user', content: u1 }],
      [
        { role: 'user', content: u1 },
        { role: 'assistant', content: a1 },
        { role: 'user', content: u2 },
      ],
      [
        { role: 'user', content: u1 },
        { role: 'assistant', content: a1 },
        { role: 'user', content: u2 },
        { role: 'assistant', content: a2 },
        { role: 'user', content: u3 },
      ],
      [
        { role: 'user', content: u1 },
        { role: 'assistant', content: a1 },
        { role: 'user', content: u2 },
        { role: 'assistant', content: a2 },
        { role: 'user', content: u3 },
        { role: 'assistant', content: a3 },
        { role: 'user', content: u4 },
      ],
      [
        { role: 'user', content: u1 },
        { role: 'assistant', content: a1 },
        { role: 'user', content: u2 },
        { role: 'assistant', content: a2 },
        { role: 'user', content: u3 },
        { role: 'assistant', content: a3 },
        { role: 'user', content: u4 },
        { role: 'assistant', content: a4 },
        { role: 'user', content: u5 },
      ],
    ];
    const events: TraceEvent[] = [];
    turns.forEach((messages, i) => events.push(...recordedTurn(i + 1, messages)));
    return { events, turns };
  }

  it('still matches step 3 after a one-word edit to step 1 (L0/L1 miss, L2 hits)', () => {
    const { events } = fiveStepRun();
    // Replay of step 3, but the very first user message was reworded by one token.
    const drifted = [
      { role: 'user', content: 'check the weather in Xiamen for me right now please' },
      { role: 'assistant', content: 'Xiamen is sunny at 28 degrees' },
      { role: 'user', content: 'what about tomorrow' },
      { role: 'assistant', content: 'tomorrow will be cloudy' },
      { role: 'user', content: 'will it rain in the afternoon' },
    ];

    // Deterministic layers miss because the accumulated history changed.
    const deterministic = matchRequest({ model: 'demo', messages: drifted }, events);
    expect(deterministic.found).toBe(false);

    // L2 structured matching recovers the correct step (request r3 at index 4).
    const fuzzy = matchRequest({ model: 'demo', messages: drifted }, events, { fuzzy: true });
    expect(fuzzy.found).toBe(true);
    expect(fuzzy.strategy).toBe('structured');
    expect(fuzzy.requestIndex).toBe(4); // r3 req: turns 1,2 -> indices 0..3; r3 req = 4
    const answer = (events[fuzzy.responseIndex] as LLMResponseEvent).output as {
      choices: Array<{ message: { content: string } }>;
    };
    expect(answer.choices[0].message.content).toBe('answer-3');
  });

  it('matches the correct repeated prompt by accumulated context, not just text', () => {
    // Same user text ("continue") appears at steps 2 and 4; surrounding history differs.
    const t2 = [
      { role: 'user', content: 'draft an intro' },
      { role: 'assistant', content: 'intro draft' },
      { role: 'user', content: 'continue' },
    ];
    const t4 = [
      { role: 'user', content: 'draft an intro' },
      { role: 'assistant', content: 'intro draft' },
      { role: 'user', content: 'continue' },
      { role: 'assistant', content: 'body draft' },
      { role: 'user', content: 'make it shorter' },
      { role: 'assistant', content: 'shorter body' },
      { role: 'user', content: 'continue' },
    ];
    const events: TraceEvent[] = [...recordedTurn(2, t2), ...recordedTurn(4, t4)];
    const out = matchRequest({ model: 'demo', messages: t4 }, events, { fuzzy: true });
    expect(out.found).toBe(true);
    // Must resolve to the later turn (r4 at request index 2), not r2 at index 0.
    expect(out.requestIndex).toBe(2);
  });
});

describe('matcher — legacy cassette without semanticHash (back-compat)', () => {
  it('computes L1 semantic hash on the fly for v0.1–v0.4 cassettes', () => {
    const body = { model: 'demo', messages: [{ role: 'user', content: 'hello world' }] };
    const req = {
      id: 'r1',
      seq: 0,
      at: AT,
      type: 'llm.request',
      provider: 'openai-compatible',
      model: 'demo',
      messages: [{ role: 'user', content: 'hello world' }],
      requestHash: requestHash(body),
      // note: no semanticHash, as produced by older versions
    } as unknown as LLMRequestEvent;
    const res: LLMResponseEvent = {
      id: 's1',
      seq: 1,
      at: AT,
      type: 'llm.response',
      requestId: 'r1',
      status: 200,
      output: { ok: true },
    };
    const incoming = {
      model: 'demo',
      messages: [{ role: 'user', content: 'hello   world' }], // extra whitespace
    };
    const out = matchRequest(incoming, [req, res]);
    expect(out.found).toBe(true);
    expect(out.strategy).toBe('semantic');
  });
});

describe('matcher — L1 record/replay shape parity', () => {
  it('matches L1 when a realistic recorded request is replayed with a new seed + whitespace only', () => {
    const tools = [{ type: 'function', function: { name: 'get_weather' } }];
    const recordedRaw = JSON.stringify({
      model: 'gpt-x',
      temperature: 0.2,
      seed: 111,
      tools,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello there' },
      ],
    });
    const { event } = normalizeRequest('/v1/chat/completions', recordedRaw, 0);
    expect(event.semanticHash).toBeDefined();
    const res: LLMResponseEvent = {
      id: 's1', seq: 1, at: AT, type: 'llm.response', requestId: event.id, status: 200, output: { ok: true },
    };

    // Replay: different seed (per-call noise), extra whitespace, same tools/temp/intent.
    const incoming = {
      model: 'gpt-x',
      temperature: 0.2,
      seed: 222,
      tools,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello   there' },
      ],
    };

    // L0 misses because the whitespace differs, but L1 must hit deterministically
    // using the recorded semanticHash (fuzzy stays off).
    expect(requestHash(incoming) === event.requestHash).toBe(false);
    const out = matchRequest(incoming, [event, res]);
    expect(out.found).toBe(true);
    expect(out.strategy).toBe('semantic');
  });
});
