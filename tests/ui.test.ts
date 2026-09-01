import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { startUI, type UIHandle } from '../src/ui/server.js';
import { writeCassette } from '../src/cassette/store.js';
import type { TraceEvent } from '../src/types.js';

let handle: UIHandle | null = null;

function get(port: number, path: string): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode || 0, contentType: res.headers['content-type'] || '', body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

afterEach(async () => {
  if (handle) {
    await handle.close().catch(() => undefined);
    handle = null;
  }
});

describe('ui/server', () => {
  it('serves the explorer page and cassette JSON API', async () => {
    const dir = join(tmpdir(), `tp-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
    const events: TraceEvent[] = [
      { id: 'u1', seq: 0, at: '2026-09-01T00:00:00.000Z', type: 'user.message', content: 'hi' },
      { id: 'r1', seq: 1, at: '2026-09-01T00:00:00.000Z', type: 'llm.request', provider: 'openai-compatible', model: 'm', messages: [], requestHash: 'abc' },
      { id: 's1', seq: 2, at: '2026-09-01T00:00:00.000Z', type: 'llm.response', requestId: 'r1', status: 200, output: {}, usage: { promptTokens: 5, completionTokens: 3 } },
    ];
    await writeCassette(join(dir, 'demo.jsonl'), { recordedAt: '2026-09-01T00:00:00.000Z', redacted: true, project: 'demo' }, events);

    handle = await startUI({ port: 0, cassettesDir: dir });
    const port = handle.port;

    const page = await get(port, '/');
    expect(page.status).toBe(200);
    expect(page.contentType).toContain('text/html');
    expect(page.body).toContain('traceplay');
    expect(page.body).toContain('cassette explorer');

    const list = await get(port, '/api/cassettes');
    expect(list.status).toBe(200);
    const parsed = JSON.parse(list.body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('demo.jsonl');
    expect(parsed[0].eventCount).toBe(3);

    const single = await get(port, '/api/cassettes/demo.jsonl');
    const cassette = JSON.parse(single.body);
    expect(cassette.events).toHaveLength(3);
    expect(cassette.events[0].type).toBe('user.message');

    const missing = await get(port, '/api/cassettes/nope.jsonl');
    expect(missing.status).toBe(404);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
