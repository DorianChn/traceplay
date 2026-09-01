import { evaluateSuite } from '../commands/test.js';

export interface MatrixEntry {
  name: string;
  suite: string;
}

export interface MatrixRunResult {
  name: string;
  suite: string;
  pass: number;
  fail: number;
  todo: number;
  exitCode: number;
  durationMs: number;
}

export interface MatrixReport {
  runs: MatrixRunResult[];
  generatedAt: string;
}

/**
 * Run multiple suites (e.g. one per model or per prompt variant) and collect
 * their reports into a single comparison result.
 */
export async function runMatrix(entries: MatrixEntry[]): Promise<MatrixReport> {
  const runs: MatrixRunResult[] = [];
  for (const entry of entries) {
    const startedAt = Date.now();
    const report = await evaluateSuite(entry.suite);
    runs.push({
      name: entry.name,
      suite: entry.suite,
      pass: report.summary.pass,
      fail: report.summary.fail,
      todo: report.summary.todo,
      exitCode: report.summary.exitCode,
      durationMs: Date.now() - startedAt,
    });
  }
  return { runs, generatedAt: new Date().toISOString() };
}
