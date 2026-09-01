import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderString, renderValue, describeRow } from '../src/core/template.js';
import { evaluateSuite } from '../src/commands/test.js';
import { writeCassette } from '../src/cassette/store.js';
import type { LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../src/types.js';

describe('{{ }} templating primitives', () => {
  it('substitutes known keys and tolerates whitespace', () => {
    expect(renderString('hi {{name}}', { name: 'Ada' })).toBe('hi Ada');
    expect(renderString('hi {{ name }}', { name: 'Ada' })).toBe('hi Ada');
  });

  it('leaves unknown placeholders visible and stringifies primitives', () => {
    expect(renderString('x={{missing}}', {})).toBe('x={{missing}}');
    expect(renderString('n={{n}}', { n: 7 })).toBe('n=7');
    expect(renderString('e={{x}}', { x: null })).toBe('e=');
  });

  it('renders recursively through objects and arrays but keeps kind intact', () => {
    const assertion = { kind: 'answer.contains', text: 'city={{city}}', meta: { deep: ['{{city}}', 2] } };
    const out = renderValue(assertion, { city: 'Paris' });
    expect(out.kind).toBe('answer.contains');
    expect(out.text).toBe('city=Paris');
    expect(out.meta.deep).toEqual(['Paris', 2]);
  });

  it('describes a row compactly', () => {
    expect(describeRow({ city: 'Paris', n: 2 })).toBe(' [city=Paris, n=2]');
    expect(describeRow({})).toBe('');
  });
});

describe('suite each-row expansion', () => {
  let dir: string;

  function events(answer: string): TraceEvent[] {
    return [
      {
        id: 'req',
        seq: 0,
        at: new Date(0).toISOString(),
        type: 'llm.request',
        provider: 'other',
        model: 'm',
        messages: [{ role: 'user', content: 'q' }],
        requestHash: 'h',
      } as LLMRequestEvent,
      {
        id: 'res',
        seq: 1,
        at: new Date(0).toISOString(),
        type: 'llm.response',
        requestId: 'req',
        status: 200,
        output: answer,
      } as LLMResponseEvent,
    ];
  }

  beforeAll(async () => {
    dir = join(tmpdir(), `traceplay-param-${process.pid}`);
    await fs.mkdir(dir, { recursive: true });
    await writeCassette(join(dir, 'capitals.jsonl'), { recordedAt: 't', redacted: true }, events('Capitals: Paris and Tokyo.'));
    const suite = `
suite: parametrized
cases:
  - name: every listed capital appears
    cassette: capitals.jsonl
    each:
      - { city: Paris }
      - { city: Tokyo }
    assertions:
      - { kind: answer.contains, text: "{{city}}" }
  - name: plain case without each still runs once
    cassette: capitals.jsonl
    assertions:
      - { kind: answer.contains, text: "Capitals" }
`;
    await fs.writeFile(join(dir, 'suite.yaml'), suite, 'utf8');
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('expands each into one run per row and substitutes placeholders', async () => {
    const report = await evaluateSuite(join(dir, 'suite.yaml'));
    // 2 expanded rows + 1 plain case
    expect(report.cases).toHaveLength(3);
    expect(report.cases[0].name).toContain('#1');
    expect(report.cases[0].name).toContain('city=Paris');
    expect(report.cases[1].name).toContain('city=Tokyo');
    expect(report.cases.every((c) => c.passed)).toBe(true);
    expect(report.summary.fail).toBe(0);
  });

  it('a failing expanded row surfaces the rendered value', async () => {
    const bad = `
suite: bad-param
cases:
  - name: missing entity
    cassette: capitals.jsonl
    each:
      - { city: Berlin }
    assertions:
      - { kind: answer.contains, text: "{{city}}" }
`;
    const p = join(dir, 'bad.yaml');
    await fs.writeFile(p, bad, 'utf8');
    const report = await evaluateSuite(p);
    expect(report.cases[0].passed).toBe(false);
    expect(report.cases[0].results[0].message).toContain('Berlin');
  });

  it('rejects a malformed each block', async () => {
    const bad = `
suite: malformed
cases:
  - name: x
    cassette: capitals.jsonl
    each: "not-an-array"
    assertions:
      - { kind: answer.contains, text: "Capitals" }
`;
    const p = join(dir, 'malformed.yaml');
    await fs.writeFile(p, bad, 'utf8');
    await expect(evaluateSuite(p)).rejects.toThrow(/invalid "each"/);
  });
});
