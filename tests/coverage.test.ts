import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { computeCoverage, formatCoverage, ALL_EVENT_TYPES } from '../src/report/coverage.js';

const EXAMPLE_SUITE = fileURLToPath(new URL('../examples/demo/suite.example.yaml', import.meta.url));

describe('report/coverage', () => {
  it('counts assertion kinds and event types', async () => {
    const report = await computeCoverage(EXAMPLE_SUITE);
    expect(report.suite).toBe('demo');
    expect(report.caseCount).toBe(2);
    expect(report.assertionCount).toBe(6);
    expect(report.byAssertionKind['tool.called']).toBe(1);
    expect(report.byAssertionKind['answer.contains']).toBe(1);
    expect(report.eventTypesPresent).toContain('llm.request');
    expect(report.eventTypesPresent).toContain('tool.call');
    expect(report.eventTypesMissing.length).toBeLessThan(ALL_EVENT_TYPES.length);
  });

  it('formats a readable coverage report', async () => {
    const report = await computeCoverage(EXAMPLE_SUITE);
    const text = formatCoverage(report);
    expect(text).toContain('traceplay coverage');
    expect(text).toContain('Assertion usage:');
    expect(text).toContain('tool.called');
    expect(text).toContain('Event types in cassettes:');
  });
});
