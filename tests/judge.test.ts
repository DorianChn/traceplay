import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { judgeAnswer } from '../src/assert/judge.js';

const servers: http.Server[] = [];

function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  for (const s of [...servers]) {
    await closeServer(s).catch(() => undefined);
  }
  servers.length = 0;
});

describe('assert/judge caching', () => {
  it('calls the judge once, then serves subsequent calls from disk cache', async () => {
    const port = await getFreePort();
    let calls = 0;
    const server = http.createServer((req, res) => {
      calls++;
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ passed: true, reason: 'looks good' }) } }],
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    servers.push(server);

    const cacheDir = join(tmpdir(), `tp-judge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const opts = {
      apiKey: 'test-key',
      apiBase: `http://127.0.0.1:${port}/v1`,
      cacheDir,
      model: 'gpt-4o-mini',
    };

    const first = await judgeAnswer('The weather is sunny', 'mentions weather', opts);
    expect(first.status).toBe('ok');
    expect(first.passed).toBe(true);
    expect(calls).toBe(1);

    // A different rubric must NOT reuse the cache entry (cache key includes rubric).
    const other = await judgeAnswer('The weather is sunny', 'mentions rain', opts);
    expect(other.status).toBe('ok');
    expect(calls).toBe(2);

    // Stop the server, then call again with the first inputs: the disk cache
    // must answer without any network access.
    await closeServer(server);
    servers.splice(servers.indexOf(server), 1);

    const second = await judgeAnswer('The weather is sunny', 'mentions weather', opts);
    expect(second.status).toBe('ok');
    expect(second.passed).toBe(true);
    expect(calls).toBe(2); // unchanged — cache hit, no new network call

    await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns todo (not a crash) when the judge call fails', async () => {
    const port = await getFreePort(); // an unused port — connection refused
    const result = await judgeAnswer('x', 'y', {
      apiKey: 'k',
      apiBase: `http://127.0.0.1:${port}/v1`,
      cacheDir: join(tmpdir(), `tp-judge-fail-${Date.now()}`),
    });
    expect(result.status).toBe('todo');
    expect(result.message).toContain('skipped');
  });
});
