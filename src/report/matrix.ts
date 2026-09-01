import type { MatrixReport } from '../matrix/runner.js';

export function formatMatrixConsole(report: MatrixReport): string {
  const lines: string[] = [];
  lines.push('traceplay matrix — comparison');
  lines.push('');
  lines.push('  name       suite                                  pass  fail  todo  exit   time');
  for (const r of report.runs) {
    lines.push(
      `  ${r.name.padEnd(10)} ${r.suite.padEnd(36)} ${String(r.pass).padStart(4)}  ${String(r.fail).padStart(4)}  ${String(r.todo).padStart(4)}  ${String(r.exitCode).padStart(4)}  ${r.durationMs}ms`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function formatMatrixMarkdown(report: MatrixReport): string {
  const lines: string[] = [];
  lines.push('# traceplay matrix report');
  lines.push('');
  lines.push(`_generated ${report.generatedAt}_`);
  lines.push('');
  lines.push('| run | suite | pass | fail | todo | exit | time |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const r of report.runs) {
    lines.push(`| ${r.name} | \`${r.suite}\` | ${r.pass} | ${r.fail} | ${r.todo} | ${r.exitCode} | ${r.durationMs}ms |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function formatMatrixJson(report: MatrixReport): string {
  return JSON.stringify(report, null, 2);
}
