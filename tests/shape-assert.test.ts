import { describe, expect, it } from 'vitest';
import { runAssertions } from '../src/assert/engine.js';
import { checkAnswerShape, checkFlowUsesResult } from '../src/assert/matchers/structure.js';
import type {
  Assertion,
  LLMRequestEvent,
  LLMResponseEvent,
  ToolCallEvent,
  ToolResultEvent,
  TraceEvent,
} from '../src/types.js';

function response(text: string, step = 0, id = `res-${step}`): TraceEvent[] {
  return [
    {
      id: `req-${step}`,
      seq: step * 2,
      at: new Date(0).toISOString(),
      type: 'llm.request',
      provider: 'other',
      model: 'm',
      messages: [{ role: 'user', content: `q${step}` }],
      requestHash: `h${step}`,
    } as LLMRequestEvent,
    {
      id,
      seq: step * 2 + 1,
      at: new Date(0).toISOString(),
      type: 'llm.response',
      requestId: `req-${step}`,
      status: 200,
      output: text,
    } as LLMResponseEvent,
  ];
}

const shape = (a: Partial<Extract<Assertion, { kind: 'answer.shape' }>>): Assertion =>
  ({ kind: 'answer.shape', ...a } as Assertion);

describe('answer.shape — structured output assertions', () => {
  const payload = {
    id: 'ord_10293',
    count: 3,
    ratio: 0.5,
    active: true,
    nothing: null,
    tags: ['a', 'b'],
    meta: { zone: 'eu-west' },
  };
  const events = response(JSON.stringify(payload));

  it('passes a valid JSON answer with no field checks', () => {
    const r = checkAnswerShape(events, { kind: 'answer.shape' });
    expect(r.status).toBe('pass');
  });

  it('fails when the answer is not parseable JSON', () => {
    const r = checkAnswerShape(response('sorry, I cannot'), {
      kind: 'answer.shape',
    });
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/not valid JSON/i);
  });

  it('checks required paths present and missing', () => {
    const ok = checkAnswerShape(events, { kind: 'answer.shape', required: ['$.id', '$.meta.zone'] });
    expect(ok.status).toBe('pass');
    const bad = checkAnswerShape(events, { kind: 'answer.shape', required: ['$.missing'] });
    expect(bad.status).toBe('fail');
    expect(bad.message).toContain('$.missing');
  });

  it('validates every primitive type', () => {
    const r = checkAnswerShape(events, {
      kind: 'answer.shape',
      fields: {
        '$.id': 'string',
        '$.count': 'integer',
        '$.ratio': 'number',
        '$.active': 'boolean',
        '$.tags': 'array',
        '$.meta': 'object',
        '$.nothing': 'null',
      },
    });
    expect(r.status).toBe('pass');
  });

  it('flags a type mismatch with actual vs expected', () => {
    const r = checkAnswerShape(events, { kind: 'answer.shape', fields: { '$.count': 'string' } });
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/expected string/);
  });

  it('supports equals (key-order insensitive), contains, matches and enum', () => {
    const eq = checkAnswerShape(events, {
      kind: 'answer.shape',
      fields: { '$.meta': { equals: { zone: 'eu-west' } } },
    });
    expect(eq.status).toBe('pass');
    const contains = checkAnswerShape(events, {
      kind: 'answer.shape',
      fields: { '$.id': { contains: '10293' } },
    });
    expect(contains.status).toBe('pass');
    const matches = checkAnswerShape(events, {
      kind: 'answer.shape',
      fields: { '$.id': { matches: '^ord_\\d+$' } },
    });
    expect(matches.status).toBe('pass');
    const enumOk = checkAnswerShape(events, {
      kind: 'answer.shape',
      fields: { '$.active': { enum: [true, false] } },
    });
    expect(enumOk.status).toBe('pass');
    const enumBad = checkAnswerShape(events, {
      kind: 'answer.shape',
      fields: { '$.count': { enum: [1, 2] } },
    });
    expect(enumBad.status).toBe('fail');
  });

  it('walks wildcard paths and checks every element', () => {
    const ok = checkAnswerShape(events, { kind: 'answer.shape', fields: { '$.tags[*]': 'string' } });
    expect(ok.status).toBe('pass');
    const bad = checkAnswerShape(
      response(JSON.stringify({ tags: ['ok', 7] })),
      { kind: 'answer.shape', fields: { '$.tags[*]': 'string' } },
    );
    expect(bad.status).toBe('fail');
  });

  it('rejects a catastrophic field regex as fail, never hang', () => {
    const r = checkAnswerShape(events, {
      kind: 'answer.shape',
      fields: { '$.id': { matches: '(a+)+' } },
    });
    expect(r.status).toBe('fail');
  });

  it('honors the step selector', async () => {
    const two = [
      ...response(JSON.stringify({ ok: true }), 0),
      ...response('plain text final', 1),
    ];
    const [first, last] = await runAssertions(two, [
      shape({ step: 1 }),
      shape({}),
    ]);
    expect(first.status).toBe('pass');
    expect(last.status).toBe('fail'); // final answer is not JSON
  });
});

