import { startUI } from '../ui/server.js';

export interface UIArgs {
  cassettes: string;
  port?: number;
}

/**
 * `traceplay ui --cassettes <dir> [--port <p>]` — launch the local web
 * dashboard for browsing recorded cassettes.
 */
export async function runUI(args: UIArgs): Promise<number> {
  const port = args.port ?? 8130;
  const handle = await startUI({ port, cassettesDir: args.cassettes });
  console.log(`[traceplay] dashboard: http://localhost:${handle.port}`);
  console.log(`[traceplay] watching cassettes in ${args.cassettes} (Ctrl+C to stop)`);
  return await new Promise<number>((resolve) => {
    const shutdown = async () => {
      await handle.close();
      resolve(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
