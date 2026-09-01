import { describe, expect, it } from 'vitest';
import { createReplaySession, matchRequest, type ReplaySession } from '../src/replayer/matcher.js';
import { normalizeRequest, normalizeResponse } from '../src/cassette/normalize.js';
import { linkResponse, linkResponseIndex } from '../src/replayer/link.js';
import type { LLMResponseEvent, TraceEvent } from '../src/types.js';

/** Build an interleaved request/response trajectory, optionally tagging turns (R4). */
function trajectory(prompts: string[], tagTurns = true): TraceEvent[] {
  const events: TraceEvent[] = [];
  let seq = 0;
  let parentId: string | undefined;
  prompts.forEach((p, i) => {
    const raw = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: p }] });
    const n = normalizeRequest(
      '/v1/chat/completions',
      raw,
      seq++,
      tagTurns ? { turn: i, parentId } : {},
    );
    if (!n) throw new Error('normalize failed');
    events.push(n.event);
    const rr = normalizeResponse(
      n.event.id,
      200,
      JSON.stringify({ choices: [{ message: { content: `answer-${i}` } }] }),
      'openai-compatible',
      seq++,
    );
    events.push(rr.event);
    parentId = n.event.id;
  });
  return events;
}

const live = (p: string) => ({ model: 'm', messages: [{ role: 'user', content: p }] });
function answerOf(events: TraceEvent[], idx: number): string {
  const res = events[idx] as LLMResponseEvent;
  return ((res.output as { choices: Array<{ message: { content: string } }> }).choices[0].message.content);
}

describe('R4 stateful replay session', () => {
  it('replays a 10-step trajectory in order, advancing the cursor each hit', () => {
    const prompts = Array.from({ length: 10 }, (_, i) => `step prompt number ${i}`);
    const events = trajectory(prompts);
    const session = createReplaySession(events);
    expect(session.steps).toBe(10);

    prompts.forEach((p, i) => {
      expect(session.consumed).toBe(i);
      const out = session.match(live(p));
      expect(out.found).toBe(true);
      expect(out.strategy).toBe('exact');
      // request i sits at event index 2i, response at 2i+1
      expect(out.requestIndex).toBe(2 * i);
      expect(out.responseIndex).toBe(2 * i + 1);
      expect(answerOf(events, out.responseIndex)).toBe(`answer-${i}`);
      expect(session.consumed).toBe(i + 1);
    });
  });

  it('matches the Nth occurrence of a repeated prompt to the Nth recorded step', () => {
    const events = trajectory(['repeat', 'repeat', 'repeat']);
    const session = createReplaySession(events);
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const out = session.match(live('repeat'));
      expect(out.found).toBe(true);
      seen.push(out.requestIndex);
      expect(answerOf(events, out.responseIndex)).toBe(`answer-${i}`);
    }
    expect(seen).toEqual([0, 2, 4]);
  });

  it('reports "exhausted" once every recorded step has been consumed', () => {
    const events = trajectory(['a', 'b', 'c']);
    const session = createReplaySession(events);
    ['a', 'b', 'c'].forEach((p) => expect(session.match(live(p)).found).toBe(true));
    const extra = session.match(live('a'));
    expect(extra.found).toBe(false);
    expect(extra.strategy).toBe('none');
    expect(extra.diagnostic).toMatch(/exhausted/i);
  });

  it('flags a request that matches only an already-consumed step as out-of-order', () => {
    const events = trajectory(['A', 'B']);
    const session = createReplaySession(events);
    expect(session.match(live('A')).found).toBe(true);
    // cursor is now at step 2; sending A again cannot match forward
    const backward = session.match(live('A'));
    expect(backward.found).toBe(false);
    expect(backward.diagnostic).toMatch(/out of the recorded order/i);
  });

  it('reset() rewinds the cursor to step zero', () => {
    const events = trajectory(['A', 'B']);
    const session = createReplaySession(events);
    session.match(live('A'));
    expect(session.consumed).toBe(1);
    session.reset();
    expect(session.consumed).toBe(0);
    const again = session.match(live('A'));
    expect(again.found).toBe(true);
    expect(again.requestIndex).toBe(0);
  });

  it('works for old cassettes that have no turn/parentId metadata', () => {
    // tagTurns=false → events carry only sequence order, like a v0.1–v0.5 file
    const events = trajectory(['same', 'same', 'same'], false);
    expect(events[0]).not.toHaveProperty('turn');
    const session = createReplaySession(events);
    const order = [0, 1, 2].map(() => session.match(live('same')).requestIndex);
    expect(order).toEqual([0, 2, 4]);
  });

  it('follows a semantic branch (whitespace drift) at the correct step', () => {
    const events = trajectory(['book a flight', 'cancel the booking']);
    const session = createReplaySession(events);
    expect(session.match(live('book a flight')).strategy).toBe('exact');
    const branch = session.match(live('cancel  the   booking'));
    expect(branch.found).toBe(true);
    expect(branch.strategy).toBe('semantic');
    expect(branch.requestIndex).toBe(2);
  });

  it('is deterministic: two sessions over the same cassette replay identically', () => {
    const prompts = ['hello there', 'hello there', 'what now', 'what now'];
    const events = trajectory(prompts);
    const run = (): number[] => {
      const s = createReplaySession(events);
      return prompts.map((p) => s.match(live(p)).responseIndex);
    };
    expect(run()).toEqual(run());
  });

  it('scales linearly: 200 ordered steps all resolve within a generous bound', () => {
    const prompts = Array.from({ length: 200 }, (_, i) => `long unique step number ${i} with padding`);
    const events = trajectory(prompts);
    const session = createReplaySession(events);
    const start = Date.now();
    for (const p of prompts) {
      const out = session.match(live(p));
      if (!out.found) throw new Error(`failed to match ${p}`);
    }
    const elapsed = Date.now() - start;
    expect(session.consumed).toBe(200);
    // Suffix scans over 200 small requests must stay well below 1s (CI-safe).
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('stateless matchRequest still scans globally (v0.5 behavior)', () => {
  it('returns the first occurrence regardless of call count', () => {
    const events = trajectory(['repeat', 'repeat', 'repeat']);
    for (let i = 0; i < 3; i++) {
      const out = matchRequest(live('repeat'), events);
      expect(out.found).toBe(true);
      expect(out.requestIndex).toBe(0); // always the first, no cursor
    }
  });
});

describe('linkResponse / linkResponseIndex (shared §6.2)', () => {
  it('links by explicit requestId edge first', () => {
    const events = trajectory(['x']);
    const reqIndex = 0;
    expect(linkResponseIndex(events, events[reqIndex], reqIndex)).toBe(1);
    const res = linkResponse(events, events[reqIndex], reqIndex) as LLMResponseEvent;
    expect(res.type).toBe('llm.response');
  });

  it('falls back to the first response after the request when no edge exists', () => {
    const events = trajectory(['x']);
    // Strip the requestId edge to simulate a cassette without linkage.
    const res = events[1] as LLMResponseEvent;
    delete res.requestId;
    expect(linkResponseIndex(events, events[0], 0)).toBe(1);
  });

  it('returns -1 / undefined when no response follows', () => {
    const events = trajectory(['x']);
    const onlyReq = [events[0]];
    expect(linkResponseIndex(onlyReq, events[0], 0)).toBe(-1);
    expect(linkResponse(onlyReq, events[0], 0)).toBeUndefined();
  });
});
