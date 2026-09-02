import { startReplayer } from '../replayer/server.js';
import {
  DEFAULT_AMBIGUITY_GAP,
  DEFAULT_FUZZY_THRESHOLD,
  DEFAULT_STRUCTURED_THRESHOLD,
} from '../replayer/matcher.js';

export interface ReplayArgs {
  cassette: string;
  port?: number;
  fuzzy?: boolean;
  fuzzyThreshold?: number;
  structuredThreshold?: number;
  ambiguityGap?: number;
  /** Default false → ordered R4 replay; set true for the v0.5 global scan. */
  stateless?: boolean;
}

export async function runReplay(args: ReplayArgs): Promise<number> {
  const port = args.port ?? 8124;
  const handle = await startReplayer({
    port,
    cassettePath: args.cassette,
    fuzzy: args.fuzzy,
    fuzzyThreshold: args.fuzzyThreshold,
    structuredThreshold: args.structuredThreshold,
    ambiguityGap: args.ambiguityGap,
    stateful: !args.stateless,
  });

  console.log(`[traceplay] replaying from ${args.cassette} on http://localhost:${handle.port}`);
  console.log(
    args.stateless
      ? '[traceplay] stateless global-scan matching (v0.5 behavior)'
      : '[traceplay] stateful ordered replay: repeated prompts replay in recorded sequence (R4)',
  );
  if (args.fuzzy) {
    console.log(
      `[traceplay] layered matching: exact → semantic → structured (≥ ${
        args.structuredThreshold ?? DEFAULT_STRUCTURED_THRESHOLD
      }) → fuzzy (≥ ${args.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD}); ambiguity gap ${
        args.ambiguityGap ?? DEFAULT_AMBIGUITY_GAP
      }`,
    );
  } else {
    console.log(
      '[traceplay] deterministic matching: exact → semantic (use --fuzzy to enable L2/L3 similarity)',
    );
  }
  console.log('[traceplay] offline — no API calls will be made. Ctrl+C to stop.');

  return await new Promise<number>((resolve) => {
    const shutdown = async () => {
      await handle.close();
      resolve(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
