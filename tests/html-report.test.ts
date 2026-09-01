import { describe, expect, it } from 'vitest';
import { formatHtml } from '../src/report/html.js';
import { buildTimeline } from '../src/report/timeline.js';
import type { AssertResult, TestReport, TraceEvent } from '../src/types.js';

function result(status: AssertResult['status'], kind: string, message: string): AssertResult {
  return { status, assertion: { kind } as AssertResult['assertion'], message };
}

function report(partial?: Partial<TestReport>): TestReport {
  return {
    suite: 'demo suite',
    generatedAt: '2026-09-01T00:00:00.000Z',
    cases: [
      {
        name: 'case one',
        cassette: 'c.jsonl',
        passed: true,
        results: [result('pass', 'answer.contains', 'answer contains "ok"')],
        timeline: [
          { seq: 0, type: 'user.message', label: 'book a flight' },
          { seq: 1, type: 'tool.call', label: 'search({})' },
          { seq: 2, type: 'llm.response', label: 'here is ok', status: 200, tokens: 42, turn: 0 },
        ],
      },
    ],
    summary: { pass: 1, fail: 0, todo: 0, exitCode: 0 },
    ...partial,
  };
}

describe('formatHtml self-contained report', () => {
  it('renders suite, assertions and timeline', () => {
    const html = formatHtml(report());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('demo suite');
    expect(html).toContain('answer.contains');
    expect(html).toContain('book a flight');
    expect(html).toContain('HTTP 200');
    expect(html).toContain('42 tok');
    expect(html).toContain('turn 1');
    expect(html).toContain('>PASS<');
  });

  it('shows FAIL verdict and classes when something failed', () => {
    const html = formatHtml(
      report({
        cases: [
          {
            name: 'bad',
            cassette: 'c.jsonl',
            passed: false,
            results: [result('fail', 'answer.shape', '$.id: required but missing')],
            timeline: [],
          },
        ],
        summary: { pass: 0, fail: 1, todo: 0, exitCode: 1 },
      }),
    );
    expect(html).toContain('summary bad');
    expect(html).toContain('>FAIL<');
    expect(html).toContain('$.id: required but missing');
  });

  it('escapes HTML in event/assertion text (no injection)', () => {
    const html = formatHtml(
      report({
        cases: [
          {
            name: '<script>alert(1)</script>',
            cassette: 'c.jsonl',
            passed: true,
            results: [result('pass', 'answer.contains', '<img src=x>')],
            timeline: [{ seq: 0, type: 'agent.error', label: '<b>boom</b>', isError: true }],
          },
        ],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;boom&lt;/b&gt;');
  });

  it('is fully self-contained: no external http references', () => {
    const html = formatHtml(report());
    expect(html).not.toMatch(/(src|href)\s*=\s*["']https?:/);
  });

  it('renders a TODO assertion badge', () => {
    const html = formatHtml(
      report({
        cases: [
          {
            name: 'scaffold',
            cassette: 'c.jsonl',
            passed: true,
            results: [result('todo', 'answer.judge', 'no judge key configured')],
            timeline: [],
          },
        ],
      }),
    );
    expect(html).toContain('as-todo');
    expect(html).toContain('>TODO<');
  });
});

describe('buildTimeline', () => {
  it('compresses events into labeled items and computes tokens', () => {
    const events = [
      {
        id: 'q',
        seq: 0,
        at: 't',
        type: 'llm.request',
        provider: 'other',
        model: 'm',
        messages: [{ role: 'user', content: 'find order' }],
        requestHash: 'h',
        turn: 0,
      },
      {
        id: 's',
        seq: 1,
        at: 't',
        type: 'llm.response',
        requestId: 'q',
        status: 200,
        output: 'order found',
        usage: { promptTokens: 10, completionTokens: 5 },
      },
    ] as TraceEvent[];
    const items = buildTimeline(events);
    expect(items).toHaveLength(2);
    expect(items[0].label).toBe('find order');
    expect(items[1].tokens).toBe(15);
    expect(items[1].turn).toBe(0);
  });
});
