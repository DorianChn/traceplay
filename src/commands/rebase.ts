import { readCassette, writeCassette } from '../cassette/store.js';
import { rebaseCassettes } from '../cassette/rebase.js';

export interface RebaseArgs {
  base: string;
  head: string;
  output?: string;
  /** Conflict resolution: 'theirs' (default, head wins) or 'ours' (base wins). */
  strategy?: 'theirs' | 'ours';
  /** Print JSON summary instead of human text. */
  json?: boolean;
}

/**
 * `traceplay rebase <base.jsonl> <head.jsonl> [--output merged.jsonl]
 *  [--strategy theirs|ours] [--json]`
 *
 * Merge a freshly recorded (possibly partial) cassette onto an existing one.
 */
export async function runRebase(args: RebaseArgs): Promise<number> {
  const [base, head] = await Promise.all([readCassette(args.base), readCassette(args.head)]);

  const prefer = args.strategy === 'ours' ? 'base' : 'head';
  const result = rebaseCassettes(base, head, { prefer });

  const output = args.output || 'merged.jsonl';
  await writeCassette(output, result.cassette.meta, result.cassette.events);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          output,
          summary: result.summary,
          updates: result.updates,
          events: result.cassette.events.length,
        },
        null,
        2,
      ),
    );
  } else {
    const s = result.summary;
    console.log(`rebase → ${output}`);
    console.log(`  events:    ${result.cassette.events.length}`);
    console.log(`  unchanged: ${s.unchanged}`);
    console.log(`  updated:   ${s.updated}${s.updated > 0 ? ` (response changed, ${prefer} wins)` : ''}`);
    console.log(`  added:     ${s.added}`);
    console.log(`  retained:  ${s.retained} (from base, not re-recorded)`);
    if (result.updates.length > 0) {
      console.log('');
      console.log('updated segments:');
      for (const u of result.updates) {
        console.log(`  [${u.fingerprint}]`);
        console.log(`    base: ${u.basePreview}`);
        console.log(`    head: ${u.headPreview}`);
      }
    }
  }

  return 0;
}
