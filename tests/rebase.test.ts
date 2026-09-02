import { describe, expect, it } from 'vitest';
import { rebaseCassettes } from '../src/cassette/rebase.js';
import type { Cassette, LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../src/types.js';

function req(hash: string, seq: number, messages = [{ role: 'user', content: hash }]): LLMRequestEvent {
  return {
    id: `req-${hash}-${seq}`,
    seq,
    at: new Date(0).toISOString(),
    type: 'llm.request',
    provider: 'other',
    model: 'm',
    messages,
    requestHash: hash,
  };
}

function resp(hash: string, seq: number, output: string, status = 200): LLMResponseEvent {
  return {
    id: `resp-${hash}-${seq}`,
    seq,
    at: new Date(0).toISOString(),
    type: 'llm.response',
    requestId: `req-${hash}-${seq - 1}`,
    status,
    output,
  };
}

function segment(hash: string, output: string, startSeq: number): TraceEvent[] {
  return [req(hash, startSeq), resp(hash, startSeq + 1, output)];
}

function cassette(events: TraceEvent[]): Cassette {
  return {
    version: 1,
    meta: { recordedAt: new Date(0).toISOString(), redacted: true },
    events,
  };
}

describe('rebaseCassettes — merge a partial re-record onto an existing cassette', () => {
  it('keeps an unchanged segment from base', () => {
    const base = cassette(segment('aaa', 'hello', 1));
    const head = cassette(segment('aaa', 'hello', 1));
    const r = rebaseCassettes(base, head);
    expect(r.summary).toEqual({ unchanged: 1, updated: 0, added: 0, retained: 0 });
    expect(r.cassette.events).toHaveLength(2);
    expect((r.cassette.events[1] as LLMResponseEvent).output).toBe('hello');
  });

  it('replaces an updated segment with head by default', () => {
    const base = cassette(segment('aaa', 'old answer', 1));
    const head = cassette(segment('aaa', 'new answer', 1));
    const r = rebaseCassettes(base, head);
    expect(r.summary.updated).toBe(1);
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].basePreview).toContain('old answer');
    expect(r.updates[0].headPreview).toContain('new answer');
    expect((r.cassette.events[1] as LLMResponseEvent).output).toBe('new answer');
  });

  it('keeps base on updated segment when prefer=base', () => {
    const base = cassette(segment('aaa', 'old answer', 1));
    const head = cassette(segment('aaa', 'new answer', 1));
    const r = rebaseCassettes(base, head, { prefer: 'base' });
    expect(r.summary.updated).toBe(1);
    expect((r.cassette.events[1] as LLMResponseEvent).output).toBe('old answer');
  });

  it('adds a segment that only exists in head', () => {
    const base = cassette(segment('aaa', 'hello', 1));
    const head = cassette([...segment('aaa', 'hello', 1), ...segment('bbb', 'world', 3)]);
    const r = rebaseCassettes(base, head);
    expect(r.summary.added).toBe(1);
    expect(r.summary.unchanged).toBe(1);
    expect(r.cassette.events).toHaveLength(4);
    expect((r.cassette.events[2] as LLMRequestEvent).requestHash).toBe('bbb');
  });

  it('retains a base segment that head did not re-record', () => {
    const base = cassette([...segment('aaa', 'first', 1), ...segment('bbb', 'second', 3)]);
    const head = cassette(segment('aaa', 'first updated', 1));
    const r = rebaseCassettes(base, head);
    expect(r.summary.updated).toBe(1);
    expect(r.summary.retained).toBe(1);
    expect(r.cassette.events).toHaveLength(4);
    // head segment first, then retained base segment
    expect((r.cassette.events[0] as LLMRequestEvent).requestHash).toBe('aaa');
    expect((r.cassette.events[2] as LLMRequestEvent).requestHash).toBe('bbb');
    expect((r.cassette.events[3] as LLMResponseEvent).output).toBe('second');
  });

  it('re-numbers seq monotonically after merge', () => {
    const base = cassette([...segment('aaa', 'a', 1), ...segment('bbb', 'b', 3)]);
    const head = cassette(segment('aaa', 'a2', 10));
    const r = rebaseCassettes(base, head);
    const seqs = r.cassette.events.map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4]);
  });

  it('matches repeated identical fingerprints in order', () => {
    const base = cassette([
      ...segment('same', 'first-old', 1),
      ...segment('same', 'second-old', 3),
    ]);
    const head = cassette([
      ...segment('same', 'first-new', 1),
      ...segment('same', 'second-old', 3),
    ]);
    const r = rebaseCassettes(base, head);
    expect(r.summary.updated).toBe(1);
    expect(r.summary.unchanged).toBe(1);
    expect((r.cassette.events[1] as LLMResponseEvent).output).toBe('first-new');
    expect((r.cassette.events[3] as LLMResponseEvent).output).toBe('second-old');
  });

  it('prefers head prefix events, falls back to base', () => {
    const userMsg: TraceEvent = {
      id: 'u1',
      seq: 0,
      at: new Date(0).toISOString(),
      type: 'user.message',
      content: 'hello from head',
    };
    const base = cassette(segment('aaa', 'hi', 1));
    const head = cassette([userMsg, ...segment('aaa', 'hi', 2)]);
    const r = rebaseCassettes(base, head);
    expect(r.cassette.events[0].type).toBe('user.message');
    expect((r.cassette.events[0] as { content: string }).content).toBe('hello from head');
  });

  it('uses base prefix when head has none', () => {
    const userMsg: TraceEvent = {
      id: 'u1',
      seq: 0,
      at: new Date(0).toISOString(),
      type: 'user.message',
      content: 'hello from base',
    };
    const base = cassette([userMsg, ...segment('aaa', 'hi', 1)]);
    const head = cassette(segment('aaa', 'hi', 1));
    const r = rebaseCassettes(base, head);
    expect(r.cassette.events[0].type).toBe('user.message');
  });

  it('partial re-record of a 3-step cassette keeps the untouched step', () => {
    const base = cassette([
      ...segment('step1', 'one', 1),
      ...segment('step2', 'two', 3),
      ...segment('step3', 'three', 5),
    ]);
    // Only re-recorded step1 and step3; step2 prompt was unchanged so not re-recorded.
    const head = cassette([
      ...segment('step1', 'one-v2', 1),
      ...segment('step3', 'three-v2', 3),
    ]);
    const r = rebaseCassettes(base, head);
    expect(r.summary.updated).toBe(2);
    expect(r.summary.retained).toBe(1);
    expect(r.summary.unchanged).toBe(0);
    const hashes = r.cassette.events.filter((e) => e.type === 'llm.request').map((e) => (e as LLMRequestEvent).requestHash);
    expect(hashes).toEqual(['step1', 'step3', 'step2']);
    const outputs = r.cassette.events.filter((e) => e.type === 'llm.response').map((e) => (e as LLMResponseEvent).output);
    expect(outputs).toEqual(['one-v2', 'three-v2', 'two']);
  });
});
