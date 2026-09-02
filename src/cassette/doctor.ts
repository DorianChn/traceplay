import type {
  Cassette,
  LLMRequestEvent,
  LLMResponseEvent,
  ToolCallEvent,
  ToolResultEvent,
  TraceEvent,
} from '../types.js';

/**
 * Cassette health diagnostics (v0.8). `traceplay doctor` runs these checks and
 * reports errors (will break replay/assertions) and warnings (may degrade
 * matching or budget assertions).
 */

export type DoctorLevel = 'error' | 'warning' | 'info';

export interface DoctorFinding {
  level: DoctorLevel;
  code: string;
  message: string;
  /** Event seq where the issue was found, when applicable. */
  seq?: number;
}

export interface DoctorResult {
  findings: DoctorFinding[];
  counts: { error: number; warning: number; info: number };
  eventCount: number;
  requestCount: number;
  responseCount: number;
  toolCallCount: number;
  toolResultCount: number;
}

function isEmptyOutput(output: unknown): boolean {
  if (output === null || output === undefined) return true;
  if (typeof output === 'string') return output.trim().length === 0;
  if (Array.isArray(output)) return output.length === 0;
  if (typeof output === 'object') return Object.keys(output as Record<string, unknown>).length === 0;
  return false;
}

export function diagnoseCassette(cassette: Cassette): DoctorResult {
  const findings: DoctorFinding[] = [];
  const events = cassette.events;

  if (events.length === 0) {
    findings.push({ level: 'error', code: 'EMPTY', message: 'cassette has no events' });
  }

  // seq continuity
  const seenSeq = new Set<number>();
  for (const e of events) {
    if (seenSeq.has(e.seq)) {
      findings.push({ level: 'error', code: 'DUP_SEQ', message: `duplicate seq ${e.seq}`, seq: e.seq });
    }
    seenSeq.add(e.seq);
  }
  if (events.length > 0) {
    const maxSeq = Math.max(...events.map((e) => e.seq));
    if (maxSeq !== events.length) {
      findings.push({
        level: 'warning',
        code: 'SEQ_GAP',
        message: `seq not contiguous: ${events.length} events but max seq is ${maxSeq}`,
      });
    }
  }

  // tool.call ↔ tool.result correlation
  const callIds = new Map<string, ToolCallEvent>();
  const resultCallIds = new Map<string, ToolResultEvent>();
  for (const e of events) {
    if (e.type === 'tool.call') {
      const tc = e as ToolCallEvent;
      if (tc.callId) callIds.set(tc.callId, tc);
    }
    if (e.type === 'tool.result') {
      const tr = e as ToolResultEvent;
      resultCallIds.set(tr.callId, tr);
    }
  }
  for (const [callId, result] of resultCallIds) {
    if (!callIds.has(callId)) {
      findings.push({
        level: 'error',
        code: 'ORPHAN_RESULT',
        message: `tool.result with callId "${callId}" has no matching tool.call`,
        seq: result.seq,
      });
    }
  }
  for (const [callId, call] of callIds) {
    if (!resultCallIds.has(callId)) {
      findings.push({
        level: 'warning',
        code: 'MISSING_RESULT',
        message: `tool.call "${call.name}" (callId ${callId}) has no tool.result — may be an in-flight or failed call`,
        seq: call.seq,
      });
    }
  }

  // llm.request ↔ llm.response correlation
  const requestIds = new Set<string>();
  const responseRequestIds = new Set<string>();
  const requests: LLMRequestEvent[] = [];
  const responses: LLMResponseEvent[] = [];
  for (const e of events) {
    if (e.type === 'llm.request') {
      requestIds.add(e.id);
      requests.push(e);
    }
    if (e.type === 'llm.response') {
      responseRequestIds.add(e.requestId);
      responses.push(e);
    }
  }
  for (const resp of responses) {
    if (!requestIds.has(resp.requestId)) {
      findings.push({
        level: 'error',
        code: 'ORPHAN_RESPONSE',
        message: `llm.response references unknown requestId "${resp.requestId}"`,
        seq: resp.seq,
      });
    }
  }
  for (const req of requests) {
    if (!responseRequestIds.has(req.id)) {
      findings.push({
        level: 'warning',
        code: 'MISSING_RESPONSE',
        message: `llm.request (model ${req.model}) has no llm.response — recording may have been interrupted`,
        seq: req.seq,
      });
    }
  }

  // Per-response checks
  for (const resp of responses) {
    if (resp.status !== 200) {
      findings.push({
        level: 'warning',
        code: 'NON_200',
        message: `llm.response status ${resp.status} (expected 200)`,
        seq: resp.seq,
      });
    }
    if (!resp.usage) {
      findings.push({
        level: 'warning',
        code: 'NO_USAGE',
        message: `llm.response has no usage — budget.maxTokens will read as 0`,
        seq: resp.seq,
      });
    }
    if (isEmptyOutput(resp.output)) {
      findings.push({
        level: 'warning',
        code: 'EMPTY_OUTPUT',
        message: `llm.response has empty output`,
        seq: resp.seq,
      });
    }
  }

  // Duplicate requests (same requestHash)
  const hashCount = new Map<string, number>();
  for (const req of requests) {
    const h = req.requestHash;
    hashCount.set(h, (hashCount.get(h) || 0) + 1);
  }
  for (const [hash, count] of hashCount) {
    if (count > 1) {
      findings.push({
        level: 'info',
        code: 'DUP_REQUEST',
        message: `requestHash ${hash.slice(0, 12)}… appears ${count} times — could be a retry or a repeated prompt`,
      });
    }
  }

  // Old cassettes without semanticHash
  const missingSemantic = requests.filter((r) => !r.semanticHash);
  if (missingSemantic.length > 0 && requests.length > 0) {
    findings.push({
      level: 'info',
      code: 'NO_SEMANTIC_HASH',
      message: `${missingSemantic.length}/${requests.length} llm.request events lack semanticHash (pre-v0.5 cassette); matcher falls back to exact/fuzzy`,
    });
  }

  // agent.error events
  for (const e of events) {
    if (e.type === 'agent.error') {
      findings.push({ level: 'error', code: 'AGENT_ERROR', message: `agent.error: ${e.message}`, seq: e.seq });
    }
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.level]++;

  return {
    findings,
    counts,
    eventCount: events.length,
    requestCount: requests.length,
    responseCount: responses.length,
    toolCallCount: callIds.size,
    toolResultCount: resultCallIds.size,
  };
}

/** Exit code: 1 if any error-level finding, 0 otherwise. */
export function doctorExitCode(result: DoctorResult): number {
  return result.counts.error > 0 ? 1 : 0;
}
