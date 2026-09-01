import type {
  Assertion,
  AssertResult,
  LLMResponseEvent,
  TraceEvent,
  ToolCallEvent,
} from '../types.js';

/**
 * Pure assertion engine: (events, assertions) -> results.
 * No I/O, no network — this is what makes tests deterministic.
 *
 * Implemented in M0: tool.called, tool.order, forbid.tool,
 * answer.contains, answer.matches, budget.maxTokens, budget.maxSteps.
 * Scaffolded (status=todo): tool.args, answer.judge.
 */

export function runAssertions(events: TraceEvent[], assertions: Assertion[]): AssertResult[] {
  return assertions.map((assertion) => evaluate(events, assertion));
}

function evaluate(events: TraceEvent[], assertion: Assertion): AssertResult {
  switch (assertion.kind) {
    case 'tool.called': {
      const hits = events.filter(
        (e): e is ToolCallEvent => e.type === 'tool.call' && e.name === assertion.name,
      );
      if (assertion.times === undefined) {
        return ok(
          hits.length >= 1,
          assertion,
          hits.length >= 1
            ? `tool "${assertion.name}" called ${hits.length} time(s)`
            : `tool "${assertion.name}" was never called`,
        );
      }
      return ok(
        hits.length === assertion.times,
        assertion,
        `tool "${assertion.name}" called ${hits.length}/${assertion.times} time(s)`,
      );
    }

    case 'forbid.tool': {
      const hit = events.some((e) => e.type === 'tool.call' && (e as ToolCallEvent).name === assertion.name);
      return ok(
        !hit,
        assertion,
        hit ? `forbidden tool "${assertion.name}" was called` : `forbidden tool "${assertion.name}" not called`,
      );
    }

    case 'tool.order': {
      let cursor = 0;
      for (const name of assertion.names) {
        const next = events.findIndex(
          (e, i) => i >= cursor && e.type === 'tool.call' && (e as ToolCallEvent).name === name,
        );
        if (next === -1) {
          return ok(
            false,
            assertion,
            `expected order ${assertion.names.join(' -> ')}, missing "${name}" after position ${cursor}`,
          );
        }
        cursor = next + 1;
      }
      return ok(true, assertion, `tools called in expected order: ${assertion.names.join(' -> ')}`);
    }

    case 'answer.contains': {
      const text = extractAnswerText(events);
      const found = text.includes(assertion.text);
      return ok(found, assertion, found ? `answer contains "${assertion.text}"` : `answer does not contain "${assertion.text}"`);
    }

    case 'answer.matches': {
      const text = extractAnswerText(events);
      const found = new RegExp(assertion.regex).test(text);
      return ok(found, assertion, found ? `answer matches /${assertion.regex}/` : `answer does not match /${assertion.regex}/`);
    }

    case 'budget.maxTokens': {
      const used = events.reduce((sum, e) => {
        if (e.type !== 'llm.response') return sum;
        const usage = (e as LLMResponseEvent).usage;
        return sum + (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
      }, 0);
      return ok(used <= assertion.value, assertion, `used ${used} tokens, budget ${assertion.value}`);
    }

    case 'budget.maxSteps': {
      const steps = events.filter((e) => e.type === 'llm.request').length;
      return ok(steps <= assertion.value, assertion, `${steps} LLM step(s), budget ${assertion.value}`);
    }

    case 'tool.args':
    case 'answer.judge':
      return {
        status: 'todo',
        assertion,
        message: `assertion "${assertion.kind}" is scheduled for M3 — see ROADMAP.md`,
      };
  }
}

function ok(passed: boolean, assertion: Assertion, message: string): AssertResult {
  return { status: passed ? 'pass' : 'fail', assertion, message };
}

/** Concatenated text of the last llm.response in the trace. */
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
