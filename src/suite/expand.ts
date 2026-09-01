import { describeRow, renderValue } from '../core/template.js';
import type { Assertion, TestCase } from '../types.js';

export interface ExpandedRun {
  name: string;
  assertions: Assertion[];
}

/**
 * Expand a suite case into one concrete run per parametrized row (v0.7).
 * A case without `each` yields a single run unchanged. Shared by `test` and
 * `mutate` so parametrized templates behave identically in both commands.
 */
export function expandCase(testCase: TestCase): ExpandedRun[] {
  const rows = Array.isArray(testCase.each) ? testCase.each : [{}];
  return rows.map((row, index) => {
    const assertions = testCase.assertions.map((a) => renderValue(a, row ?? {}));
    if (!Array.isArray(testCase.each)) return { name: testCase.name, assertions };
    return {
      name: `${testCase.name} #${index + 1}${describeRow(row ?? {})}`,
      assertions,
    };
  });
}
