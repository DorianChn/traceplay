import { readCassette } from '../cassette/store.js';
import { compareCassettes, formatDiff } from '../report/diff.js';

export interface DiffArgs {
  a: string;
  b: string;
}

/**
 * `traceplay diff <a.jsonl> <b.jsonl>` — compare two cassettes and report
 * behavioral differences (added/removed requests, changed responses,
 * changed tool calls).
 */
export async function runDiff(args: DiffArgs): Promise<number> {
  const [a, b] = await Promise.all([readCassette(args.a), readCassette(args.b)]);
  const report = compareCassettes(a, b);
  console.log(formatDiff(report, args.a, args.b));
  return 0;
}
