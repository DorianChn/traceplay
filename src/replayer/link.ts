import type { LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../types.js';

/**
 * Single source of truth for linking a recorded `llm.request` to its
 * `llm.response` (review §6.2: this heuristic used to be copy-pasted in the
 * matcher and the diff reporter and could drift apart).
 *
 * Resolution order:
 *   1. the explicit `requestId` edge (response.requestId === request.id);
 *   2. otherwise the first `llm.response` that follows the request in the
 *      timeline — this keeps legacy cassettes (which predate explicit edges)
 *      working.
 *
 * @returns index in events[], or -1 when no response follows.
 */
export function linkResponseIndex(
  events: TraceEvent[],
  requestEvent: LLMRequestEvent,
  requestIndex: number,
): number {
  const linked = events.findIndex(
    (e) => e.type === 'llm.response' && (e as LLMResponseEvent).requestId === requestEvent.id,
  );
  if (linked !== -1) return linked;
  return events.findIndex((e, i) => i > requestIndex && e.type === 'llm.response');
}

/** Event-level variant: returns the linked response event (or undefined). */
export function linkResponse(
  events: TraceEvent[],
  requestEvent: LLMRequestEvent,
  requestIndex: number,
): LLMResponseEvent | undefined {
  const idx = linkResponseIndex(events, requestEvent, requestIndex);
  return idx === -1 ? undefined : (events[idx] as LLMResponseEvent);
}
