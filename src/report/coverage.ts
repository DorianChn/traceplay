import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readCassette } from '../cassette/store.js';
import type { TestSuite } from '../types.js';

export interface CoverageReport {
  suite: string;
  caseCount: number;
  assertionCount: number;
  byAssertionKind: Record<string, number>;
  eventTypesPresent: string[];
  eventTypesMissing: string[];
}

export const ALL_EVENT_TYPES = [
  'user.message',
  'llm.request',
  'llm.response',
  'tool.call',
  'tool.result',
  'agent.error',
];

/**
 * Analyze a suite: how often each assertion kind is used, and which event
 * types appear in the referenced cassettes vs. the full trace vocabulary.
 * Surfaces under-tested behaviors (e.g. no cassette with agent.error).
 */
export async function computeCoverage(suitePath: string): Promise<CoverageReport> {
  const raw = await fs.readFile(suitePath, 'utf8');
  const suite: TestSuite = suitePath.endsWith('.json')
    ? (JSON.parse(raw) as TestSuite)
    : (parseYaml(raw) as TestSuite);

  const suiteDir = dirname(isAbsolute(suitePath) ? suitePath : resolve(process.cwd(), suitePath));
  const byAssertionKind: Record<string, number> = {};
  const present = new Set<string>();
  let assertionCount = 0;

  for (const testCase of suite.cases) {
    for (const assertion of testCase.assertions) {
      assertionCount++;
      const kind = (assertion as unknown as { kind: string }).kind;
      byAssertionKind[kind] = (byAssertionKind[kind] ?? 0) + 1;
    }
    const cassettePath = isAbsolute(testCase.cassette)
      ? testCase.cassette
      : resolve(suiteDir, testCase.cassette);
    try {
      const cassette = await readCassette(cassettePath);
      for (const e of cassette.events) present.add(e.type);
    } catch {
      // cassette unreadable — skip its event types
    }
  }

  const eventTypesPresent = ALL_EVENT_TYPES.filter((t) => present.has(t));
  const eventTypesMissing = ALL_EVENT_TYPES.filter((t) => !present.has(t));

  return {
    suite: suite.suite,
    caseCount: suite.cases.length,
    assertionCount,
    byAssertionKind,
    eventTypesPresent,
    eventTypesMissing,
  };
}

export function formatCoverage(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(`traceplay coverage — ${report.suite}`);
  lines.push(`  cases:     ${report.caseCount}`);
  lines.push(`  assertions: ${report.assertionCount}`);
  lines.push('');
  lines.push('Assertion usage:');
  const kinds = Object.entries(report.byAssertionKind).sort((a, b) => b[1] - a[1]);
  if (kinds.length === 0) lines.push('  (none)');
  for (const [kind, count] of kinds) {
    lines.push(`  ${kind.padEnd(22)} ${count}`);
  }
  lines.push('');
  lines.push('Event types in cassettes:');
  lines.push(`  present: ${report.eventTypesPresent.join(', ') || '(none)'}`);
  lines.push(`  missing: ${report.eventTypesMissing.join(', ') || '(none)'}`);
  if (report.eventTypesMissing.length > 0) {
    lines.push('');
    lines.push('Tip: missing event types are behaviors no test exercises yet.');
  }
  return lines.join('\n');
}
