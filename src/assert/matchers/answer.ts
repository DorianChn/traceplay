import type { Assertion, AssertResult, LLMResponseEvent, TraceEvent } from '../../types.js';
import { judgeAnswer } from '../judge.js';

export function extractAnswerText(events: TraceEvent[]): string {
  const responses = events.filter((e): e is LLMResponseEvent => e.type === 'llm.response');
  const last = responses[responses.length - 1];
  return last ? toText(last.output) : '';
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
  const text = extractAnswerText(events);
  const found = text.includes(assertion.text);
  return {
    status: found ? 'pass' : 'fail',
    assertion,
    message: found ? `answer contains "${assertion.text}"` : `answer does not contain "${assertion.text}"`,
  };
}

export function checkAnswerMatches(events: TraceEvent[], assertion: Extract<Assertion, { kind: 'answer.matches' }>): AssertResult {
  const text = extractAnswerText(events);
  const found = new RegExp(assertion.regex).test(text);
  return {
    status: found ? 'pass' : 'fail',
    assertion,
    message: found ? `answer matches /${assertion.regex}/` : `answer does not match /${assertion.regex}/`,
  };
}

export async function checkAnswerJudge(
  events: TraceEvent[],
  assertion: Extract<Assertion, { kind: 'answer.judge' }>,
): Promise<AssertResult> {
  const answer = extractAnswerText(events);
  const result = await judgeAnswer(answer, assertion.rubric, { model: assertion.model });
  if (result.status === 'todo') {
    return { status: 'todo', assertion, message: `answer.judge: ${result.message}` };
  }
  return {
    status: result.passed ? 'pass' : 'fail',
    assertion,
    message: `answer.judge: ${result.passed ? 'PASS' : 'FAIL'} — ${result.reason}`,
  };
}
