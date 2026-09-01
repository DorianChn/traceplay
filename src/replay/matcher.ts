import { createHash } from 'node:crypto';
import type { LLMRequestEvent, TraceEvent } from '../types.js';

/**
 * Replay matching is the heart of deterministic offline replay.
 *
 * Strategy (M2):
 *   1. canonicalize(request) — drop volatile fields, sort keys
 *   2. sha256 -> requestHash
 *   3. exact match against recorded llm.request events
 *
 * Fuzzy / embedding-based matching is deferred to a later milestone; when
 * exact match misses, we fail loudly with a "re-record hint" instead of
 * guessing. Guessing is what makes replay tools flaky.
 */

const VOLATILE_KEYS = new Set([
  'id',
  'request_id',
  'requestId',
  'trace_id',
  'traceId',
  'timestamp',
  'created_at',
  'createdAt',
  'user',
  'stream', // streaming vs non-streaming is transport, not semantics
]);

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      sorted[key] = sortValue(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function requestHash(request: unknown): string {
  return createHash('sha256').update(canonicalize(request)).digest('hex');
}

export interface MatchOutcome {
  found: boolean;
  /** Index into events[] of the matched llm.request, or -1. */
  index: number;
  score: number;
  strategy: 'exact';
}

export function matchRequest(request: unknown, events: TraceEvent[]): MatchOutcome {
  const hash = requestHash(request);
  const index = events.findIndex(
    (e) => e.type === 'llm.request' && (e as LLMRequestEvent).requestHash === hash,
  );
  return index >= 0
    ? { found: true, index, score: 1, strategy: 'exact' }
    : { found: false, index: -1, score: 0, strategy: 'exact' };
}
