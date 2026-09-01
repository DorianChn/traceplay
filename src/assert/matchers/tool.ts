import type { Assertion, AssertResult, TraceEvent, ToolCallEvent } from '../../types.js';
import { jsonPath } from '../../core/jsonpath.js';

export function checkToolCalled(events: TraceEvent[], assertion: Extract<Assertion, { kind: 'tool.called' }>): AssertResult {
  const hits = events.filter(
    (e): e is ToolCallEvent => e.type === 'tool.call' && e.name === assertion.name,
  );
  if (assertion.times === undefined) {
    return {
      status: hits.length >= 1 ? 'pass' : 'fail',
      assertion,
      message:
        hits.length >= 1
          ? `tool "${assertion.name}" called ${hits.length} time(s)`
          : `tool "${assertion.name}" was never called`,
    };
  }
  return {
    status: hits.length === assertion.times ? 'pass' : 'fail',
    assertion,
    message: `tool "${assertion.name}" called ${hits.length}/${assertion.times} time(s)`,
  };
}

export function checkToolOrder(events: TraceEvent[], assertion: Extract<Assertion, { kind: 'tool.order' }>): AssertResult {
  let cursor = 0;
  for (const name of assertion.names) {
    const next = events.findIndex(
      (e, i) => i >= cursor && e.type === 'tool.call' && (e as ToolCallEvent).name === name,
    );
    if (next === -1) {
      return {
        status: 'fail',
        assertion,
        message: `expected order ${assertion.names.join(' -> ')}, missing "${name}" after position ${cursor}`,
      };
    }
    cursor = next + 1;
  }
  return {
    status: 'pass',
    assertion,
    message: `tools called in expected order: ${assertion.names.join(' -> ')}`,
  };
}

export function checkToolArgs(events: TraceEvent[], assertion: Extract<Assertion, { kind: 'tool.args' }>): AssertResult {
  const calls = events.filter(
    (e): e is ToolCallEvent => e.type === 'tool.call' && e.name === assertion.name,
  );
  if (calls.length === 0) {
    return { status: 'fail', assertion, message: `tool "${assertion.name}" was never called` };
  }
  for (const call of calls) {
    const matches = jsonPath(call.arguments, assertion.jsonPath);
    if (assertion.equals !== undefined) {
      const hit = matches.some((m) => JSON.stringify(m) === JSON.stringify(assertion.equals));
      if (!hit) continue;
      return {
        status: 'pass',
        assertion,
        message: `tool "${assertion.name}" args at ${assertion.jsonPath} equals ${JSON.stringify(assertion.equals)}`,
      };
    }
    if (assertion.matches !== undefined) {
      const re = new RegExp(assertion.matches);
      const hit = matches.some((m) => re.test(typeof m === 'string' ? m : JSON.stringify(m)));
      if (!hit) continue;
      return {
        status: 'pass',
        assertion,
        message: `tool "${assertion.name}" args at ${assertion.jsonPath} matches /${assertion.matches}/`,
      };
    }
  }
  return {
    status: 'fail',
    assertion,
    message: `no call of tool "${assertion.name}" matched ${assertion.jsonPath} ${assertion.equals !== undefined ? `equals ${JSON.stringify(assertion.equals)}` : `matches /${assertion.matches}/`}`,
  };
}

export function checkForbidTool(events: TraceEvent[], assertion: Extract<Assertion, { kind: 'forbid.tool' }>): AssertResult {
  const hit = events.some((e) => e.type === 'tool.call' && (e as ToolCallEvent).name === assertion.name);
  return {
    status: hit ? 'fail' : 'pass',
    assertion,
    message: hit ? `forbidden tool "${assertion.name}" was called` : `forbidden tool "${assertion.name}" not called`,
  };
}
