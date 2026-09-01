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
  let raw: string;
  try {
    raw = await fs.readFile(suitePath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read suite file "${suitePath}": ${(err as Error).message}`);
  }
  // Strip a UTF-8 BOM if present (common in files saved by Windows editors).
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  let suite: TestSuite;
  try {
    suite = suitePath.endsWith('.json')
      ? (JSON.parse(raw) as TestSuite)
      : (parseYaml(raw) as TestSuite);
  } catch (err) {
    throw new Error(`Failed to parse suite "${suitePath}": ${(err as Error).message}`);
  }
  if (!suite || typeof suite !== 'object') {
    throw new Error(`Suite "${suitePath}" did not parse into an object`);
  }
  if (!Array.isArray(suite.cases)) {
    throw new Error(`Suite "${suitePath}" is missing a "cases" array`);
  }

  const suiteDir = dirname(isAbsolute(suitePath) ? suitePath : resolve(process.cwd(), suitePath));
  const caseReports: CaseReport[] = [];

  suite.cases.forEach((testCase, idx) => {
    const label = `Case #${idx + 1}${testCase?.name ? ` ("${testCase.name}")` : ''}`;
    if (!testCase || typeof testCase !== 'object') {
      throw new Error(`${label} in "${suitePath}" is not an object`);
    }
    if (typeof testCase.cassette !== 'string' || testCase.cassette.length === 0) {
      throw new Error(`${label} in "${suitePath}" is missing a "cassette" path`);
    }
    if (!Array.isArray(testCase.assertions)) {
      throw new Error(`${label} in "${suitePath}" is missing an "assertions" array`);
    }
  });

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
  const format = args.format ?? 'console';
  if (format !== 'console' && format !== 'json' && format !== 'markdown') {
    throw new Error(`Unknown report format "${format}". Expected one of: console, json, markdown`);
  }
  const report = await evaluateSuite(args.suite);
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
