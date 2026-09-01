import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readCassette } from '../cassette/store.js';
import { runAssertions } from '../assert/engine.js';
import { buildReport, formatConsole } from '../report/console.js';
import { formatJson } from '../report/json.js';
import { formatMarkdown } from '../report/markdown.js';
import type { CaseReport, TestReport, TestSuite } from '../types.js';

export type ReportFormat = 'console' | 'json' | 'markdown';

export interface TestArgs {
  suite: string;
  format?: ReportFormat;
  output?: string;
}

/**
 * Evaluate a suite file and return the full report without printing.
 * Used by `traceplay test` and the matrix runner.
 */
export async function evaluateSuite(suitePath: string): Promise<TestReport> {
  const raw = await fs.readFile(suitePath, 'utf8');
  const suite: TestSuite = suitePath.endsWith('.json')
    ? (JSON.parse(raw) as TestSuite)
    : (parseYaml(raw) as TestSuite);

  const suiteDir = dirname(isAbsolute(suitePath) ? suitePath : resolve(process.cwd(), suitePath));
  const caseReports: CaseReport[] = [];

  for (const testCase of suite.cases) {
    const cassettePath = isAbsolute(testCase.cassette)
      ? testCase.cassette
      : resolve(suiteDir, testCase.cassette);
    const cassette = await readCassette(cassettePath);
    const results = await runAssertions(cassette.events, testCase.assertions);
    const passed = !results.some((r) => r.status === 'fail');
    caseReports.push({ name: testCase.name, cassette: testCase.cassette, results, passed });
  }

  return buildReport(suite.suite, caseReports);
}

export async function runTest(args: TestArgs): Promise<number> {
  const report = await evaluateSuite(args.suite);
  const format = args.format ?? 'console';
  const output =
    format === 'json' ? formatJson(report) : format === 'markdown' ? formatMarkdown(report) : formatConsole(report);

  if (args.output) {
    await fs.writeFile(args.output, output, 'utf8');
    console.log(`[traceplay] report written to ${args.output}`);
  } else {
    console.log(output);
  }

  return report.summary.exitCode;
}
