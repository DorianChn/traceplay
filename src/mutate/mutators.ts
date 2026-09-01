import type { Assertion, LLMResponseEvent, TraceEvent, ToolCallEvent, ToolResultEvent } from '../types.js';
import { responseAtStep } from '../assert/matchers/answer.js';

export type MutationKind =
  | 'answer.text'
  | 'answer.drop'
  | 'tool.drop-call'
  | 'tool.inject-forbidden'
  | 'tool.args'
  | 'budget.tokens'
  | 'budget.steps';

export interface Mutator {
  kind: MutationKind;
  description: string;
  /** Assertion kinds this mutation can meaningfully challenge. */
  targets: Assertion['kind'][];
  /**
   * Return a mutated deep-copy of the events that should make `assertion`
   * FAIL, or null when the cassette does not contain the thing to mutate.
   */
  apply(events: TraceEvent[], assertion: Assertion): TraceEvent[] | null;
}

const MUTATED_ANSWER = '__TRACEPLAY_MUTATED_ANSWER__';

function clone(events: TraceEvent[]): TraceEvent[] {
  return structuredClone(events) as TraceEvent[];
}

function stepOf(assertion: Assertion): number | undefined {
  return 'step' in assertion ? assertion.step : undefined;
}

/** Mutate the response targeted by an answer.* assertion (by step or last). */
function mutateTargetedResponse(
  events: TraceEvent[],
  assertion: Assertion,
  transform: (response: LLMResponseEvent) => void,
): TraceEvent[] | null {
  const target = responseAtStep(events, stepOf(assertion));
  if (!target) return null;
  const copy = clone(events);
  const mutated = copy.find((e) => e.id === target.id && e.type === 'llm.response') as
    | LLMResponseEvent
    | undefined;
  if (!mutated) return null;
  transform(mutated);
  return copy;
}

/** Recursively perturb primitive leaves so an equality match must fail. */
function perturb(value: unknown): unknown {
  if (typeof value === 'string') return `${value}__mutated`;
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (Array.isArray(value)) return value.map(perturb);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = perturb(v);
    return out;
  }
  return value;
}

export const MUTATORS: Mutator[] = [
  {
    kind: 'answer.text',
    description: 'Replace the targeted answer text with a fixed wrong answer.',
    targets: ['answer.contains', 'answer.matches', 'answer.judge'],
    apply: (events, assertion) =>
      mutateTargetedResponse(events, assertion, (res) => {
        res.output = MUTATED_ANSWER;
        res.rawBody = JSON.stringify({ mutated: true });
      }),
  },
  {
    kind: 'answer.drop',
    description: 'Empty the targeted answer.',
    targets: ['answer.contains', 'answer.matches', 'answer.judge'],
    apply: (events, assertion) =>
      mutateTargetedResponse(events, assertion, (res) => {
        res.output = '';
        res.rawBody = '';
      }),
  },
  {
    kind: 'tool.drop-call',
    description: 'Remove a recorded tool call (and its result) from the trace.',
    targets: ['tool.called', 'tool.order'],
    apply: (events, assertion) => {
      const name = 'name' in assertion ? assertion.name : undefined;
      const target = events.find(
        (e) => e.type === 'tool.call' && (name === undefined || (e as ToolCallEvent).name === name),
      ) as ToolCallEvent | undefined;
      if (!target) return null;
      const removedIds = new Set<string>([target.id]);
      // Also remove the linked result.
      const linkedResult = events.find(
        (e) => e.type === 'tool.result' && (e as ToolResultEvent).callId === target.callId,
      ) as ToolResultEvent | undefined;
      if (linkedResult) removedIds.add(linkedResult.id);
      return clone(events).filter((e) => !removedIds.has(e.id));
    },
  },
  {
    kind: 'tool.inject-forbidden',
    description: 'Inject a call to the tool that a forbid.tool assertion bans.',
    targets: ['forbid.tool'],
    apply: (events, assertion) => {
      if (!('name' in assertion)) return null;
      const copy = clone(events);
      const seq = copy.length;
      copy.push({
        id: `mut-tool-${seq}`,
        seq,
        at: new Date(0).toISOString(),
        type: 'tool.call',
        name: assertion.name,
        callId: `mut-call-${seq}`,
        arguments: { mutated: true },
      });
      return copy;
    },
  },
  {
    kind: 'tool.args',
    description: 'Perturb every primitive value in the targeted tool call arguments.',
    targets: ['tool.args'],
    apply: (events, assertion) => {
      const name = 'name' in assertion ? assertion.name : undefined;
      const target = events.find(
        (e) => e.type === 'tool.call' && (name === undefined || (e as ToolCallEvent).name === name),
      ) as ToolCallEvent | undefined;
      if (!target) return null;
      const copy = clone(events);
      const mutated = copy.find((e) => e.id === target.id) as ToolCallEvent | undefined;
      if (!mutated) return null;
      mutated.arguments = perturb(mutated.arguments);
      return copy;
    },
  },
  {
    kind: 'budget.tokens',
    description: 'Inflate every recorded token count 100x to blow a token budget.',
    targets: ['budget.maxTokens'],
    apply: (events) => {
      const hasUsage = events.some((e) => e.type === 'llm.response' && (e as LLMResponseEvent).usage);
      if (!hasUsage) return null;
      const copy = clone(events);
      for (const e of copy) {
        if (e.type === 'llm.response' && (e as LLMResponseEvent).usage) {
          const res = e as LLMResponseEvent;
          res.usage = {
            promptTokens: (res.usage?.promptTokens ?? 0) * 100,
            completionTokens: (res.usage?.completionTokens ?? 0) * 100,
          };
        }
      }
      return copy;
    },
  },
  {
    kind: 'budget.steps',
    description: 'Append an extra LLM request/response step to blow a step budget.',
    targets: ['budget.maxSteps'],
    apply: (events) => {
      const copy = clone(events);
      const seq = copy.length;
      copy.push({
        id: `mut-req-${seq}`,
        seq,
        at: new Date(0).toISOString(),
        type: 'llm.request',
        provider: 'other',
        model: 'mutated',
        messages: [{ role: 'user', content: 'mutated extra step' }],
        requestHash: `mutated-${seq}`,
      });
      copy.push({
        id: `mut-res-${seq + 1}`,
        seq: seq + 1,
        at: new Date(0).toISOString(),
        type: 'llm.response',
        requestId: `mut-req-${seq}`,
        status: 200,
        output: { mutated: true },
      });
      return copy;
    },
  },
];

export function mutatorsFor(kind: Assertion['kind']): Mutator[] {
  return MUTATORS.filter((m) => m.targets.includes(kind));
}
