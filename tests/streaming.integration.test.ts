import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { startRecorder, type RecorderHandle } from '../src/recorder/proxy.js';
import { startReplayer, type ReplayerHandle } from '../src/replayer/server.js';
import { readCassette } from '../src/cassette/store.js';
import { extractStreamContent } from '../src/cassette/stream.js';

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

function postJson(port: number, path: string, body: unknown): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, contentType: res.headers['content-type'] || '', body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const STREAM_RESPONSE = [
  'data: {"id":"chatcmpl-s","object":"chat.completion.chunk","created":1,"model":"gpt-mock","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-s","object":"chat.completion.chunk","created":1,"model":"gpt-mock","choices":[{"index":0,"delta":{"content":" streaming"},"finish_reason":null}]}',
  '',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  '',
  'data: {"usage":{"prompt_tokens":9,"completion_tokens":4}}',
  '',
  'data: [DONE]',
  '',
].join('\n');

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

describe('integration: streaming record -> replay', () => {
  it('records an SSE stream and replays it as SSE offline', async () => {
    const upstreamPort = await getFreePort();
    const recorderPort = await getFreePort();
    const replayerPort = await getFreePort();
    const cassettePath = join(tmpdir(), `tp-stream-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);

    const upstream = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.end(STREAM_RESPONSE);
    });
    await new Promise<void>((resolve) => upstream.listen(upstreamPort, resolve));
    handles.push(upstream);

    const recorder = await startRecorder({ port: recorderPort, upstream: `http://localhost:${upstreamPort}`, cassettePath, redact: true });
    handles.push(recorder);

    const requestBody = { model: 'gpt-mock', stream: true, messages: [{ role: 'user', content: 'say hello' }] };
    const recorded = await postJson(recorderPort, '/v1/chat/completions', requestBody);
    expect(recorded.status).toBe(200);
    expect(recorded.contentType).toContain('text/event-stream');
    expect(extractStreamContent(recorded.body)).toBe('Hello streaming');

    const cassette = await readCassette(cassettePath);
    const reqEvent = cassette.events.find((e) => e.type === 'llm.request');
    expect((reqEvent as { stream?: boolean }).stream).toBe(true);
    const resEvent = cassette.events.find((e) => e.type === 'llm.response');
    expect((resEvent as { stream?: boolean }).stream).toBe(true);
    expect((resEvent as { usage?: { promptTokens: number } }).usage?.promptTokens).toBe(9);
    expect(((resEvent as { output: { content: string } }).output).content).toBe('Hello streaming');

    await recorder.close();

    const replayer = await startReplayer({ port: replayerPort, cassettePath });
    handles.push(replayer);

    const replayed = await postJson(replayerPort, '/v1/chat/completions', requestBody);
    expect(replayed.status).toBe(200);
    expect(replayed.contentType).toContain('text/event-stream');
    expect(extractStreamContent(replayed.body)).toBe('Hello streaming');

    await fs.unlink(cassettePath).catch(() => undefined);
  }, 15000);
});
