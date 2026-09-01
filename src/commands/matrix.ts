import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { runMatrix, type MatrixEntry } from '../matrix/runner.js';
import { formatMatrixConsole, formatMatrixMarkdown, formatMatrixJson } from '../report/matrix.js';

export type MatrixFormat = 'console' | 'markdown' | 'json';

export interface MatrixArgs {
  config: string;
  format?: MatrixFormat;
  output?: string;
}

/**
 * `traceplay matrix --config matrix.yaml [--format console|markdown|json] [--output <file>]`
 *
 * matrix.yaml:
 *   runs:
 *     - { name: gpt-4o,    suite: suites/gpt-4o/suite.yaml }
 *     - { name: claude-3,  suite: suites/claude-3/suite.yaml }
 *   format: console
 */
export async function runMatrixCmd(args: MatrixArgs): Promise<number> {
  const raw = await fs.readFile(args.config, 'utf8');
  const config = parseYaml(raw) as { runs?: MatrixEntry[]; format?: MatrixFormat; output?: string };

  // Suite paths inside matrix.yaml are relative to the config file itself,
  // not to the process working directory — so the command works from anywhere.
  const configDir = dirname(args.config);
  const runs = (config.runs ?? []).map((r) => ({ ...r, suite: resolve(configDir, r.suite) }));
  if (runs.length === 0) {
    console.error('[traceplay] matrix.yaml has no runs. Add at least one { name, suite } entry.');
    return 2;
  }

  const report = await runMatrix(runs);
  const format = args.format ?? config.format ?? 'console';
  const output =
    format === 'json'
      ? formatMatrixJson(report)
      : format === 'markdown'
        ? formatMatrixMarkdown(report)
        : formatMatrixConsole(report);

  const outPath = args.output ?? config.output;
  if (outPath) {
    await fs.writeFile(outPath, output, 'utf8');
    console.log(`[traceplay] matrix report written to ${outPath}`);
  } else {
    console.log(output);
  }

  const anyFail = report.runs.some((r) => r.fail > 0);
  return anyFail ? 1 : 0;
}
