import type { Assertion, TraceEvent } from '../types.js';
import { runAssertions } from '../assert/engine.js';
import { MUTATORS, mutatorsFor, type MutationKind } from './mutators.js';

export type MutationStatus = 'killed' | 'survived' | 'no-mutator' | 'baseline-failed' | 'todo';

export interface MutationResult {
  /** Index of the assertion in the original suite. */
  assertionIndex: number;
  assertion: Assertion;
  mutator: MutationKind | null;
  status: MutationStatus;
  /** Baseline result message / mutated result message, for the report. */
  detail: string;
}

export interface MutationReport {
  total: number;
  killed: number;
  survived: number;
  /** baseline-failed + no-mutator + todo: not counted in the score. */
  skipped: number;
  /** killed / (killed + survived), 0..1. The share of injected bugs caught. */
  mutationScore: number;
  results: MutationResult[];
}

export interface MutatorInfo {
  kind: MutationKind;
  description: string;
  targets: Assertion['kind'][];
}

export function listMutators(): MutatorInfo[] {
  return MUTATORS.map((m) => ({ kind: m.kind, description: m.description, targets: m.targets }));
}

/**
 * Mutation testing (R7): prove assertions actually catch regressions.
 *
 * For every assertion that passes on the real cassette (the baseline), inject
 * each applicable mutation and re-run just that assertion:
 *   - it flips to FAIL  → "killed": the assertion is effective;
 *   - it still PASSES   → "survived": the assertion has a hole (it would let a
 *     real regression through);
 *   - todo / no mutator / failing baseline → skipped (not scored).
 */
export async function runMutationTesting(
  events: TraceEvent[],
  assertions: Assertion[],
): Promise<MutationReport> {
  // runAssertions preserves assertion order, so baseline[i] maps to assertions[i].
  const baseline = await runAssertions(events, assertions);
  const results: MutationResult[] = [];

  for (let i = 0; i < assertions.length; i++) {
    const assertion = assertions[i];
    const base = baseline[i];

    if (!base || base.status === 'fail') {
      results.push({
        assertionIndex: i,
        assertion,
        mutator: null,
        status: 'baseline-failed',
        detail: base?.message ?? 'assertion did not pass on the baseline cassette',
      });
      continue;
    }
    if (base.status === 'todo') {
      results.push({
        assertionIndex: i,
        assertion,
        mutator: null,
        status: 'todo',
        detail: base.message,
      });
      continue;
    }

    const mutators = mutatorsFor(assertion.kind);
    if (mutators.length === 0) {
      results.push({
        assertionIndex: i,
        assertion,
        mutator: null,
        status: 'no-mutator',
        detail: `no mutation operator targets "${assertion.kind}"`,
      });
      continue;
    }

    for (const mutator of mutators) {
      const mutated = mutator.apply(events, assertion);
      if (mutated === null) {
        results.push({
          assertionIndex: i,
          assertion,
          mutator: mutator.kind,
          status: 'no-mutator',
          detail: 'cassette has no applicable target for this mutation',
        });
        continue;
      }
      const after = await runAssertions(mutated, [assertion]);
      const r = after[0];
      if (!r) continue;
      const killed = r.status === 'fail';
      results.push({
        assertionIndex: i,
        assertion,
        mutator: mutator.kind,
        status: killed ? 'killed' : r.status === 'todo' ? 'todo' : 'survived',
        detail: r.message,
      });
    }
  }

  const killed = results.filter((r) => r.status === 'killed').length;
  const survived = results.filter((r) => r.status === 'survived').length;
  const skipped = results.length - killed - survived;
  const scored = killed + survived;
  return {
    total: results.length,
    killed,
    survived,
    skipped,
    mutationScore: scored === 0 ? 1 : killed / scored,
    results,
  };
}

const ICON: Record<MutationStatus, string> = {
  killed: 'KILLED',
  survived: 'SURVIVED',
  'no-mutator': 'skip',
  'baseline-failed': 'base-fail',
  todo: 'todo',
};

export function formatMutationReport(report: MutationReport): string {
  const lines: string[] = [];
  lines.push('traceplay mutate — mutation testing report');
  lines.push('');
  for (const r of report.results) {
    const icon = ICON[r.status];
    const mut = r.mutator ? ` [${r.mutator}]` : '';
    lines.push(`  ${icon.padEnd(9)} ${r.assertion.kind}${mut} — ${r.detail}`);
  }
  lines.push('');
  lines.push(
    `Mutation score: ${(report.mutationScore * 100).toFixed(0)}%  ` +
      `(${report.killed} killed, ${report.survived} survived, ${report.skipped} skipped)`,
  );
  if (report.survived > 0) {
    lines.push('');
    lines.push('SURVIVED mutations mark weak assertions — strengthen them so injected bugs are caught.');
  }
  return lines.join('\n');
}
