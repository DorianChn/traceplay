import { readCassette } from '../cassette/store.js';
import { formatInspect } from '../report/inspect.js';

export interface InspectArgs {
  cassette: string;
}

/**
 * `traceplay inspect <cassette.jsonl>` — pretty-print a cassette: event
 * timeline, token usage, tool calls, errors.
 */
export async function runInspect(args: InspectArgs): Promise<number> {
  const cassette = await readCassette(args.cassette);
  console.log(formatInspect(cassette, args.cassette));
  return 0;
}
