import type { Assertion, AssertResult, TraceEvent } from '../types.js';
import {
  checkToolCalled,
  checkToolOrder,
  checkToolArgs,
  checkForbidTool,
} from './matchers/tool.js';
import {
  checkAnswerContains,
  checkAnswerMatches,
  checkAnswerJudge,
} from './matchers/answer.js';
import { checkBudgetMaxTokens, checkBudgetMaxSteps } from './matchers/budget.js';

/**
 * Assertion engine — pure (except answer.judge which may do a cached
 * network call). Dispatches each assertion to its matcher.
 */
export async function runAssertions(
  events: TraceEvent[],
  assertions: Assertion[],
): Promise<AssertResult[]> {
  const results: AssertResult[] = [];
  for (const assertion of assertions) {
    results.push(await evaluate(events, assertion));
  }
  return results;
}

async function evaluate(events: TraceEvent[], assertion: Assertion): Promise<AssertResult> {
  switch (assertion.kind) {
    case 'tool.called':
      return checkToolCalled(events, assertion);
    case 'tool.order':
      return checkToolOrder(events, assertion);
    case 'tool.args':
      return checkToolArgs(events, assertion);
    case 'forbid.tool':
      return checkForbidTool(events, assertion);
    case 'answer.contains':
      return checkAnswerContains(events, assertion);
    case 'answer.matches':
      return checkAnswerMatches(events, assertion);
    case 'answer.judge':
      return checkAnswerJudge(events, assertion);
    case 'budget.maxTokens':
      return checkBudgetMaxTokens(events, assertion);
    case 'budget.maxSteps':
      return checkBudgetMaxSteps(events, assertion);
  }
}
