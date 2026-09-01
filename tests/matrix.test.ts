import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runMatrix } from '../src/matrix/runner.js';
import { formatMatrixConsole, formatMatrixMarkdown, formatMatrixJson } from '../src/report/matrix.js';

const EXAMPLE_SUITE = fileURLToPath(new URL('../examples/demo/suite.example.yaml', import.meta.url));

describe('matrix/runner', () => {
  it('runs a suite and reports per-run results', async () => {
    const report = await runMatrix([{ name: 'demo', suite: EXAMPLE_SUITE }]);
    expect(report.runs).toHaveLength(1);
    const run = report.runs[0];
    expect(run.name).toBe('demo');
    expect(run.pass).toBeGreaterThan(0);
    expect(run.fail).toBe(0);
    expect(run.exitCode).toBe(0);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('formats results for all reporters', async () => {
    const report = await runMatrix([{ name: 'demo', suite: EXAMPLE_SUITE }]);

    const consoleOut = formatMatrixConsole(report);
    expect(consoleOut).toContain('traceplay matrix');
    expect(consoleOut).toContain('demo');

    const md = formatMatrixMarkdown(report);
    expect(md).toContain('| run | suite |');
    expect(md).toContain('| demo |');

    const json = JSON.parse(formatMatrixJson(report));
    expect(json.runs[0].name).toBe('demo');
  });
});
