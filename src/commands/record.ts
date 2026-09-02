import { startRecorder } from '../recorder/proxy.js';

export interface RecordArgs {
  port?: number;
  upstream?: string;
  out?: string;
  project?: string;
  noRedact?: boolean;
  noTools?: boolean;
  host?: string;
  token?: string;
}

export async function runRecord(args: RecordArgs): Promise<number> {
  const port = args.port ?? 8123;
  const upstream = args.upstream ?? 'https://api.openai.com/v1';
  const out = args.out ?? 'cassette.jsonl';
  const host = args.host ?? '127.0.0.1';

  const handle = await startRecorder({
    port,
    upstream,
    cassettePath: out,
    redact: !args.noRedact,
    project: args.project,
    recordTools: !args.noTools,
    host,
    token: args.token,
  });

  console.log(`[traceplay] recording on http://${host}:${handle.port} -> ${out}`);
  console.log(`[traceplay] upstream: ${upstream}`);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.log(`[traceplay] WARNING: bound to ${host} — reachable beyond loopback; prefer 127.0.0.1.`);
  }
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
