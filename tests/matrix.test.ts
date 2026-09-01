import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { runMatrix } from '../src/matrix/runner.js';
import { runMatrixCmd } from '../src/commands/matrix.js';
import { formatMatrixConsole, formatMatrixMarkdown, formatMatrixJson } from '../src/report/matrix.js';

const EXAMPLE_SUITE = fileURLToPath(new URL('../examples/demo/suite.example.yaml', import.meta.url));
const EXAMPLE_CASSETTE = fileURLToPath(new URL('../examples/demo/cassette.example.jsonl', import.meta.url));

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

  it('resolves suite paths relative to the matrix config directory', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'tp-mx-'));
    try {
      const suiteYaml = [
        'suite: local',
        'cases:',
        '  - name: c1',
        `    cassette: ${EXAMPLE_CASSETTE.replace(/\\/g, '/')}`,
        '    assertions:',
        '      - kind: answer.contains',
        '        text: sunny',
      ].join('\n');
      await fs.writeFile(join(dir, 'suite.yaml'), suiteYaml);
      const cfg = join(dir, 'matrix.yaml');
      await fs.writeFile(cfg, 'runs:\n  - name: local\n    suite: ./suite.yaml\n');

      // Run from a *different* cwd to prove paths resolve against the config.
      const code = await runMatrixCmd({ config: cfg, format: 'json' });
      expect(code).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
