import type { Cassette, LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../types.js';

export interface DiffEntry {
  kind: 'added' | 'removed';
  requestHash: string;
  model?: string;
  messages?: unknown[];
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
  changedResponses: ChangedResponse[];
  toolChanges: ToolChange[];
}

function requestsByHash(cassette: Cassette): Map<string, LLMRequestEvent> {
  const map = new Map<string, LLMRequestEvent>();
  for (const e of cassette.events) {
    if (e.type === 'llm.request') map.set((e as LLMRequestEvent).requestHash, e as LLMRequestEvent);
  }
  return map;
}

function responseFor(cassette: Cassette, request: LLMRequestEvent): LLMResponseEvent | undefined {
  const linked = cassette.events.find(
    (e) => e.type === 'llm.response' && (e as LLMResponseEvent).requestId === request.id,
  );
  if (linked) return linked as LLMResponseEvent;
  const idx = cassette.events.indexOf(request);
  const next = cassette.events.slice(idx + 1).find((e) => e.type === 'llm.response');
  return next as LLMResponseEvent | undefined;
}

function answerText(cassette: Cassette, request: LLMRequestEvent): string {
  const res = responseFor(cassette, request);
  if (!res) return '';
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

/**
 * Compare two cassettes (e.g. before/after a prompt or model change) and
 * report behavioral differences: added/removed requests, changed responses,
 * and added/removed tool calls.
 */
export function compareCassettes(a: Cassette, b: Cassette): DiffReport {
  const aReqs = requestsByHash(a);
  const bReqs = requestsByHash(b);

  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  for (const [hash, req] of bReqs) {
    if (!aReqs.has(hash)) added.push({ kind: 'added', requestHash: hash, model: req.model, messages: req.messages });
  }
  for (const [hash, req] of aReqs) {
    if (!bReqs.has(hash)) removed.push({ kind: 'removed', requestHash: hash, model: req.model, messages: req.messages });
  }

  const changedResponses: ChangedResponse[] = [];
  for (const [hash, aReq] of aReqs) {
    const bReq = bReqs.get(hash);
    if (!bReq) continue;
    const aText = answerText(a, aReq);
    const bText = answerText(b, bReq);
    if (aText !== bText) changedResponses.push({ requestHash: hash, from: aText, to: bText });
  }

  const toolsA = new Set(
    a.events.filter((e) => e.type === 'tool.call').map((e) => (e as Extract<TraceEvent, { type: 'tool.call' }>).name),
  );
  const toolsB = new Set(
    b.events.filter((e) => e.type === 'tool.call').map((e) => (e as Extract<TraceEvent, { type: 'tool.call' }>).name),
  );
  const toolChanges: ToolChange[] = [];
  for (const name of toolsB) if (!toolsA.has(name)) toolChanges.push({ kind: 'added', name });
  for (const name of toolsA) if (!toolsB.has(name)) toolChanges.push({ kind: 'removed', name });

  return { added, removed, changedResponses, toolChanges };
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
    `Summary: ${report.added.length} added, ${report.removed.length} removed, ` +
      `${report.changedResponses.length} changed, ${report.toolChanges.length} tool changes`,
  );
  return lines.join('\n');
}

function truncate(s: string, n = 100): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
