import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { startReplayer, type ReplayerHandle } from '../src/replayer/server.js';
import { writeCassette } from '../src/cassette/store.js';
import { normalizeRequest } from '../src/cassette/normalize.js';
import type { LLMResponseEvent, TraceEvent } from '../src/types.js';

const handles: ReplayerHandle[] = [];
const AT = '2026-09-01T00:00:00.000Z';

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
  body: unknown,
): Promise<{ status: number; body: string; matchHeader?: string | string[] }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8'),
            matchHeader: res.headers['x-traceplay-match'],
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function responseFor(requestId: string, seq: number, text: string): LLMResponseEvent {
  const rawBody = JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] });
  return {
    id: `s-${requestId}`,
    seq,
    at: AT,
    type: 'llm.response',
    requestId,
    status: 200,
    output: JSON.parse(rawBody),
    rawBody,
  };
}

async function buildCassette(questions: string[]): Promise<string> {
  const events: TraceEvent[] = [];
  questions.forEach((q, i) => {
    const { event } = normalizeRequest(
      '/v1/chat/completions',
      JSON.stringify({ model: 'travel', messages: [{ role: 'user', content: q }] }),
      i * 2,
    );
    event.id = `r${i}`;
    events.push(event);
    events.push(responseFor(event.id, i * 2 + 1, `answer-${i}`));
  });
  const path = join(tmpdir(), `tp-replayer-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  await writeCassette(path, { recordedAt: AT, redacted: true }, events);
  return path;
}

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

describe('replayer HTTP — layered matching, ambiguity (409), diagnosis (404)', () => {
  it('returns 200 + x-traceplay-match header for exact and semantic hits', async () => {
    const cassette = await buildCassette(['book a flight to Paris tomorrow']);
    const port = await freePort();
    handles.push(await startReplayer({ port, cassettePath: cassette, fuzzy: true, stateful: false }));

    const exact = await post(port, {
      model: 'travel',
      messages: [{ role: 'user', content: 'book a flight to Paris tomorrow' }],
    });
    expect(exact.status).toBe(200);
    expect(exact.matchHeader).toBe('exact');
    expect(exact.body).toContain('answer-0');

    // L1: extra whitespace + random seed only -> semantic, still deterministic
    const semantic = await post(port, {
      model: 'travel',
      seed: 123,
      messages: [{ role: 'user', content: 'book  a flight to Paris   tomorrow' }],
    });
    expect(semantic.status).toBe(200);
    expect(semantic.matchHeader).toBe('semantic');
  });

  it('returns 409 Conflict on an ambiguous match instead of guessing', async () => {
    const cassette = await buildCassette([
      'book a flight to Paris tomorrow',
      'book a flight to Paris today',
    ]);
    const port = await freePort();
    handles.push(await startReplayer({ port, cassettePath: cassette, fuzzy: true, stateful: false }));

    const res = await post(port, {
      model: 'travel',
      messages: [{ role: 'user', content: 'book a flight to Paris next week' }],
    });
    expect(res.status).toBe(409);
    const payload = JSON.parse(res.body);
    expect(payload.error).toBe('ambiguous cassette match');
    expect(payload.runnerUpScore).toBeDefined();
    expect(payload.message).toMatch(/ambiguous/i);
  });

  it('returns 404 with a drift diagnosis for an unrelated request', async () => {
    const cassette = await buildCassette(['book a flight to Paris tomorrow']);
    const port = await freePort();
    handles.push(await startReplayer({ port, cassettePath: cassette, fuzzy: true, stateful: false }));

    const res = await post(port, {
      model: 'travel',
      messages: [{ role: 'user', content: 'explain quantum entanglement in detail' }],
    });
    expect(res.status).toBe(404);
    const payload = JSON.parse(res.body);
    expect(payload.error).toBe('no cassette match');
    expect(payload.message).toContain('incoming last-user message');
  });
});
