import { describe, expect, it } from 'vitest';
import { detectProvider, normalizeRequest, normalizeResponse, resetCounter } from '../src/cassette/normalize.js';
import { normalizeStreamResponse } from '../src/cassette/normalize.js';

describe('gemini provider', () => {
  it('detects gemini endpoints', () => {
    expect(detectProvider('/v1beta/models/gemini-2.0-flash:generateContent')).toBe('gemini');
    expect(detectProvider('/v1beta/models/gemini-2.0-flash:streamGenerateContent')).toBe('gemini');
  });

  it('normalizes a gemini generateContent request', () => {
    resetCounter();
    const body = JSON.stringify({
      model: 'gemini-2.0-flash',
      systemInstruction: { parts: [{ text: 'you are helpful' }] },
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    });
    const result = normalizeRequest('/v1beta/models/gemini-2.0-flash:generateContent', body, 0);
    expect(result).not.toBeNull();
    expect(result!.event.provider).toBe('gemini');
    expect(result!.event.model).toBe('gemini-2.0-flash');
    expect(result!.event.messages).toHaveLength(2);
    expect((result!.event.messages[0] as Record<string, string>).role).toBe('system');
    expect((result!.event.messages[1] as Record<string, string>).role).toBe('user');
    expect((result!.event.messages[1] as Record<string, string>).content).toBe('hello');
  });

  it('normalizes a gemini response with usageMetadata', () => {
    resetCounter();
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'hello there' }] } }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 6 },
    });
    const result = normalizeResponse('req-1', 200, body, 'gemini', 1);
    expect(result.event.usage?.promptTokens).toBe(30);
    expect(result.event.usage?.completionTokens).toBe(6);
  });
});

describe('streaming normalization', () => {
  it('normalizes a captured SSE stream into a stream response event', () => {
    resetCounter();
    const sse = [
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hi there"}}]}',
      '',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":3}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const result = normalizeStreamResponse('req-1', 200, sse, 'openai-compatible', 1, 42);
    expect(result.event.stream).toBe(true);
    expect(result.event.usage).toEqual({ promptTokens: 10, completionTokens: 3 });
    expect((result.event.output as { content: string }).content).toBe('Hi there');
    expect(result.event.rawBody).toBe(sse);
    expect(result.event.latencyMs).toBe(42);
  });
});
