import type { Assertion, AssertResult, LLMResponseEvent, TraceEvent } from '../../types.js';

export function checkBudgetMaxTokens(events: TraceEvent[], assertion: Extract<Assertion, { kind: 'budget.maxTokens' }>): AssertResult {
  const used = events.reduce((sum, e) => {
    if (e.type !== 'llm.response') return sum;
    const usage = (e as LLMResponseEvent).usage;
    return sum + (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
  }, 0);
  return {
    status: used <= assertion.value ? 'pass' : 'fail',
    assertion,
    message: `used ${used} tokens, budget ${assertion.value}`,
  };
}

export function checkBudgetMaxSteps(events: TraceEvent[], assertion: Extract<Assertion, { kind: 'budget.maxSteps' }>): AssertResult {
  const steps = events.filter((e) => e.type === 'llm.request').length;
  return {
    status: steps <= assertion.value ? 'pass' : 'fail',
    assertion,
    message: `${steps} LLM step(s), budget ${assertion.value}`,
  };
}
