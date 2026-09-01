import { startRecorder } from '../recorder/proxy.js';

export interface RecordArgs {
  port?: number;
  upstream?: string;
  out?: string;
  project?: string;
  noRedact?: boolean;
  noTools?: boolean;
}

export async function runRecord(args: RecordArgs): Promise<number> {
  const port = args.port ?? 8123;
  const upstream = args.upstream ?? 'https://api.openai.com/v1';
  const out = args.out ?? 'cassette.jsonl';

  const handle = await startRecorder({
    port,
    upstream,
    cassettePath: out,
    redact: !args.noRedact,
    project: args.project,
    recordTools: !args.noTools,
  });

  console.log(`[traceplay] recording on http://localhost:${handle.port} -> ${out}`);
  console.log(`[traceplay] upstream: ${upstream}`);
  console.log('[traceplay] point your agent BASE_URL here. Ctrl+C to stop.');
  if (!args.noTools) {
    console.log(
      '[traceplay] tool reporting enabled: POST /__traceplay/tool.call | /__traceplay/tool.result (use --no-tools to disable)',
    );
  }

  return await new Promise<number>((resolve) => {
    const shutdown = async () => {
      await handle.close();
      resolve(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
