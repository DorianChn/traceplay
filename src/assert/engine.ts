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
import { checkAnswerShape, checkFlowUsesResult } from './matchers/structure.js';
import { checkBudgetMaxTokens, checkBudgetMaxSteps } from './matchers/budget.js';
import { getCustomAssertion } from './registry.js';

/**
 * Assertion engine — pure (except answer.judge which may do a cached
 * network call). Dispatches each assertion to its matcher. Unknown kinds
 * fall through to the plugin registry (see src/assert/registry.ts).
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
    case 'answer.shape':
      return checkAnswerShape(events, assertion);
    case 'flow.usesResult':
      return checkFlowUsesResult(events, assertion);
    case 'budget.maxTokens':
      return checkBudgetMaxTokens(events, assertion);
    case 'budget.maxSteps':
      return checkBudgetMaxSteps(events, assertion);
    default: {
      // Custom / plugin assertion kinds.
      const kind = (assertion as unknown as { kind: string }).kind;
      const custom = getCustomAssertion(kind);
      if (!custom) {
        return {
          status: 'fail',
          assertion,
          message: `unknown assertion kind: ${kind} (register a plugin via registerAssertion)`,
        };
      }
      try {
        return await custom({
          events,
          assertion: assertion as unknown as Record<string, unknown>,
        });
      } catch (err) {
        return {
          status: 'fail',
          assertion,
          message: `custom assertion "${kind}" error: ${(err as Error).message}`,
        };
      }
    }
  }
}
