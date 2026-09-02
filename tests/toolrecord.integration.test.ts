import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { startRecorder, type RecorderHandle } from '../src/recorder/proxy.js';
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

function post(port: number, path: string, body: unknown): Promise<{ status: number; body: string }> {
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
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

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

describe('integration: tool reporting endpoints', () => {
  it('records tool.call and tool.result posted to the proxy', async () => {
    const upstreamPort = await getFreePort();
    const recorderPort = await getFreePort();
    const cassettePath = join(tmpdir(), `tp-tool-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);

    const upstream = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
    await new Promise<void>((resolve) => upstream.listen(upstreamPort, resolve));
    handles.push(upstream);

    const recorder = await startRecorder({ port: recorderPort, upstream: `http://localhost:${upstreamPort}`, cassettePath, redact: true });
    handles.push(recorder);

    // report a tool call + result: the server assigns/echoes callId, and the
    // result must reference that registered callId (R12 orphan rejection).
    const callRes = await post(recorderPort, '/__traceplay/tool.call', { name: 'get_weather', arguments: { city: 'Xiamen' } });
    expect(callRes.status).toBe(200);
    const { callId } = JSON.parse(callRes.body) as { callId: string };
    expect(callId).toBeTruthy();
    expect((await post(recorderPort, '/__traceplay/tool.result', { callId, output: 'sunny', isError: false })).status).toBe(200);

    // also make a normal LLM call so the header gets written
    await post(recorderPort, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'hi' }] });

    const cassette = await readCassette(cassettePath);
    const toolCall = cassette.events.find((e) => e.type === 'tool.call');
    const toolResult = cassette.events.find((e) => e.type === 'tool.result');
    expect(toolCall).toBeDefined();
    expect((toolCall as { name: string }).name).toBe('get_weather');
    expect((toolCall as { arguments: unknown }).arguments).toEqual({ city: 'Xiamen' });
    expect(toolResult).toBeDefined();
    expect((toolResult as { output: string }).output).toBe('sunny');

    await fs.unlink(cassettePath).catch(() => undefined);
  }, 15000);

  it('redacts secret-shaped fields inside tool arguments before persisting', async () => {
    const upstreamPort = await getFreePort();
    const recorderPort = await getFreePort();
    const cassettePath = join(tmpdir(), `tp-toolredact-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);

    const upstream = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
    await new Promise<void>((resolve) => upstream.listen(upstreamPort, resolve));
    handles.push(upstream);

    const recorder = await startRecorder({ port: recorderPort, upstream: `http://localhost:${upstreamPort}`, cassettePath, redact: true });
    handles.push(recorder);

    await post(recorderPort, '/__traceplay/tool.call', {
      name: 'create_ticket',
      arguments: { title: 'bug', api_key: 'sk-TOOL-SECRET', nested: { password: 'pw' } },
    });
    await post(recorderPort, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'hi' }] });

    const cassette = await readCassette(cassettePath);
    const persisted = JSON.stringify(cassette.events);
    expect(persisted).not.toContain('sk-TOOL-SECRET');
    const toolCall = cassette.events.find((e) => e.type === 'tool.call') as
      | { arguments: Record<string, unknown> }
      | undefined;
    expect(toolCall?.arguments.api_key).toBe('[REDACTED]');
    expect((toolCall?.arguments.nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect(toolCall?.arguments.title).toBe('bug');

    await fs.unlink(cassettePath).catch(() => undefined);
  }, 15000);
});
