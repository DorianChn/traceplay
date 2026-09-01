import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeCassette, readCassette, serializeHeader } from '../src/cassette/store.js';
import { normalizeRequest, normalizeResponse, detectProvider, nextId, resetCounter } from '../src/cassette/normalize.js';
import type { TraceEvent } from '../src/types.js';

const now = '2026-09-01T00:00:00.000Z';

function sampleEvents(): TraceEvent[] {
  return [
    { id: 'e1', seq: 0, at: now, type: 'user.message', content: 'hi' },
    { id: 'e2', seq: 1, at: now, type: 'llm.request', provider: 'openai-compatible', model: 'demo', messages: [], requestHash: 'abc' },
    { id: 'e3', seq: 2, at: now, type: 'llm.response', requestId: 'e2', status: 200, output: { choices: [{ message: { content: 'ok' } }] }, usage: { promptTokens: 10, completionTokens: 5 } },
  ];
}

describe('cassette/store', () => {
  it('round-trips header + events', async () => {
    const path = join(tmpdir(), `tp-store-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    const events = sampleEvents();
    await writeCassette(path, { recordedAt: now, redacted: true }, events);
    const cassette = await readCassette(path);
    expect(cassette.events).toHaveLength(3);
    expect(cassette.meta.redacted).toBe(true);
    expect(cassette.events[1].type).toBe('llm.request');
  });

  it('rejects non-traceplay cassettes', async () => {
    const path = join(tmpdir(), `tp-bad-${Date.now()}.jsonl`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, '{"cassette":"other","version":1}\n', 'utf8');
    await expect(readCassette(path)).rejects.toThrow(/not a traceplay cassette/i);
  });

  it('serializeHeader includes marker', () => {
    const header = serializeHeader({ recordedAt: now, redacted: true });
    expect(header).toContain('"cassette":"traceplay"');
  });
});

describe('cassette/normalize', () => {
  it('detects openai-compatible provider', () => {
    expect(detectProvider('/v1/chat/completions')).toBe('openai-compatible');
    expect(detectProvider('/v1/messages')).toBe('anthropic');
    expect(detectProvider('/other')).toBe('other');
  });

  it('normalizes openai chat request', () => {
    resetCounter();
    const body = JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], temperature: 0.5 });
    const result = normalizeRequest('/v1/chat/completions', body, 0);
    expect(result).not.toBeNull();
    expect(result!.event.provider).toBe('openai-compatible');
    expect(result!.event.model).toBe('gpt-4o');
    expect(result!.event.messages).toHaveLength(1);
    expect(result!.event.temperature).toBe(0.5);
    expect(result!.event.requestHash).toHaveLength(64);
  });

  it('normalizes anthropic request with system prompt', () => {
    resetCounter();
    const body = JSON.stringify({ model: 'claude-3-5', system: 'you are helpful', messages: [{ role: 'user', content: 'hi' }] });
    const result = normalizeRequest('/v1/messages', body, 0);
    expect(result).not.toBeNull();
    expect(result!.event.provider).toBe('anthropic');
    expect(result!.event.messages).toHaveLength(2);
    expect((result!.event.messages[0] as Record<string, string>).role).toBe('system');
  });

  it('normalizes openai response with usage', () => {
    resetCounter();
    const reqId = nextId('req');
    const body = JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    const result = normalizeResponse(reqId, 200, body, 'openai-compatible', 1, 50);
    expect(result.event.status).toBe(200);
    expect(result.event.usage?.promptTokens).toBe(100);
    expect(result.event.usage?.completionTokens).toBe(20);
    expect(result.event.latencyMs).toBe(50);
    expect(result.event.rawBody).toBe(body);
  });

  it('normalizes anthropic response with input/output tokens', () => {
    resetCounter();
    const body = JSON.stringify({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 50, output_tokens: 10 } });
    const result = normalizeResponse('req-1', 200, body, 'anthropic', 1);
    expect(result.event.usage?.promptTokens).toBe(50);
    expect(result.event.usage?.completionTokens).toBe(10);
  });

  it('returns null for non-JSON request body', () => {
    expect(normalizeRequest('/v1/chat/completions', 'not json', 0)).toBeNull();
  });
});
