import type { Cassette, LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../types.js';
import { structuredSimilarity, DEFAULT_STRUCTURED_THRESHOLD } from '../replayer/matcher.js';
import { linkResponse } from '../replayer/link.js';

export interface DiffEntry {
  kind: 'added' | 'removed';
  requestHash: string;
  model?: string;
  messages?: unknown[];
}

/** A request whose text drifted (hash changed) but is semantically the same step (R10). */
export interface ChangedRequest {
  model?: string;
  fromMessages?: unknown[];
  toMessages?: unknown[];
  fromAnswer: string;
  toAnswer: string;
  /** Structured similarity that justified pairing the two requests. */
  score: number;
}

export interface ChangedResponse {
  requestHash: string;
  from: string;
  to: string;
}

export interface ToolChange {
  kind: 'added' | 'removed';
  name: string;
}

export interface DiffReport {
  added: DiffEntry[];
  removed: DiffEntry[];
  changedRequests: ChangedRequest[];
  changedResponses: ChangedResponse[];
  toolChanges: ToolChange[];
}

/** Minimum structured similarity to treat two hash-different requests as one changed step. */
export const DIFF_CHANGE_THRESHOLD = DEFAULT_STRUCTURED_THRESHOLD;

function requestList(cassette: Cassette): Array<{ event: LLMRequestEvent; index: number }> {
  const out: Array<{ event: LLMRequestEvent; index: number }> = [];
  cassette.events.forEach((e, index) => {
    if (e.type === 'llm.request') out.push({ event: e as LLMRequestEvent, index });
  });
  return out;
}

function answerText(cassette: Cassette, request: LLMRequestEvent, index: number): string {
  const res = linkResponse(cassette.events, request, index);
  if (!res) return '';
  return responseToText(res);
}

function responseToText(res: LLMResponseEvent): string {
  const out = res.output as Record<string, unknown> | string | undefined;
  if (typeof out === 'string') return out;
  if (out && typeof out === 'object') {
    if (typeof out.content === 'string') return out.content;
    const choices = out.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0] as Record<string, unknown>;
      const message = first.message as Record<string, unknown> | undefined;
      if (message && typeof message.content === 'string') return message.content;
      const delta = first.delta as Record<string, unknown> | undefined;
      if (delta && typeof delta.content === 'string') return delta.content;
    }
  }
  return '';
}

function entry(kind: 'added' | 'removed', event: LLMRequestEvent): DiffEntry {
  return { kind, requestHash: event.requestHash, model: event.model, messages: event.messages };
}

/**
 * Compare two cassettes (e.g. before/after a prompt or model change).
 *
 * Requests pair in two ways:
 *   1. identical request hash  → same request; a differing answer is a
 *      `changedResponse`;
 *   2. different hash but high structured similarity → the same step whose
 *      prompt drifted, reported as a `changedRequest` (R10) instead of a
 *      misleading removed+added pair.
 * Remaining unpaired requests are reported as added / removed.
 */
export function compareCassettes(a: Cassette, b: Cassette, threshold: number = DIFF_CHANGE_THRESHOLD): DiffReport {
  const aList = requestList(a);
  const bList = requestList(b);
  const bByHash = new Map<string, Array<{ event: LLMRequestEvent; index: number }>>();
  for (const item of bList) {
    const key = item.event.requestHash;
    const bucket = bByHash.get(key);
    if (bucket) bucket.push(item);
    else bByHash.set(key, [item]);
  }

  // Pass 1: exact-hash pairing (one-to-one, consuming matches in order).
  const aMatched = new Array<boolean>(aList.length).fill(false);
  const bMatched = new Array<boolean>(bList.length).fill(false);
  const changedResponses: ChangedResponse[] = [];

  aList.forEach((aItem, ai) => {
    const bucket = bByHash.get(aItem.event.requestHash);
    if (!bucket) return;
    const bj = bList.findIndex(
      (item, idx) => !bMatched[idx] && bucket.some((cand) => cand === item),
    );
    if (bj === -1) return;
    aMatched[ai] = true;
    bMatched[bj] = true;
    const bItem = bList[bj];
    const aText = answerText(a, aItem.event, aItem.index);
    const bText = answerText(b, bItem.event, bItem.index);
    if (aText !== bText) {
      changedResponses.push({ requestHash: aItem.event.requestHash, from: aText, to: bText });
    }
  });

  // Pass 2: pair the hash-unmatched requests by structured similarity (R10).
  const changedRequests: ChangedRequest[] = [];
  interface Pair {
    ai: number;
    bj: number;
    score: number;
  }
  const pairs: Pair[] = [];
  aList.forEach((aItem, ai) => {
    if (aMatched[ai]) return;
    bList.forEach((bItem, bj) => {
      if (bMatched[bj]) return;
      const score = structuredSimilarity(
        { model: aItem.event.model, messages: aItem.event.messages, temperature: aItem.event.temperature },
        { model: bItem.event.model, messages: bItem.event.messages, temperature: bItem.event.temperature },
      );
      if (score >= threshold) pairs.push({ ai, bj, score });
    });
  });
  // Greedy one-to-one pairing, strongest first.
  pairs.sort((x, y) => y.score - x.score);
  for (const p of pairs) {
    if (aMatched[p.ai] || bMatched[p.bj]) continue;
    aMatched[p.ai] = true;
    bMatched[p.bj] = true;
    const aItem = aList[p.ai];
    const bItem = bList[p.bj];
    changedRequests.push({
      model: aItem.event.model,
      fromMessages: aItem.event.messages,
      toMessages: bItem.event.messages,
      fromAnswer: answerText(a, aItem.event, aItem.index),
      toAnswer: answerText(b, bItem.event, bItem.index),
      score: p.score,
    });
  }

  // Pass 3: leftovers are genuine adds/removes.
  const removed: DiffEntry[] = [];
  const added: DiffEntry[] = [];
  aList.forEach((item, ai) => {
    if (!aMatched[ai]) removed.push(entry('removed', item.event));
  });
  bList.forEach((item, bj) => {
    if (!bMatched[bj]) added.push(entry('added', item.event));
  });

  const toolsA = new Set(
    a.events.filter((e) => e.type === 'tool.call').map((e) => (e as Extract<TraceEvent, { type: 'tool.call' }>).name),
  );
  const toolsB = new Set(
    b.events.filter((e) => e.type === 'tool.call').map((e) => (e as Extract<TraceEvent, { type: 'tool.call' }>).name),
  );
  const toolChanges: ToolChange[] = [];
  for (const name of toolsB) if (!toolsA.has(name)) toolChanges.push({ kind: 'added', name });
  for (const name of toolsA) if (!toolsB.has(name)) toolChanges.push({ kind: 'removed', name });

  return { added, removed, changedRequests, changedResponses, toolChanges };
}

