import type { LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../types.js';
import { requestHash } from '../core/hash.js';

export interface MatchOutcome {
  found: boolean;
  /** Index of the matched llm.request in events[], or -1. */
  requestIndex: number;
  /** Index of the corresponding llm.response in events[], or -1. */
  responseIndex: number;
  strategy: 'exact';
}

/**
 * Match an incoming replay request against a recorded cassette.
 *
 * 1. Hash the canonicalized request body.
 * 2. Find the llm.request event with that hash.
 * 3. Find the llm.response whose requestId links to that request
 *    (fallback: the next llm.response after the request in sequence).
 */
export function matchRequest(requestBody: unknown, events: TraceEvent[]): MatchOutcome {
  const hash = requestHash(requestBody);
  const requestIndex = events.findIndex(
    (e) => e.type === 'llm.request' && (e as LLMRequestEvent).requestHash === hash,
  );
  if (requestIndex === -1) {
    return { found: false, requestIndex: -1, responseIndex: -1, strategy: 'exact' };
  }

  const requestEvent = events[requestIndex] as LLMRequestEvent;
  let responseIndex = events.findIndex(
    (e) => e.type === 'llm.response' && (e as LLMResponseEvent).requestId === requestEvent.id,
  );
  if (responseIndex === -1) {
    // Fallback: next llm.response after the request
    responseIndex = events.findIndex(
      (e, i) => i > requestIndex && e.type === 'llm.response',
    );
  }

  return {
    found: responseIndex !== -1,
    requestIndex,
    responseIndex,
    strategy: 'exact',
  };
}
