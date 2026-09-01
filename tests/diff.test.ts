import { describe, expect, it } from 'vitest';
import { compareCassettes, formatDiff } from '../src/report/diff.js';
import { requestHash } from '../src/core/hash.js';
import type { Cassette } from '../src/types.js';

const now = '2026-09-01T00:00:00.000Z';

function makeCassette(question: string, answer: string, tool?: string): Cassette {
  const body = { model: 'demo', messages: [{ role: 'user', content: question }] };
  const events = [
    { id: 'u1', seq: 0, at: now, type: 'user.message', content: question },
    { id: 'r1', seq: 1, at: now, type: 'llm.request', provider: 'openai-compatible', model: 'demo', messages: body.messages, requestHash: requestHash(body) },
  ] as Cassette['events'];
  if (tool) {
    events.push({ id: 't1', seq: 2, at: now, type: 'tool.call', name: tool, arguments: {} } as Cassette['events'][number]);
  }
  events.push({ id: 's1', seq: 3, at: now, type: 'llm.response', requestId: 'r1', status: 200, output: { choices: [{ message: { content: answer } }] }, usage: { promptTokens: 10, completionTokens: 5 } } as Cassette['events'][number]);
  return { version: 1, meta: { recordedAt: now, redacted: true }, events };
}

describe('report/diff', () => {
  it('detects added, removed, changed responses and tool changes', () => {
    const a = makeCassette('weather in Xiamen?', 'Xiamen is sunny.', 'get_weather');
    const b = makeCassette('weather in Xiamen?', 'Xiamen is rainy.', 'get_weather');

    // b also has a brand-new request about stocks
    const bBody = { model: 'demo', messages: [{ role: 'user', content: 'what about stocks?' }] };
    b.events.push({
      id: 'r2', seq: 4, at: now, type: 'llm.request', provider: 'openai-compatible', model: 'demo', messages: bBody.messages, requestHash: requestHash(bBody),
    });
    b.events.push({
      id: 's2', seq: 5, at: now, type: 'llm.response', requestId: 'r2', status: 200, output: { choices: [{ message: { content: 'stocks up' } }] }, usage: { promptTokens: 5, completionTokens: 2 },
    });
    // b adds a new tool call
    b.events.push({ id: 't2', seq: 6, at: now, type: 'tool.call', name: 'execute_shell', arguments: {} });

    const report = compareCassettes(a, b);

    expect(report.added).toHaveLength(1);
    expect(report.removed).toHaveLength(0);
    expect(report.changedResponses).toHaveLength(1);
    expect(report.changedResponses[0].from).toContain('sunny');
    expect(report.changedResponses[0].to).toContain('rainy');
    expect(report.toolChanges).toEqual([{ kind: 'added', name: 'execute_shell' }]);

    const text = formatDiff(report, 'a.jsonl', 'b.jsonl');
    expect(text).toContain('traceplay diff');
    expect(text).toContain('Requests added (1)');
    expect(text).toContain('Responses changed (1)');
  });

  it('reports no differences for identical cassettes', () => {
    const a = makeCassette('hello', 'world', 'search');
    const b = makeCassette('hello', 'world', 'search');
    const report = compareCassettes(a, b);
    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.changedResponses).toHaveLength(0);
    expect(report.toolChanges).toHaveLength(0);
  });
});
