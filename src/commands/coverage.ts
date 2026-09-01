import { computeCoverage, formatCoverage } from '../report/coverage.js';

export interface CoverageArgs {
  suite: string;
}

/**
 * `traceplay coverage <suite.yaml>` — report assertion-kind usage and which
 * trace event types are (or aren't) exercised by the suite.
 */
export async function runCoverage(args: CoverageArgs): Promise<number> {
  const report = await computeCoverage(args.suite);
  console.log(formatCoverage(report));
  return 0;
}
