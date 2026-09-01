import type { LLMRequestEvent, LLMResponseEvent, TokenUsage } from '../types.js';
import { requestHash, semanticRequestHash } from '../core/hash.js';
import { redactBody } from '../core/redact.js';
import { extractStreamContent, extractStreamUsage } from './stream.js';

let eventCounter = 0;

export function nextId(prefix: string): string {
  eventCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${eventCounter}`;
}

export function resetCounter(): void {
  eventCounter = 0;
}

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini' | 'other';

export function detectProvider(path: string): ProviderKind {
  if (/\/chat\/completions|\/completions/i.test(path)) return 'openai-compatible';
  if (/\/v1\/messages|\/messages/i.test(path)) return 'anthropic';
  if (/\/v1beta\/models\/.*:generateContent|:streamGenerateContent/i.test(path)) return 'gemini';
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
  const obj = redactBody(body) as Record<string, unknown>;
  const model = typeof obj.model === 'string' ? obj.model : 'unknown';

  let messages: unknown[] = [];
  if (provider === 'openai-compatible' && Array.isArray(obj.messages)) {
    messages = obj.messages;
  } else if (provider === 'anthropic') {
    // Anthropic: system + messages -> normalized to a single message array
    const sys = typeof obj.system === 'string' ? [{ role: 'system', content: obj.system }] : [];
    const msgs = Array.isArray(obj.messages) ? obj.messages : [];
    messages = [...sys, ...msgs];
  } else if (provider === 'gemini') {
    // Gemini: contents[] + systemInstruction -> normalized to a message array
    const sys = obj.systemInstruction as Record<string, unknown> | undefined;
    if (sys && Array.isArray(sys.parts)) {
      const text = (sys.parts as Array<Record<string, unknown>>)
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('');
      if (text) messages.push({ role: 'system', content: text });
    }
    if (Array.isArray(obj.contents)) {
      for (const c of obj.contents as Array<Record<string, unknown>>) {
        const role = c.role === 'model' ? 'assistant' : 'user';
        if (Array.isArray(c.parts)) {
          const text = (c.parts as Array<Record<string, unknown>>)
            .map((p) => (typeof p.text === 'string' ? p.text : ''))
            .join('');
          messages.push({ role, content: text });
        }
      }
    }
  } else {
    messages = Array.isArray(obj.messages) ? obj.messages : [obj];
  }

  const temperature = typeof obj.temperature === 'number' ? obj.temperature : undefined;
  // L1 hash is computed over the same normalized comparable shape the replayer
  // builds from an incoming request (model + system-merged messages +
  // temperature) — NOT the full raw body — so seed/whitespace-only drift on
  // otherwise-identical requests matches deterministically.
  const comparable =
    temperature === undefined ? { model, messages } : { model, messages, temperature };
  const event: LLMRequestEvent = {
    id: nextId('req'),
    seq,
    at: new Date().toISOString(),
    type: 'llm.request',
    provider,
    model,
    path,
    messages,
    temperature,
    stream: obj.stream === true,
    requestHash: requestHash(obj),
    semanticHash: semanticRequestHash(comparable),
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
    } else if (provider === 'gemini') {
      const um = body.usageMetadata as Record<string, unknown> | undefined;
      if (um) {
        usage = {
          promptTokens: typeof um.promptTokenCount === 'number' ? um.promptTokenCount : 0,
          completionTokens:
            typeof um.candidatesTokenCount === 'number' ? um.candidatesTokenCount : 0,
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

export interface NormalizedStreamResponse {
  event: LLMResponseEvent;
}

/**
 * Normalize a streaming SSE response captured at the proxy boundary.
 * The full content is extracted from the stream for answer assertions, and
 * token usage is recovered from the final chunk when present. The raw SSE
 * text is stored so the replayer can serve it verbatim.
 */
export function normalizeStreamResponse(
  requestId: string,
  status: number,
  sseText: string,
  provider: ProviderKind,
  seq: number,
  latencyMs?: number,
): NormalizedStreamResponse {
  const content = extractStreamContent(sseText);
  const rawUsage = extractStreamUsage(sseText);
  const usage: TokenUsage | undefined = rawUsage
    ? {
        promptTokens: rawUsage.promptTokens ?? 0,
        completionTokens: rawUsage.completionTokens ?? 0,
      }
    : undefined;
  const event: LLMResponseEvent = {
    id: nextId('res'),
    seq,
    at: new Date().toISOString(),
    type: 'llm.response',
    requestId,
    status,
    output: { content, usage: usage ?? undefined },
    rawBody: sseText,
    stream: true,
    usage,
    latencyMs,
  };
  return { event };
}