function lastUserText(messages: unknown[] | undefined): string {
  if (!messages || messages.length === 0) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown>;
    if (m && (m.role === 'user' || typeof m.content === 'string')) {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      return text;
    }
  }
  return describeMessages(messages);
}

function describeMessages(messages: unknown[] | undefined): string {
  if (!messages || messages.length === 0) return '';
  const first = messages[messages.length - 1] as Record<string, unknown> | undefined;
  const text = first && typeof first.content === 'string' ? first.content : JSON.stringify(messages).slice(0, 80);
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

export function formatDiff(report: DiffReport, nameA: string, nameB: string): string {
  const lines: string[] = [];
  lines.push(`traceplay diff — ${nameA}  vs  ${nameB}`);
  lines.push('');

  lines.push(`Requests changed in place (${report.changedRequests.length}):`);
  if (report.changedRequests.length === 0) lines.push('  (none)');
  for (const c of report.changedRequests) {
    lines.push(`  ~ ${c.model ?? '?'} :: similarity ${c.score.toFixed(2)}`);
    lines.push(`      prompt from: ${truncate(lastUserText(c.fromMessages))}`);
    lines.push(`      prompt to:   ${truncate(lastUserText(c.toMessages))}`);
    if (c.fromAnswer !== c.toAnswer) {
      lines.push(`      answer from: ${truncate(c.fromAnswer)}`);
      lines.push(`      answer to:   ${truncate(c.toAnswer)}`);
    }
  }

  lines.push('');
  lines.push(`Requests added (${report.added.length}):`);
  if (report.added.length === 0) lines.push('  (none)');
  for (const d of report.added) lines.push(`  + ${d.model ?? '?'} :: ${describeMessages(d.messages)}`);

  lines.push('');
  lines.push(`Requests removed (${report.removed.length}):`);
  if (report.removed.length === 0) lines.push('  (none)');
  for (const d of report.removed) lines.push(`  - ${d.model ?? '?'} :: ${describeMessages(d.messages)}`);

  lines.push('');
  lines.push(`Responses changed (${report.changedResponses.length}):`);
  if (report.changedResponses.length === 0) lines.push('  (none)');
  for (const c of report.changedResponses) {
    lines.push(`  ~ ${c.requestHash.slice(0, 12)}…`);
    lines.push(`      from: ${truncate(c.from)}`);
    lines.push(`      to:   ${truncate(c.to)}`);
  }

  lines.push('');
  lines.push(`Tool calls changed (${report.toolChanges.length}):`);
  if (report.toolChanges.length === 0) lines.push('  (none)');
  for (const t of report.toolChanges) lines.push(`  ${t.kind === 'added' ? '+' : '-'} ${t.name}`);

  lines.push('');
  lines.push(
    `Summary: ${report.changedRequests.length} changed, ${report.added.length} added, ${report.removed.length} removed, ` +
      `${report.changedResponses.length} response changes, ${report.toolChanges.length} tool changes`,
  );
  return lines.join('\n');
}

function truncate(s: string, n = 100): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
