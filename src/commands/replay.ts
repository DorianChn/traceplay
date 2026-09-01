import { startReplayer } from '../replayer/server.js';

export interface ReplayArgs {
  cassette: string;
  port?: number;
}

export async function runReplay(args: ReplayArgs): Promise<number> {
  const port = args.port ?? 8124;
  const handle = await startReplayer({ port, cassettePath: args.cassette });

  console.log(`[traceplay] replaying from ${args.cassette} on http://localhost:${handle.port}`);
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
