import type { Assertion, AssertResult, LLMResponseEvent, TraceEvent } from '../../types.js';
import { judgeAnswer } from '../judge.js';
import { compileUserRegex } from '../../core/regex-safe.js';

/** All llm.response events in timeline order. */
export function listResponses(events: TraceEvent[]): LLMResponseEvent[] {
  return events.filter((e): e is LLMResponseEvent => e.type === 'llm.response');
}

/**
 * Pick the response an answer assertion targets (R11).
 * `step` is 1-based among llm.response events; omitted/0/negative → the last
 * response (the v0.1–v0.5 default, so single-step suites are unchanged).
 */
export function responseAtStep(events: TraceEvent[], step?: number): LLMResponseEvent | undefined {
  const responses = listResponses(events);
  if (typeof step !== 'number' || !Number.isInteger(step) || step <= 0) {
    return responses[responses.length - 1];
  }
  return responses[step - 1];
}

export function extractAnswerText(events: TraceEvent[], step?: number): string {
  const target = responseAtStep(events, step);
  return target ? toText(target.output) : '';
}

/** Suffix for result messages so users see which step was asserted. */
function stepLabel(step?: number): string {
  return typeof step === 'number' && step > 0 ? ` [step ${step}]` : '';
}

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  const obj = value as Record<string, unknown>;
  // OpenAI-compatible: choices[0].message.content
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const first = obj.choices[0] as Record<string, unknown>;
    const message = first.message as Record<string, unknown> | undefined;
    if (typeof message?.content === 'string') return message.content;
    if (Array.isArray(message?.content)) return message.content.map(toText).join('\n');
    if (typeof first.text === 'string') return first.text;
  }
  // Anthropic-style: content[] blocks
  if (Array.isArray(obj.content)) return obj.content.map(toText).join('\n');
  if (typeof obj.text === 'string') return obj.text;
  return JSON.stringify(value);
}

export function checkAnswerContains(events: TraceEvent[], assertion: Extract<Assertion, { kind: 'answer.contains' }>): AssertResult {
  const text = extractAnswerText(events, assertion.step);
  const found = text.includes(assertion.text);
  const label = stepLabel(assertion.step);
  return {
    status: found ? 'pass' : 'fail',
    assertion,
    message: found
      ? `answer${label} contains "${assertion.text}"`
      : `answer${label} does not contain "${assertion.text}"`,
  };
}

export function checkAnswerMatches(events: TraceEvent[], assertion: Extract<Assertion, { kind: 'answer.matches' }>): AssertResult {
  const label = stepLabel(assertion.step);
  let re: RegExp;
  try {
    re = compileUserRegex(assertion.regex);
  } catch (err) {
    return { status: 'fail', assertion, message: `answer.matches${label}: ${(err as Error).message}` };
  }
  const text = extractAnswerText(events, assertion.step);
  const found = re.test(text);
  return {
    status: found ? 'pass' : 'fail',
    assertion,
    message: found
      ? `answer${label} matches /${assertion.regex}/`
      : `answer${label} does not match /${assertion.regex}/`,
  };
}

export async function checkAnswerJudge(
  events: TraceEvent[],
  assertion: Extract<Assertion, { kind: 'answer.judge' }>,
): Promise<AssertResult> {
  const answer = extractAnswerText(events, assertion.step);
  const result = await judgeAnswer(answer, assertion.rubric, { model: assertion.model });
  const label = stepLabel(assertion.step);
  if (result.status === 'todo') {
    return { status: 'todo', assertion, message: `answer.judge${label}: ${result.message}` };
  }
  return {
    status: result.passed ? 'pass' : 'fail',
    assertion,
    message: `answer.judge${label}: ${result.passed ? 'PASS' : 'FAIL'} — ${result.reason}`,
  };
}