function toolTrajectory(finalAnswer: string, resultOutput: unknown): TraceEvent[] {
  return [
    {
      id: 'c1',
      seq: 0,
      at: new Date(0).toISOString(),
      type: 'tool.call',
      name: 'lookup_order',
      callId: 'call-1',
      arguments: { ref: 'x' },
    } as ToolCallEvent,
    {
      id: 'r1',
      seq: 1,
      at: new Date(0).toISOString(),
      type: 'tool.result',
      callId: 'call-1',
      output: resultOutput,
    } as ToolResultEvent,
    ...response(finalAnswer, 0),
  ];
}

describe('flow.usesResult — answer must consume tool output', () => {
  it('passes when the final answer cites a value the tool returned', () => {
    const events = toolTrajectory('Your order ord_10293 is confirmed.', { orderId: 'ord_10293' });
    const r = checkFlowUsesResult(events, { kind: 'flow.usesResult', tool: 'lookup_order' });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('lookup_order');
  });

  it('fails when the answer ignores every tool value (hallucination guard)', () => {
    const events = toolTrajectory('Your order will arrive soon.', { orderId: 'ord_10293' });
    const r = checkFlowUsesResult(events, { kind: 'flow.usesResult', tool: 'lookup_order' });
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/ignores/i);
  });

  it('uses fromPath to pick a specific nested value', () => {
    const events = toolTrajectory('tracking code T-9981', { data: { tracking: 'T-9981' } });
    const ok = checkFlowUsesResult(events, {
      kind: 'flow.usesResult',
      tool: 'lookup_order',
      fromPath: '$.data.tracking',
    });
    expect(ok.status).toBe('pass');
  });

  it('requires minHits distinct values', () => {
    const events = toolTrajectory('only AAA1 here', { codes: ['AAA1', 'BBB2'] });
    const one = checkFlowUsesResult(events, { kind: 'flow.usesResult', tool: 'lookup_order', minHits: 1 });
    const two = checkFlowUsesResult(events, { kind: 'flow.usesResult', tool: 'lookup_order', minHits: 2 });
    expect(one.status).toBe('pass');
    expect(two.status).toBe('fail');
  });

  it('fails cleanly when the tool was never called', () => {
    const events = response('nothing used');
    const r = checkFlowUsesResult(events, { kind: 'flow.usesResult', tool: 'ghost' });
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/no result recorded/i);
  });

  it('runs through the engine like any assertion kind', async () => {
    const events = toolTrajectory('cited ord_10293', { orderId: 'ord_10293' });
    const [r] = await runAssertions(events, [{ kind: 'flow.usesResult', tool: 'lookup_order' } as Assertion]);
    expect(r.status).toBe('pass');
  });
});
