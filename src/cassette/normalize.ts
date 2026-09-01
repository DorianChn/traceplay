import type { LLMRequestEvent, LLMResponseEvent, TokenUsage } from '../types.js';
import { requestHash } from '../core/hash.js';

let eventCounter = 0;

export function nextId(prefix: string): string {
  eventCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${eventCounter}`;
}

export function resetCounter(): void {
  eventCounter = 0;
}

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'other';

export function detectProvider(path: string): ProviderKind {
  if (/\/chat\/completions|\/completions/i.test(path)) return 'openai-compatible';
  if (/\/v1\/messages|\/messages/i.test(path)) return 'anthropic';
  return 'other';
}

export interface NormalizedRequest {
  event: LLMRequestEvent;
  rawBody: string;
}

export function normalizeRequest(
  path: string,
  rawBody: string,
  seq: number,
): NormalizedRequest | null {
  const provider = detectProvider(path);
  let body: unknown;
  try {
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return null; // non-JSON body (e.g. multipart) — skip recording
  }
  const obj = body as Record<string, unknown>;
  const model = typeof obj.model === 'string' ? obj.model : 'unknown';

  let messages: unknown[] = [];
  if (provider === 'openai-compatible' && Array.isArray(obj.messages)) {
    messages = obj.messages;
  } else if (provider === 'anthropic') {
    // Anthropic: system + messages -> normalized to a single message array
    const sys = typeof obj.system === 'string' ? [{ role: 'system', content: obj.system }] : [];
    const msgs = Array.isArray(obj.messages) ? obj.messages : [];
    messages = [...sys, ...msgs];
  } else {
    messages = Array.isArray(obj.messages) ? obj.messages : [obj];
  }

  const event: LLMRequestEvent = {
    id: nextId('req'),
    seq,
    at: new Date().toISOString(),
    type: 'llm.request',
    provider,
    model,
    path,
    messages,
    temperature: typeof obj.temperature === 'number' ? obj.temperature : undefined,
    requestHash: requestHash(body),
  };
  return { event, rawBody };
}

export interface NormalizedResponse {
  event: LLMResponseEvent;
}

export function normalizeResponse(
  requestId: string,
  status: number,
  rawBody: string,
  provider: ProviderKind,
  seq: number,
  latencyMs?: number,
): NormalizedResponse {
  let output: unknown = rawBody;
  let usage: TokenUsage | undefined;

  try {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    output = body;

    if (provider === 'openai-compatible') {
      const u = body.usage as Record<string, unknown> | undefined;
      if (u) {
        usage = {
          promptTokens: typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0,
          completionTokens: typeof u.completion_tokens === 'number' ? u.completion_tokens : 0,
        };
      }
    } else if (provider === 'anthropic') {
      const u = body.usage as Record<string, unknown> | undefined;
      if (u) {
        usage = {
          promptTokens: typeof u.input_tokens === 'number' ? u.input_tokens : 0,
          completionTokens: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
        };
      }
    }
  } catch {
    // rawBody is not JSON (e.g. streaming SSE or plain text) — store as-is
  }

  const event: LLMResponseEvent = {
    id: nextId('res'),
    seq,
    at: new Date().toISOString(),
    type: 'llm.response',
    requestId,
    status,
    output,
    rawBody,
    usage,
    latencyMs,
  };
  return { event };
}
