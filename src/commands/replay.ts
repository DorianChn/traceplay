import { startReplayer } from '../replayer/server.js';

export interface ReplayArgs {
  cassette: string;
  port?: number;
  fuzzy?: boolean;
  fuzzyThreshold?: number;
}

export async function runReplay(args: ReplayArgs): Promise<number> {
  const port = args.port ?? 8124;
  const handle = await startReplayer({
    port,
    cassettePath: args.cassette,
    fuzzy: args.fuzzy,
    fuzzyThreshold: args.fuzzyThreshold,
  });

  console.log(`[traceplay] replaying from ${args.cassette} on http://localhost:${handle.port}`);
  console.log(
    args.fuzzy
      ? `[traceplay] fuzzy matching enabled (threshold ${args.fuzzyThreshold ?? 0.6})`
      : '[traceplay] exact matching (use --fuzzy for approximate matching)',
  );
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
