import { describe, expect, it } from 'vitest';
import { runAssertions } from '../src/assert/engine.js';
import {
  extractAnswerText,
  responseAtStep,
  listResponses,
} from '../src/assert/matchers/answer.js';
import { isLikelyCatastrophic, compileUserRegex } from '../src/core/regex-safe.js';
import type { Assertion, LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../src/types.js';

/** Three request/response pairs whose answers are alpha / beta / gamma. */
function threeStep(): TraceEvent[] {
  const answers = ['alpha', 'beta', 'gamma'];
  const events: TraceEvent[] = [];
  answers.forEach((text, i) => {
    events.push({
      id: `req-${i}`,
      seq: i * 2,
      at: new Date(0).toISOString(),
      type: 'llm.request',
      provider: 'other',
      model: 'm',
      messages: [{ role: 'user', content: `q${i}` }],
      requestHash: `h${i}`,
    } as LLMRequestEvent);
    events.push({
      id: `res-${i}`,
      seq: i * 2 + 1,
      at: new Date(0).toISOString(),
      type: 'llm.response',
      requestId: `req-${i}`,
      status: 200,
      output: text,
    } as LLMResponseEvent);
  });
  return events;
}

const contains = (text: string, step?: number): Assertion =>
  ({ kind: 'answer.contains', text, ...(step ? { step } : {}) } as Assertion);
const matches = (regex: string, step?: number): Assertion =>
  ({ kind: 'answer.matches', regex, ...(step ? { step } : {}) } as Assertion);

describe('R11 multi-step answer selection', () => {
  const events = threeStep();

  it('helpers expose responses in order', () => {
    expect(listResponses(events)).toHaveLength(3);
    expect(extractAnswerText(events)).toBe('gamma'); // default = last
    expect(extractAnswerText(events, 1)).toBe('alpha');
    expect(extractAnswerText(events, 2)).toBe('beta');
    expect(extractAnswerText(events, 3)).toBe('gamma');
    expect(extractAnswerText(events, 99)).toBe(''); // out of range → empty
    expect(responseAtStep(events, 0)?.id).toBe('res-2'); // 0/negative → last
  });

  it('answer.contains defaults to the final answer (back-compat)', async () => {
    const [ok, miss] = await runAssertions(events, [contains('gamma'), contains('alpha')]);
    expect(ok.status).toBe('pass');
    expect(miss.status).toBe('fail');
  });

  it('answer.contains with step targets an intermediate answer', async () => {
    const results = await runAssertions(events, [
      contains('alpha', 1),
      contains('beta', 2),
      contains('gamma', 1), // step 1 is alpha, not gamma → fail
    ]);
    expect(results.map((r) => r.status)).toEqual(['pass', 'pass', 'fail']);
    expect(results[0].message).toContain('[step 1]');
  });

  it('answer.matches with step targets the intermediate step', async () => {
    const results = await runAssertions(events, [matches(/^alp/.source, 1), matches(/^alp/.source, 2)]);
    expect(results[0].status).toBe('pass');
    expect(results[1].status).toBe('fail');
  });
});

describe('§6.4 ReDoS guard for user-supplied regexes', () => {
  it('flags classic nested-quantifier catastrophic shapes', () => {
    expect(isLikelyCatastrophic('(a+)+$')).toBe(true);
    expect(isLikelyCatastrophic('(.*)*')).toBe(true);
    expect(isLikelyCatastrophic('(\\w+){2,}')).toBe(true);
  });

  it('leaves ordinary patterns alone', () => {
    expect(isLikelyCatastrophic('^answer: \\d+$')).toBe(false);
    expect(isLikelyCatastrophic('hello\\s+world')).toBe(false);
    expect(isLikelyCatastrophic('')).toBe(false);
  });

  it('compileUserRegex throws on a catastrophic pattern and compiles a normal one', () => {
    expect(() => compileUserRegex('(a+)+')).toThrow(/catastrophic/i);
    expect(compileUserRegex('ok-\\d+').test('ok-42')).toBe(true);
  });

  it('an answer.matches assertion with a catastrophic regex fails instead of hanging', async () => {
    const events = threeStep();
    const [r] = await runAssertions(events, [matches('(a+)+$')]);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/catastrophic|ReDoS/i);
  });
});
