import type { Cassette, LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../types.js';
import { deepEqual } from '../core/equal.js';

/**
 * Cassette rebase/merge engine (v0.8).
 *
 * When an agent's prompt or code changes, you often re-record only the steps
 * that changed. `rebaseCassettes` merges the freshly recorded (`head`) cassette
 * onto the existing (`base`) one:
 *
 *   - head segments that match a base request **replace** it (response differs
 *     → counted as `updated`);
 *   - head segments with no base match are **added**;
 *   - base segments that head did not re-record are **retained** (the whole point
 *     of a partial re-record — you don't lose the steps you didn't touch).
 *
 * Segments are grouped by `llm.request`; a segment is one request plus every
 * event until the next request. Matching uses `semanticHash` (v0.5+), falling
 * back to `requestHash`, then a canonicalized messages string.
 */

export interface RebaseSummary {
  /** Both cassettes have the request and the response is identical. */
  unchanged: number;
  /** Both have the request but the response changed — head wins. */
  updated: number;
  /** Head has a request base does not — appended in head order. */
  added: number;
  /** Base has a request head did not re-record — retained from base. */
  retained: number;
}

export interface RebaseUpdate {
  /** Short fingerprint prefix for identification. */
  fingerprint: string;
  basePreview: string;
  headPreview: string;
}

export interface RebaseResult {
  cassette: Cassette;
  summary: RebaseSummary;
  /** Every segment whose response changed between base and head. */
  updates: RebaseUpdate[];
}

interface Segment {
  fingerprint: string;
  events: TraceEvent[];
  request: LLMRequestEvent;
  response?: LLMResponseEvent;
}

function canonicalMessages(messages: unknown[]): string {
  try {
    return JSON.stringify(messages).replace(/\s+/g, ' ');
  } catch {
    return '';
  }
}

function segmentFingerprint(req: LLMRequestEvent): string {
  return req.semanticHash || req.requestHash || canonicalMessages(req.messages || []);
}

function splitIntoSegments(events: TraceEvent[]): { prefix: TraceEvent[]; segments: Segment[] } {
  const prefix: TraceEvent[] = [];
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const e of events) {
    if (e.type === 'llm.request') {
      if (current) segments.push(current);
      current = {
        fingerprint: segmentFingerprint(e),
        events: [e],
        request: e,
        response: undefined,
      };
    } else if (current) {
      current.events.push(e);
      if (e.type === 'llm.response') current.response = e;
    } else {
      prefix.push(e);
    }
  }
  if (current) segments.push(current);
  return { prefix, segments };
}

function previewOutput(output: unknown): string {
  const s = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export interface RebaseOptions {
  /** Which cassette wins when a matched segment's response differs. Default 'head'. */
  prefer?: 'head' | 'base';
}

/**
 * Merge `head` (freshly recorded, possibly partial) onto `base` (existing).
 * The returned cassette keeps head's order for everything head covers; base-only
 * segments are appended after head's segments (correct for partial prefix
 * re-records, the dominant use case).
 */
export function rebaseCassettes(base: Cassette, head: Cassette, options: RebaseOptions = {}): RebaseResult {
  const prefer = options.prefer || 'head';
  const baseSplit = splitIntoSegments(base.events);
  const headSplit = splitIntoSegments(head.events);

  // Index base segments by fingerprint; repeated fingerprints are consumed in
  // order (shift()) so the Nth head request matches the Nth base request.
  const baseByFp = new Map<string, Segment[]>();
  for (const seg of baseSplit.segments) {
    const list = baseByFp.get(seg.fingerprint) || [];
    list.push(seg);
    baseByFp.set(seg.fingerprint, list);
  }

  const resultEvents: TraceEvent[] = [];
  const summary: RebaseSummary = { unchanged: 0, updated: 0, added: 0, retained: 0 };
  const updates: RebaseUpdate[] = [];

  // Prefix (events before the first llm.request — typically user.message):
  // prefer head's, fall back to base's.
  const prefix = headSplit.prefix.length > 0 ? headSplit.prefix : baseSplit.prefix;
  resultEvents.push(...prefix);

  for (const headSeg of headSplit.segments) {
    const baseList = baseByFp.get(headSeg.fingerprint);
    const baseSeg = baseList && baseList.length > 0 ? baseList.shift()! : null;

    if (baseSeg) {
      const baseOut = baseSeg.response?.output;
      const headOut = headSeg.response?.output;
      if (deepEqual(baseOut, headOut)) {
        summary.unchanged++;
        resultEvents.push(...baseSeg.events);
      } else {
        summary.updated++;
        updates.push({
          fingerprint: headSeg.fingerprint.slice(0, 12),
          basePreview: previewOutput(baseOut),
          headPreview: previewOutput(headOut),
        });
        resultEvents.push(...(prefer === 'base' ? baseSeg.events : headSeg.events));
      }
    } else {
      summary.added++;
      resultEvents.push(...headSeg.events);
    }
  }

  // Whatever base segments head did not cover are retained.
  for (const list of baseByFp.values()) {
    for (const seg of list) {
      summary.retained++;
      resultEvents.push(...seg.events);
    }
  }

  // Re-number seq monotonically; keep original timestamps and ids.
  const resequenced = resultEvents.map((e, i) => ({ ...e, seq: i + 1 }));

  return {
    cassette: {
      version: 1,
      meta: { ...head.meta },
      events: resequenced,
    },
    summary,
    updates,
  };
}
