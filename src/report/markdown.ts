import type { TestReport } from '../types.js';

/**
 * Markdown reporter — output can be pasted directly into a PR comment.
 */
export function formatMarkdown(report: TestReport): string {
  const lines: string[] = [];
  lines.push(`## traceplay test report — ${report.suite}`);
  lines.push('');
  lines.push(
    `**${report.summary.pass}** passed · **${report.summary.fail}** failed · **${report.summary.todo}** todo · generated ${report.generatedAt}`,
  );
  lines.push('');

  for (const testCase of report.cases) {
    const icon = testCase.passed ? '✅' : '❌';
    lines.push(`### ${icon} ${testCase.name}`);
    lines.push('');
    lines.push('| Status | Assertion | Detail |');
    lines.push('|--------|-----------|--------|');
    for (const r of testCase.results) {
      const status = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'TODO';
      lines.push(`| ${status} | \`${r.assertion.kind}\` | ${r.message} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
