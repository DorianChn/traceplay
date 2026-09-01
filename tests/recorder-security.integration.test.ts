import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startRecorder, type RecorderHandle } from '../src/recorder/proxy.js';

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

function post(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function recorder(token?: string): Promise<RecorderHandle> {
  const port = await freePort();
  const cassettePath = join(tmpdir(), `tp-sec-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const handle = await startRecorder({ port, cassettePath, redact: true, ...(token ? { token } : {}) });
  handles.push(handle);
  return handle;
}

describe('R12 recorder hardening', () => {
  it('binds to loopback (127.0.0.1) by default', async () => {
    const handle = await recorder();
    expect(handle.host).toBe('127.0.0.1');
  });

  it('rejects an orphan tool.result with no matching tool.call (400)', async () => {
    const port = (await recorder()).port;
    const res = await post(port, '/__traceplay/tool.result', { callId: 'never-reported', output: 'x' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/no matching tool\.call/i);
  });

  it('rejects a tool.result missing callId (400)', async () => {
    const port = (await recorder()).port;
    const res = await post(port, '/__traceplay/tool.result', { output: 'x' });
    expect(res.status).toBe(400);
  });

  it('requires the management token once configured', async () => {
    const port = (await recorder('s3cret')).port;

    const noAuth = await post(port, '/__traceplay/tool.call', { name: 't', arguments: {} });
    expect(noAuth.status).toBe(401);

    const wrong = await post(port, '/__traceplay/tool.call', { name: 't', arguments: {} }, {
      authorization: 'Bearer nope',
    });
    expect(wrong.status).toBe(401);

    const bearer = await post(port, '/__traceplay/tool.call', { name: 't', arguments: {} }, {
      authorization: 'Bearer s3cret',
    });
    expect(bearer.status).toBe(200);
    const { callId } = JSON.parse(bearer.body);
    expect(callId).toBeTruthy();

    // custom header also accepted, and the registered callId links a result
    const call2 = await post(port, '/__traceplay/tool.call', { name: 'u', arguments: {} }, {
      'x-traceplay-token': 's3cret',
    });
    expect(call2.status).toBe(200);
    const result = await post(
      port,
      '/__traceplay/tool.result',
      { callId: JSON.parse(call2.body).callId, output: 'ok' },
      { 'x-traceplay-token': 's3cret' },
    );
    expect(result.status).toBe(200);
  });
});
