import { describe, expect, it } from 'vitest';
import { compareCassettes, formatDiff, DIFF_CHANGE_THRESHOLD } from '../src/report/diff.js';
import { normalizeRequest, normalizeResponse } from '../src/cassette/normalize.js';
import type { Cassette, TraceEvent } from '../src/types.js';

function makeCassette(prompt: string, answer: string, model = 'm'): Cassette {
  const req = normalizeRequest(
    '/v1/chat/completions',
    JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    0,
  );
  if (!req) throw new Error('normalize failed');
  const res = normalizeResponse(
    req.event.id,
    200,
    JSON.stringify({ choices: [{ message: { content: answer } }] }),
    'openai-compatible',
    1,
  );
  const events: TraceEvent[] = [req.event, res.event];
  return { meta: { recordedAt: new Date(0).toISOString(), redacted: true }, events };
}

describe('R10 semantic diff pairs drifted requests as changed (not added+removed)', () => {
  it('classifies a one-word prompt drift as a single changed request', () => {
    const a = makeCassette('summarize the quarterly financial report please', 'AAA');
    const b = makeCassette('summarize the quarterly financial report now please', 'BBB');
    const report = compareCassettes(a, b);

    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.changedRequests).toHaveLength(1);
    expect(report.changedResponses).toHaveLength(0);
    const change = report.changedRequests[0];
    expect(change.score).toBeGreaterThanOrEqual(DIFF_CHANGE_THRESHOLD);
    expect(change.fromAnswer).toBe('AAA');
    expect(change.toAnswer).toBe('BBB');
  });

  it('reports a changed response when the prompt is identical but the answer differs', () => {
    const a = makeCassette('what is the capital of France', 'Paris');
    const b = makeCassette('what is the capital of France', 'Lyon');
    const report = compareCassettes(a, b);

    expect(report.changedRequests).toHaveLength(0);
    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.changedResponses).toHaveLength(1);
    expect(report.changedResponses[0]).toMatchObject({ from: 'Paris', to: 'Lyon' });
  });

  it('still reports genuinely unrelated requests as added/removed', () => {
    const a = makeCassette('explain how databases index data', 'indexing');
    const b = makeCassette('write a haiku about the ocean at dawn', 'haiku');
    const report = compareCassettes(a, b);

    expect(report.changedRequests).toHaveLength(0);
    expect(report.removed).toHaveLength(1);
    expect(report.added).toHaveLength(1);
  });

  it('renders a changed-request section in the text report', () => {
    const a = makeCassette('translate this sentence to french please', 'bonjour');
    const b = makeCassette('translate this sentence to french now please', 'salut');
    const text = formatDiff(compareCassettes(a, b), 'a.jsonl', 'b.jsonl');
    expect(text).toMatch(/Requests changed in place \(1\)/);
    expect(text).toMatch(/Summary: 1 changed, 0 added, 0 removed/);
  });
});
