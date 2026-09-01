import type { LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../types.js';
import { requestHash } from '../core/hash.js';

export interface MatchOptions {
  /** When true, fall back to similarity matching if the exact hash misses. */
  fuzzy?: boolean;
  /** Minimum similarity (0..1) for a fuzzy match to be accepted. Default 0.6. */
  threshold?: number;
}

export interface MatchOutcome {
  found: boolean;
  /** Index of the matched llm.request in events[], or -1. */
  requestIndex: number;
  /** Index of the corresponding llm.response in events[], or -1. */
  responseIndex: number;
  strategy: 'exact' | 'fuzzy';
  /** Similarity score for fuzzy matches (0..1). */
  score?: number;
}

function messageTexts(messages: unknown[]): string[] {
  const out: string[] = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    const mm = m as Record<string, unknown>;
    if (typeof mm.content === 'string') out.push(mm.content);
    else if (typeof mm.text === 'string') out.push(mm.text);
    else if (Array.isArray(mm.parts)) {
      for (const p of mm.parts as Array<Record<string, unknown>>) {
        if (typeof p.text === 'string') out.push(p.text);
      }
    }
  }
  return out;
}

function tokenSet(texts: string[]): Set<string> {
  const set = new Set<string>();
  for (const t of texts) {
    for (const tok of t.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/)) {
      if (tok) set.add(tok);
    }
  }
  return set;
}

/** Jaccard similarity over the token sets of two message sequences. */
export function similarity(a: unknown[], b: unknown[]): number {
  const sa = tokenSet(messageTexts(a));
  const sb = tokenSet(messageTexts(b));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function findResponse(events: TraceEvent[], requestEvent: LLMRequestEvent, requestIndex: number): number {
  const linked = events.findIndex(
    (e) => e.type === 'llm.response' && (e as LLMResponseEvent).requestId === requestEvent.id,
  );
  if (linked !== -1) return linked;
  return events.findIndex((e, i) => i > requestIndex && e.type === 'llm.response');
}

/**
 * Match an incoming replay request against a recorded cassette.
 *
 * 1. Hash the canonicalized request body and look for an exact llm.request.
 * 2. When `options.fuzzy` is enabled and the exact hash misses, compare
 *    message-token similarity against every recorded request and accept the
 *    closest one above the threshold. This tolerates small wording changes.
 */
export function matchRequest(
  requestBody: unknown,
  events: TraceEvent[],
  options: MatchOptions = {},
): MatchOutcome {
  const hash = requestHash(requestBody);
  const exactIndex = events.findIndex(
    (e) => e.type === 'llm.request' && (e as LLMRequestEvent).requestHash === hash,
  );
  if (exactIndex !== -1) {
    const requestEvent = events[exactIndex] as LLMRequestEvent;
    const responseIndex = findResponse(events, requestEvent, exactIndex);
    return { found: responseIndex !== -1, requestIndex: exactIndex, responseIndex, strategy: 'exact' };
  }

  if (!options.fuzzy) {
    return { found: false, requestIndex: -1, responseIndex: -1, strategy: 'exact' };
  }

  const threshold = options.threshold ?? 0.6;
  const reqMessages = (requestBody as Record<string, unknown>).messages;
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type !== 'llm.request') continue;
    const score = similarity((e as LLMRequestEvent).messages, Array.isArray(reqMessages) ? reqMessages : []);
    if (best === null || score > best.score) best = { index: i, score };
  }

  if (best && best.score >= threshold) {
    const requestEvent = events[best.index] as LLMRequestEvent;
    const responseIndex = findResponse(events, requestEvent, best.index);
    return {
      found: responseIndex !== -1,
      requestIndex: best.index,
      responseIndex,
      strategy: 'fuzzy',
      score: best.score,
    };
  }

  return { found: false, requestIndex: -1, responseIndex: -1, strategy: 'fuzzy', score: best?.score };
}
