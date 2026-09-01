/**
 * Server-Sent Events (SSE) helpers for streaming LLM responses.
 *
 * Streams are OpenAI-style `text/event-stream` payloads:
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: [DONE]
 */

export interface StreamUsage {
  promptTokens?: number;
  completionTokens?: number;
}

/** True when a response content-type indicates a server-sent event stream. */
export function isStreamingContentType(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes('text/event-stream');
}

/** Parse a single `data: ...` line into its JSON payload (or null). */
export function parseSSEData(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Extract the full assistant content from an OpenAI-style SSE text by
 * concatenating every `choices[0].delta.content` chunk.
 */
export function extractStreamContent(sseText: string): string {
  let content = '';
  for (const line of sseText.split('\n')) {
    const parsed = parseSSEData(line);
    if (!parsed) continue;
    const obj = parsed as Record<string, unknown>;
    const choices = obj.choices;
    if (!Array.isArray(choices) || choices.length === 0) continue;
    const first = choices[0] as Record<string, unknown>;
    const delta = first.delta as Record<string, unknown> | undefined;
    if (delta && typeof delta.content === 'string') content += delta.content;
  }
  return content;
}

/**
 * Extract token usage from an SSE stream (the final chunk often carries
 * `usage` for OpenAI, or an internal `x-*` usage field for some providers).
 */
export function extractStreamUsage(sseText: string): StreamUsage | undefined {
  for (const line of sseText.split('\n')) {
    const parsed = parseSSEData(line);
    if (!parsed) continue;
    const obj = parsed as Record<string, unknown>;
    const usage = obj.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    const promptTokens = usage.prompt_tokens;
    const completionTokens = usage.completion_tokens;
    if (typeof promptTokens === 'number' || typeof completionTokens === 'number') {
      return {
        promptTokens: typeof promptTokens === 'number' ? promptTokens : undefined,
        completionTokens: typeof completionTokens === 'number' ? completionTokens : undefined,
      };
    }
  }
  return undefined;
}

/**
 * Serialize content back into an OpenAI-compatible SSE stream.
 * Used by the replayer to serve recorded streaming responses offline.
 */
export function serializeSSE(
  content: string,
  opts?: { model?: string; id?: string; chunkSize?: number; usage?: StreamUsage },
): string {
  const chunkSize = opts?.chunkSize ?? 40;
  const model = opts?.model ?? 'traceplay-replay';
  const id = opts?.id ?? 'chatcmpl-traceplay';
  const created = Math.floor(Date.now() / 1000);
  const lines: string[] = [];

  lines.push(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    })}`,
  );
  lines.push('');

  for (let i = 0; i < content.length; i += chunkSize) {
    lines.push(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { content: content.slice(i, i + chunkSize) }, finish_reason: null }],
      })}`,
    );
    lines.push('');
  }

  const finalDelta: Record<string, unknown> = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  if (opts?.usage && (opts.usage.promptTokens !== undefined || opts.usage.completionTokens !== undefined)) {
    finalDelta.usage = {
      prompt_tokens: opts.usage.promptTokens,
      completion_tokens: opts.usage.completionTokens,
      total_tokens:
        (opts.usage.promptTokens ?? 0) + (opts.usage.completionTokens ?? 0),
    };
  }
  lines.push(`data: ${JSON.stringify(finalDelta)}`);
  lines.push('');
  lines.push('data: [DONE]');
  lines.push('');

  return lines.join('\n');
}
