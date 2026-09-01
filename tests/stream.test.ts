import { describe, expect, it } from 'vitest';
import {
  isStreamingContentType,
  extractStreamContent,
  extractStreamUsage,
  parseSSEData,
  serializeSSE,
} from '../src/cassette/stream.js';

describe('cassette/stream', () => {
  it('detects streaming content types', () => {
    expect(isStreamingContentType('text/event-stream')).toBe(true);
    expect(isStreamingContentType('application/json')).toBe(false);
    expect(isStreamingContentType(undefined)).toBe(false);
  });

  it('parses data lines', () => {
    expect(parseSSEData('data: {"a":1}')).toEqual({ a: 1 });
    expect(parseSSEData('data: [DONE]')).toBeNull();
    expect(parseSSEData('event: ping')).toBeNull();
    expect(parseSSEData('not data')).toBeNull();
  });

  it('extracts full content from a stream', () => {
    const sse = [
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hello"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    expect(extractStreamContent(sse)).toBe('Hello world');
  });

  it('extracts usage from the final chunk', () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      '',
      'data: {"usage":{"prompt_tokens":12,"completion_tokens":4}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    expect(extractStreamUsage(sse)).toEqual({ promptTokens: 12, completionTokens: 4 });
    expect(extractStreamUsage('data: [DONE]')).toBeUndefined();
  });

  it('serializes content back into a parseable stream', () => {
    const sse = serializeSSE('Hello world', { model: 'm', usage: { promptTokens: 5, completionTokens: 3 } });
    expect(sse).toContain('data:');
    expect(sse).toContain('"content":"Hello world"');
    expect(extractStreamContent(sse)).toBe('Hello world');
    expect(extractStreamUsage(sse)).toEqual({ promptTokens: 5, completionTokens: 3 });
    expect(sse.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('extracts content from a Gemini-style stream', () => {
    const sse = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":""}]},"finishReason":"STOP"}]}',
      '',
    ].join('\n');
    expect(extractStreamContent(sse)).toBe('Hello world');
  });

  it('extracts usage from a Gemini usageMetadata chunk', () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}',
      '',
      'data: {"usageMetadata":{"promptTokenCount":42,"candidatesTokenCount":7}}',
      '',
    ].join('\n');
    expect(extractStreamUsage(sse)).toEqual({ promptTokens: 42, completionTokens: 7 });
  });
});
