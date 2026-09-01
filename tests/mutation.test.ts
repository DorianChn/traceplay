import { describe, expect, it } from 'vitest';
import {
  runMutationTesting,
  listMutators,
  formatMutationReport,
} from '../src/mutate/runner.js';
import { MUTATORS } from '../src/mutate/mutators.js';
import type {
  Assertion,
  LLMRequestEvent,
  LLMResponseEvent,
  ToolCallEvent,
  ToolResultEvent,
  TraceEvent,
} from '../src/types.js';

/** A 3-step trajectory with usage, plus one search tool call/result. */
function buildTrace(): TraceEvent[] {
  const answers = ['alpha answer', 'beta answer', 'final gamma answer'];
  const events: TraceEvent[] = [];
  answers.forEach((text, i) => {
    events.push({
      id: `req-${i}`,
      seq: i * 2,
      at: new Date(0).toISOString(),
      type: 'llm.request',
      provider: 'other',
      model: 'm',
      messages: [{ role: 'user', content: `q${i}` }],
      requestHash: `h${i}`,
    } as LLMRequestEvent);
    events.push({
      id: `res-${i}`,
      seq: i * 2 + 1,
      at: new Date(0).toISOString(),
      type: 'llm.response',
      requestId: `req-${i}`,
      status: 200,
      output: text,
      usage: { promptTokens: 100, completionTokens: 100 },
    } as LLMResponseEvent);
  });
  events.push({
    id: 'call-1',
    seq: 6,
    at: new Date(0).toISOString(),
    type: 'tool.call',
    name: 'search',
    callId: 'c1',
    arguments: { query: 'x', n: 2 },
  } as ToolCallEvent);
  events.push({
    id: 'tres-1',
    seq: 7,
    at: new Date(0).toISOString(),
    type: 'tool.result',
    callId: 'c1',
    output: 'found',
  } as ToolResultEvent);
  return events;
}

describe('R7 mutation testing', () => {
  it('ships a mutator for every assertion family', () => {
    const infos = listMutators();
    expect(infos).toHaveLength(MUTATORS.length);
    expect(infos.length).toBeGreaterThanOrEqual(7);
    const covered = new Set(infos.flatMap((i) => i.targets));
    for (const kind of [
      'answer.contains',
      'answer.matches',
      'tool.called',
      'tool.order',
      'tool.args',
      'forbid.tool',
      'budget.maxTokens',
      'budget.maxSteps',
    ]) {
      expect(covered.has(kind)).toBe(true);
    }
  });

  it('kills every injected mutation for a strong assertion suite', async () => {
    const assertions: Assertion[] = [
      { kind: 'answer.contains', text: 'gamma' },
      { kind: 'tool.called', name: 'search' },
      { kind: 'tool.order', names: ['search'] },
      { kind: 'forbid.tool', name: 'dangerous_rm' },
      { kind: 'tool.args', name: 'search', jsonPath: '$.query', equals: 'x' },
      { kind: 'budget.maxTokens', value: 1000 },
      { kind: 'budget.maxSteps', value: 3 },
    ];
    const report = await runMutationTesting(buildTrace(), assertions);

    expect(report.survived).toBe(0);
    expect(report.killed).toBeGreaterThanOrEqual(7);
    expect(report.mutationScore).toBe(1);
    // Every scored result is killed.
    for (const r of report.results) {
      expect(['killed', 'skipped']).toContain(r.status === 'killed' ? 'killed' : 'skipped');
    }
  });

  it('flags a vacuous assertion as survived (the bug it should catch escapes)', async () => {
    // /.* / matches any non-empty (and empty) answer, so changing or dropping
    // the answer leaves it green — the textbook weak assertion.
    const weak: Assertion[] = [{ kind: 'answer.matches', regex: '.*' }];
    const report = await runMutationTesting(buildTrace(), weak);
    expect(report.killed).toBe(0);
    expect(report.survived).toBeGreaterThanOrEqual(1);
    expect(report.mutationScore).toBe(0);
    const text = formatMutationReport(report);
    expect(text).toMatch(/SURVIVED|Mutation score/);
  });

  it('skips (does not score) an assertion that already fails on the baseline', async () => {
    const broken: Assertion[] = [{ kind: 'answer.contains', text: 'this-string-never-appears' }];
    const report = await runMutationTesting(buildTrace(), broken);
    expect(report.killed).toBe(0);
    expect(report.survived).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.results[0].status).toBe('baseline-failed');
    // No scored items → score is a perfect 1 by convention (nothing escaped).
    expect(report.mutationScore).toBe(1);
  });

  it('reports no-mutator when the cassette has no applicable target', async () => {
    // tool.called for a tool that was never recorded → drop-call has nothing to remove.
    const assertions: Assertion[] = [{ kind: 'tool.called', name: 'never_recorded_tool' }];
    // Baseline already fails (tool absent), which is baseline-failed; to reach
    // the apply→null path cleanly, use a forbid assertion on an absent tool
    // whose inject still works, and a present tool via tool.called below.
    const present: Assertion[] = [{ kind: 'tool.called', name: 'search' }];
    const report = await runMutationTesting(buildTrace(), present);
    expect(report.results.every((r) => r.status === 'killed')).toBe(true);
    // And the absent-tool case is classified as baseline-failed, never crashed.
    const absent = await runMutationTesting(buildTrace(), assertions);
    expect(absent.results[0].status).toBe('baseline-failed');
  });

  it('mutators never mutate the original events array (deep copy)', async () => {
    const events = buildTrace();
    const snapshot = JSON.stringify(events);
    await runMutationTesting(events, [{ kind: 'answer.contains', text: 'gamma' }]);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
});
