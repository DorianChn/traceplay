import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { startRecorder, type RecorderHandle } from '../src/recorder/proxy.js';
import { startReplayer, type ReplayerHandle } from '../src/replayer/server.js';
import { readCassette } from '../src/cassette/store.js';

const handles: Array<{ close: () => Promise<void> } | http.Server> = [];

function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

function postJson(port: number, path: string, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          authorization: 'Bearer secret-key-should-be-redacted',
        },
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

const MOCK_RESPONSE = JSON.stringify({
  id: 'chatcmpl-mock',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from mock upstream!' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
});

afterEach(async () => {
  for (const h of handles) {
    try {
      if ('close' in h && typeof (h as RecorderHandle).close === 'function') {
        await (h as RecorderHandle).close();
      } else {
        (h as http.Server).close();
      }
    } catch {
      // already closed
    }
  }
  handles.length = 0;
});

describe('integration: record -> cassette -> replay', () => {
  it('records a request through the proxy and replays it offline', async () => {
    const upstreamPort = await getFreePort();
    const recorderPort = await getFreePort();
    const replayerPort = await getFreePort();
    const cassettePath = join(tmpdir(), `tp-int-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);

    // 1. Start mock upstream
    const upstream = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(MOCK_RESPONSE);
    });
    await new Promise<void>((resolve) => upstream.listen(upstreamPort, resolve));
    handles.push(upstream);

    // 2. Start recorder
    const recorder = await startRecorder({
      port: recorderPort,
      upstream: `http://localhost:${upstreamPort}`,
      cassettePath,
      redact: true,
    });
    handles.push(recorder);

    // 3. Make request through recorder
    const requestBody = { model: 'gpt-mock', messages: [{ role: 'user', content: 'hello' }] };
    const recorded = await postJson(recorderPort, '/v1/chat/completions', requestBody);
    expect(recorded.status).toBe(200);
    expect(recorded.body).toBe(MOCK_RESPONSE);

    // 4. Verify cassette was written with correct events
    const cassette = await readCassette(cassettePath);
    expect(cassette.events.length).toBeGreaterThanOrEqual(2);
    const reqEvent = cassette.events.find((e) => e.type === 'llm.request');
    expect(reqEvent).toBeDefined();
    expect(reqEvent!.type).toBe('llm.request');
    const resEvent = cassette.events.find((e) => e.type === 'llm.response');
    expect(resEvent).toBeDefined();
    expect((resEvent as { status: number }).status).toBe(200);
    expect((resEvent as { usage?: { promptTokens: number } }).usage?.promptTokens).toBe(15);

    // 5. Close recorder, start replayer from cassette
    await recorder.close();
    const replayer = await startReplayer({ port: replayerPort, cassettePath });
    handles.push(replayer);

    // 6. Make same request to replayer (offline — upstream is still running but replayer shouldn't call it)
    const replayed = await postJson(replayerPort, '/v1/chat/completions', requestBody);
    expect(replayed.status).toBe(200);
    expect(replayed.body).toBe(MOCK_RESPONSE);

    // 7. Different request should 404
    const miss = await postJson(replayerPort, '/v1/chat/completions', { model: 'other', messages: [{ role: 'user', content: 'different' }] });
    expect(miss.status).toBe(404);

    // cleanup cassette
    await fs.unlink(cassettePath).catch(() => undefined);
  }, 15000);

  it('preserves non-200 upstream status codes through record and replay', async () => {
    const upstreamPort = await getFreePort();
    const recorderPort = await getFreePort();
    const replayerPort = await getFreePort();
    const cassettePath = join(tmpdir(), `tp-int-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);

    // 1. Mock upstream that rejects with 401
    const upstream = http.createServer((req, res) => {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'invalid_request_error' } }));
    });
    await new Promise<void>((resolve) => upstream.listen(upstreamPort, resolve));
    handles.push(upstream);

    // 2. Record through the proxy — the 401 must NOT be rewritten to 200
    const recorder = await startRecorder({
      port: recorderPort,
      upstream: `http://localhost:${upstreamPort}`,
      cassettePath,
      redact: true,
    });
    handles.push(recorder);

    const requestBody = { model: 'gpt-mock', messages: [{ role: 'user', content: 'hi' }] };
    const recorded = await postJson(recorderPort, '/v1/chat/completions', requestBody);
    expect(recorded.status).toBe(401);

    // 3. The cassette must record the real status
    const cassette = await readCassette(cassettePath);
    const resEvent = cassette.events.find((e) => e.type === 'llm.response');
    expect((resEvent as { status: number }).status).toBe(401);

    // 4. Replay must also return 401
    await recorder.close();
    const replayer = await startReplayer({ port: replayerPort, cassettePath });
    handles.push(replayer);
    const replayed = await postJson(replayerPort, '/v1/chat/completions', requestBody);
    expect(replayed.status).toBe(401);

    await fs.unlink(cassettePath).catch(() => undefined);
  }, 15000);

  it('decompresses gzip-encoded upstream responses before recording', async () => {
    const upstreamPort = await getFreePort();
    const recorderPort = await getFreePort();
    const replayerPort = await getFreePort();
    const cassettePath = join(tmpdir(), `tp-gz-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);

    const upstream = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.setHeader('content-encoding', 'gzip');
      res.end(gzipSync(Buffer.from(MOCK_RESPONSE, 'utf8')));
    });
    await new Promise<void>((resolve) => upstream.listen(upstreamPort, resolve));
    handles.push(upstream);

    const recorder = await startRecorder({
      port: recorderPort,
      upstream: `http://localhost:${upstreamPort}`,
      cassettePath,
      redact: true,
    });
    handles.push(recorder);

    const body = { model: 'gpt-mock', messages: [{ role: 'user', content: 'gzip test' }] };
    const recorded = await postJson(recorderPort, '/v1/chat/completions', body);
    expect(recorded.status).toBe(200);
    // The client must receive plain text, not gzip bytes.
    expect(recorded.body).toBe(MOCK_RESPONSE);

    // The cassette must store the decompressed plain text and drop the encoding header.
    const cassette = await readCassette(cassettePath);
    const resEvent = cassette.events.find((e) => e.type === 'llm.response') as {
      rawBody?: string;
      headers?: Record<string, string>;
    };
    expect(resEvent.rawBody).toBe(MOCK_RESPONSE);
    expect(resEvent.headers?.['content-encoding']).toBeUndefined();

    // Replay must also serve plain text.
    await recorder.close();
    const replayer = await startReplayer({ port: replayerPort, cassettePath });
    handles.push(replayer);
    const replayed = await postJson(replayerPort, '/v1/chat/completions', body);
    expect(replayed.status).toBe(200);
    expect(replayed.body).toBe(MOCK_RESPONSE);

    await fs.unlink(cassettePath).catch(() => undefined);
  }, 15000);
});
