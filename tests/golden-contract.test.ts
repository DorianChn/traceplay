import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCassette } from '../src/cassette/store.js';
import { matchRequest } from '../src/replayer/matcher.js';
import { requestHash, semanticRequestHash } from '../src/core/hash.js';
import { CURRENT_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, type LLMResponseEvent } from '../src/types.js';

const GOLDEN = new URL('../fixtures/golden/cassette.golden.jsonl', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);
const HASHES = new URL('../fixtures/golden/golden-hashes.json', import.meta.url);
const AT = '2026-09-01T00:00:00.000Z';

const body1 = {
  model: 'gpt-golden',
  messages: [{ role: 'user', content: 'What is the capital of France?' }],
};
const body2 = {
  model: 'gpt-golden',
  messages: [
    { role: 'system', content: 'You are terse.' },
    { role: 'user', content: 'What is the capital of France?' },
    { role: 'assistant', content: 'Paris.' },
    { role: 'user', content: 'And of Germany?' },
  ],
};

function answerOf(ev: LLMResponseEvent): string {
  const out = ev.output as { choices?: Array<{ message?: { content?: string } }> };
  return out.choices?.[0]?.message?.content ?? '';
}

describe('golden contract — deterministic replay (R3)', () => {
  it('loads the checked-in golden cassette unchanged', async () => {
    const cassette = await readCassette(GOLDEN);
    expect(cassette.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(cassette.meta.project).toBe('golden');
    expect(cassette.events).toHaveLength(5);
  });

  it('locks canonicalization hashes to the checked-in golden values', async () => {
    const locked = JSON.parse(await fs.readFile(HASHES, 'utf8'));
    // Any change to canonicalize/semanticCanonicalize breaks these and must be
    // a deliberate, reviewed golden update — never a silent refactor.
    expect(requestHash(body1)).toBe(locked.body1_exact);
    expect(semanticRequestHash(body1)).toBe(locked.body1_semantic);
    expect(requestHash(body2)).toBe(locked.body2_exact);
    expect(semanticRequestHash(body2)).toBe(locked.body2_semantic);
  });

  it('replays body1 exactly and returns the golden response bytes', async () => {
    const cassette = await readCassette(GOLDEN);
    const m = matchRequest(body1, cassette.events);
    expect(m.found).toBe(true);
    expect(m.strategy).toBe('exact');
    expect(m.requestIndex).toBe(1);
    const res = cassette.events[m.responseIndex] as LLMResponseEvent;
    expect(answerOf(res)).toBe('Paris.');
    expect(res.rawBody).toBe(
      '{"id":"golden-1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"Paris."}}]}',
    );
  });

  it('L1 semantic layer absorbs seed + whitespace drift deterministically', async () => {
    const cassette = await readCassette(GOLDEN);
    const drifted = {
      model: 'gpt-golden',
      seed: 4242,
      messages: [{ role: 'user', content: 'What is the capital of   France?' }],
    };
    const m = matchRequest(drifted, cassette.events); // fuzzy OFF
    expect(m.found).toBe(true);
    expect(m.strategy).toBe('semantic');
    expect(m.requestIndex).toBe(1);
  });

  it('L2 structured layer recovers body2 after an early-history wording edit', async () => {
    const cassette = await readCassette(GOLDEN);
    const drifted = {
      model: 'gpt-golden',
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'What is the capital city of France?' }, // reworded
        { role: 'assistant', content: 'Paris.' },
        { role: 'user', content: 'And of Germany?' },
      ],
    };
    const deterministic = matchRequest(drifted, cassette.events);
    expect(deterministic.found).toBe(false); // L0/L1 cannot absorb a token change
    const fuzzy = matchRequest(drifted, cassette.events, { fuzzy: true });
    expect(fuzzy.found).toBe(true);
    expect(fuzzy.strategy).toBe('structured');
    expect(fuzzy.requestIndex).toBe(3);
    const res = cassette.events[fuzzy.responseIndex] as LLMResponseEvent;
    expect(answerOf(res)).toBe('Berlin.');
  });

  it('returns a hard miss for an unrelated request', async () => {
    const cassette = await readCassette(GOLDEN);
    const m = matchRequest(
      { model: 'gpt-golden', messages: [{ role: 'user', content: 'write me a haiku about databases' }] },
      cassette.events,
      { fuzzy: true },
    );
    expect(m.found).toBe(false);
    expect(m.ambiguous).toBe(false);
    expect(m.diagnostic).toBeTruthy();
  });
});

describe('golden contract — cassette schema versioning (R3)', () => {
  async function writeTmp(content: string): Promise<string> {
    const p = join(tmpdir(), `tp-golden-${Math.random().toString(36).slice(2)}.jsonl`);
    await fs.writeFile(p, content, 'utf8');
    return p;
  }

  it('rejects a newer/unknown schema with an explicit migration error', async () => {
    const future = JSON.stringify({ cassette: 'traceplay', version: 999, recordedAt: AT }) + '\n';
    const p = await writeTmp(future);
    await expect(readCassette(p)).rejects.toThrow(/Unsupported cassette schema v999/);
  });

  it('rejects a cassette with no numeric version', async () => {
    const noVersion = JSON.stringify({ cassette: 'traceplay', recordedAt: AT }) + '\n';
    const p = await writeTmp(noVersion);
    await expect(readCassette(p)).rejects.toThrow(/missing a numeric "version"/);
  });

  it('declares the schema versions it supports', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain(CURRENT_SCHEMA_VERSION);
  });
});
