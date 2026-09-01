import type { AssertResult, CaseReport, Summary, TestReport } from '../types.js';

export function summarize(results: AssertResult[]): Summary {
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const todo = results.filter((r) => r.status === 'todo').length;
  return { pass, fail, todo, exitCode: fail > 0 ? 1 : 0 };
}

export function buildReport(suite: string, cases: CaseReport[]): TestReport {
  const allResults = cases.flatMap((c) => c.results);
  return {
    suite,
    cases,
    summary: summarize(allResults),
    generatedAt: new Date().toISOString(),
  };
}

export function formatConsole(report: TestReport): string {
  const lines: string[] = [];
  for (const testCase of report.cases) {
    lines.push(`\n● ${testCase.name}`);
    for (const r of testCase.results) {
      const mark = r.status === 'pass' ? '[PASS]' : r.status === 'fail' ? '[FAIL]' : '[TODO]';
      lines.push(`  ${mark} ${r.assertion.kind} — ${r.message}`);
    }
  }
  lines.push(
    `\n${report.summary.pass} passed, ${report.summary.fail} failed, ${report.summary.todo} scaffolded (TODO)`,
  );
  return lines.join('\n');
}
