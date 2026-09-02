import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startRecorder, type RecorderHandle } from '../src/recorder/proxy.js';
import { readCassette } from '../src/cassette/store.js';

/** Read recorded events, treating a never-created cassette as empty. */
async function recordedEvents(path: string) {
  try {
    await fs.access(path);
  } catch {
    return [];
  }
  const cassette = await readCassette(path);
  return cassette.events;
}

const handles: Array<{ close: () => Promise<void> } | http.Server> = [];
afterEach(async () => {
  for (const h of handles) {
    try {
      await h.close();
    } catch {
      // already closed
    }
  }
  handles.length = 0;
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

/** Upstream stub that always answers with a chat-completions JSON body. */
function upstream(): Promise<{ port: number; server: http.Server }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' } }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      handles.push(server);
      resolve({ port, server });
    });
  });
}

async function recorder(upstreamPort: number): Promise<{ handle: RecorderHandle; cassettePath: string }> {
  const port = await freePort();
  const cassettePath = join(tmpdir(), `tp-hard-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const handle = await startRecorder({
    port,
    upstream: `http://127.0.0.1:${upstreamPort}`,
    cassettePath,
    redact: true,
  });
  handles.push(handle);
  return { handle, cassettePath };
}

function send(
  port: number,
  body: string,
  contentType: string,
): Promise<{ status: number; skipped: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { 'content-type': contentType, 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            skipped: res.headers['x-traceplay-skipped'] as string | undefined,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('§6.11 non-JSON request bodies are observable, not silently dropped', () => {
  it('forwards a non-JSON body, flags it, and records no llm.request', async () => {
    const up = await upstream();
    const { handle, cassettePath } = await recorder(up.port);

    const res = await send(handle.port, 'this is definitely not json', 'text/plain');
    expect(res.status).toBe(200); // still forwarded transparently
    expect(res.skipped).toBe('non-json-body');
    expect(res.body).toContain('hi');

    await handle.close();
    const events = await recordedEvents(cassettePath);
    expect(events.some((e) => e.type === 'llm.request')).toBe(false);
  });

  it('records a normal JSON body and does not flag it', async () => {
    const up = await upstream();
    const { handle, cassettePath } = await recorder(up.port);

    const res = await send(
      handle.port,
      JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hello' }] }),
      'application/json',
    );
    expect(res.status).toBe(200);
    expect(res.skipped).toBeUndefined();

    await handle.close();
    const events = await recordedEvents(cassettePath);
    expect(events.some((e) => e.type === 'llm.request')).toBe(true);
  });
});

describe('§6.14 concurrent requests are persisted in seq order', () => {
  it('keeps llm.request seq and turn monotonic under a burst', async () => {
    const up = await upstream();
    const { handle, cassettePath } = await recorder(up.port);
    const N = 8;

    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        send(
          handle.port,
          JSON.stringify({ model: 'm', messages: [{ role: 'user', content: `burst-${i}` }] }),
          'application/json',
        ),
      ),
    );

    await handle.close(); // drains the ordered write queue before reading
    const cassette = await readCassette(cassettePath);
    const requests = cassette.events.filter((e) => e.type === 'llm.request');
    expect(requests).toHaveLength(N);

    const seqs = requests.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
    const turns = requests.map((e) => (e as { turn?: number }).turn);
    expect(turns).toEqual(Array.from({ length: N }, (_, i) => i));
  });
});
