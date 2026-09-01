import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readCassette } from '../cassette/store.js';
import {
  runMutationTesting,
  formatMutationReport,
  type MutationReport,
} from '../mutate/runner.js';
import { expandCase } from '../suite/expand.js';
import type { TestSuite } from '../types.js';

export interface MutateArgs {
  suite: string;
  format?: 'console' | 'json';
  output?: string;
  /** Exit non-zero when any mutation survives (for CI gating). Default true. */
  strict?: boolean;
}

interface CaseMutation {
  name: string;
  cassette: string;
  report: MutationReport;
}

/** Evaluate every case in a suite and return per-case mutation reports. */
export async function evaluateMutations(suitePath: string): Promise<CaseMutation[]> {
  const raw0 = await fs.readFile(suitePath, 'utf8').catch((err: Error) => {
    throw new Error(`Cannot read suite file "${suitePath}": ${err.message}`);
  });
  let raw = raw0;
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const suite = (suitePath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as TestSuite;
  if (!suite || !Array.isArray(suite.cases)) {
    throw new Error(`Suite "${suitePath}" is missing a "cases" array`);
  }
  const suiteDir = dirname(isAbsolute(suitePath) ? suitePath : resolve(process.cwd(), suitePath));
  const out: CaseMutation[] = [];
  for (const testCase of suite.cases) {
    const cassettePath = isAbsolute(testCase.cassette)
      ? testCase.cassette
      : resolve(suiteDir, testCase.cassette);
    const cassette = await readCassette(cassettePath);
    // Expand parametrized rows exactly like `traceplay test` (v0.7).
    for (const run of expandCase(testCase)) {
      const report = await runMutationTesting(cassette.events, run.assertions);
      out.push({ name: run.name, cassette: testCase.cassette, report });
    }
  }
  return out;
}

function formatConsole(cases: CaseMutation[]): string {
  const blocks: string[] = [];
  let killed = 0;
  let survived = 0;
  for (const c of cases) {
    killed += c.report.killed;
    survived += c.report.survived;
    blocks.push(`## Case "${c.name}" (${c.cassette})\n${formatMutationReport(c.report)}`);
  }
  const scored = killed + survived;
  const score = scored === 0 ? 100 : Math.round((killed / scored) * 100);
  blocks.push(`Overall mutation score: ${score}% (${killed} killed, ${survived} survived)`);
  return blocks.join('\n\n');
}

export async function runMutate(args: MutateArgs): Promise<number> {
  const cases = await evaluateMutations(args.suite);
  const totalSurvived = cases.reduce((n, c) => n + c.report.survived, 0);

  let output: string;
  if (args.format === 'json') {
    output = JSON.stringify(
      {
        suite: args.suite,
        overallSurvived: totalSurvived,
        cases: cases.map((c) => ({ name: c.name, cassette: c.cassette, ...c.report })),
      },
      null,
      2,
    );
  } else {
    output = formatConsole(cases);
  }

  if (args.output) {
    await fs.writeFile(args.output, output, 'utf8');
    console.log(`[traceplay] mutation report written to ${args.output}`);
  } else {
    console.log(output);
  }

  // Non-zero exit when a mutation survives, so CI catches weak assertions.
  return args.strict === false || totalSurvived === 0 ? 0 : 1;
}
