import type { AssertResult, TestCase } from '../types.js';

export interface Summary {
  pass: number;
  fail: number;
  todo: number;
  /** 0 if no failures, 1 otherwise. CI gates on this. */
  exitCode: number;
}

export function summarize(results: AssertResult[]): Summary {
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const todo = results.filter((r) => r.status === 'todo').length;
  return { pass, fail, todo, exitCode: fail > 0 ? 1 : 0 };
}

export function formatCase(testCase: TestCase, results: AssertResult[]): string {
  const lines: string[] = [`\n● ${testCase.name}`];
  for (const r of results) {
    const mark = r.status === 'pass' ? '[PASS]' : r.status === 'fail' ? '[FAIL]' : '[TODO]';
    lines.push(`  ${mark} ${r.assertion.kind} — ${r.message}`);
  }
  return lines.join('\n');
}

export function formatSummary(summary: Summary): string {
  return `\n${summary.pass} passed, ${summary.fail} failed, ${summary.todo} scaffolded (TODO)`;
}
