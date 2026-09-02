import { describe, expect, it } from 'vitest';
import { diagnoseCassette, doctorExitCode } from '../src/cassette/doctor.js';
import type { Cassette, LLMRequestEvent, LLMResponseEvent, ToolCallEvent, ToolResultEvent, TraceEvent } from '../src/types.js';

function cleanCassette(): Cassette {
  const events: TraceEvent[] = [
    {
      id: 'req1', seq: 1, at: new Date(0).toISOString(), type: 'llm.request',
      provider: 'other', model: 'm', messages: [], requestHash: 'h1', semanticHash: 's1',
    } as LLMRequestEvent,
    {
      id: 'resp1', seq: 2, at: new Date(0).toISOString(), type: 'llm.response',
      requestId: 'req1', status: 200, output: 'hello', usage: { promptTokens: 10, completionTokens: 5 },
    } as LLMResponseEvent,
    {
      id: 'tc1', seq: 3, at: new Date(0).toISOString(), type: 'tool.call',
      name: 'search', arguments: { q: 'x' }, callId: 'call1',
    } as ToolCallEvent,
    {
      id: 'tr1', seq: 4, at: new Date(0).toISOString(), type: 'tool.result',
      callId: 'call1', output: { result: 'found' },
    } as ToolResultEvent,
  ];
  return { version: 1, meta: { recordedAt: new Date(0).toISOString(), redacted: true }, events };
}

describe('diagnoseCassette — cassette health checks', () => {
  it('reports no issues for a clean cassette', () => {
    const r = diagnoseCassette(cleanCassette());
    expect(r.counts.error).toBe(0);
    expect(r.counts.warning).toBe(0);
    expect(r.findings).toHaveLength(0);
    expect(r.eventCount).toBe(4);
  });

  it('flags an orphan tool.result', () => {
    const c = cleanCassette();
    c.events.push({
      id: 'tr2', seq: 5, at: new Date(0).toISOString(), type: 'tool.result',
      callId: 'nonexistent', output: {},
    } as ToolResultEvent);
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'ORPHAN_RESULT')).toBe(true);
    expect(r.counts.error).toBeGreaterThan(0);
  });

  it('flags a tool.call with no result as warning', () => {
    const c = cleanCassette();
    // remove the tool.result
    c.events = c.events.filter((e) => e.type !== 'tool.result');
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'MISSING_RESULT')).toBe(true);
    expect(r.counts.warning).toBeGreaterThan(0);
  });

  it('flags missing usage as warning', () => {
    const c = cleanCassette();
    delete (c.events[1] as LLMResponseEvent).usage;
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'NO_USAGE')).toBe(true);
  });

  it('flags empty output as warning', () => {
    const c = cleanCassette();
    (c.events[1] as LLMResponseEvent).output = '';
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'EMPTY_OUTPUT')).toBe(true);
  });

  it('flags non-200 response as warning', () => {
    const c = cleanCassette();
    (c.events[1] as LLMResponseEvent).status = 429;
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'NON_200')).toBe(true);
  });

  it('flags seq gaps as warning', () => {
    const c = cleanCassette();
    c.events[3].seq = 99;
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'SEQ_GAP')).toBe(true);
  });

  it('flags duplicate seq as error', () => {
    const c = cleanCassette();
    c.events[1].seq = 1; // duplicate of req1
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'DUP_SEQ')).toBe(true);
    expect(r.counts.error).toBeGreaterThan(0);
  });

  it('flags agent.error as error', () => {
    const c = cleanCassette();
    c.events.push({
      id: 'err1', seq: 5, at: new Date(0).toISOString(), type: 'agent.error', message: 'boom',
    });
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'AGENT_ERROR')).toBe(true);
  });

  it('flags empty cassette as error', () => {
    const r = diagnoseCassette({ version: 1, meta: { recordedAt: '', redacted: false }, events: [] });
    expect(r.findings.some((f) => f.code === 'EMPTY')).toBe(true);
  });

  it('flags duplicate requestHash as info', () => {
    const c = cleanCassette();
    c.events.push({
      id: 'req2', seq: 5, at: new Date(0).toISOString(), type: 'llm.request',
      provider: 'other', model: 'm', messages: [], requestHash: 'h1', semanticHash: 's1',
    } as LLMRequestEvent);
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'DUP_REQUEST')).toBe(true);
    expect(r.counts.info).toBeGreaterThan(0);
  });

  it('flags missing semanticHash as info for old cassettes', () => {
    const c = cleanCassette();
    delete (c.events[0] as LLMRequestEvent).semanticHash;
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'NO_SEMANTIC_HASH')).toBe(true);
  });

  it('flags orphan llm.response as error', () => {
    const c = cleanCassette();
    (c.events[1] as LLMResponseEvent).requestId = 'unknown';
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'ORPHAN_RESPONSE')).toBe(true);
  });

  it('flags llm.request with no response as warning', () => {
    const c = cleanCassette();
    c.events = c.events.filter((e) => e.type !== 'llm.response');
    const r = diagnoseCassette(c);
    expect(r.findings.some((f) => f.code === 'MISSING_RESPONSE')).toBe(true);
  });
});

describe('doctorExitCode', () => {
  it('returns 1 when there are errors', () => {
    const r = diagnoseCassette({ version: 1, meta: { recordedAt: '', redacted: false }, events: [] });
    expect(doctorExitCode(r)).toBe(1);
  });

  it('returns 0 when there are only warnings/info', () => {
    const c = cleanCassette();
    delete (c.events[1] as LLMResponseEvent).usage;
    const r = diagnoseCassette(c);
    expect(r.counts.error).toBe(0);
    expect(doctorExitCode(r)).toBe(0);
  });
});
