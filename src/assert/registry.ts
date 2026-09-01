import type { AssertResult, TraceEvent } from '../types.js';

export interface CustomAssertionContext {
  events: TraceEvent[];
  /** The raw assertion object from the suite file (any extra fields included). */
  assertion: Record<string, unknown>;
}

export type CustomAssertionFn = (
  ctx: CustomAssertionContext,
) => Promise<AssertResult> | AssertResult;

/**
 * Plugin registry for custom assertion kinds.
 *
 * Register a matcher for an assertion kind the built-in engine doesn't know:
 *
 *   import { registerAssertion } from 'traceplay';
 *   registerAssertion('custom.length', ({ events, assertion }) => ({
 *     status: assertion.max < events.length ? 'pass' : 'fail',
 *     message: `events=${events.length}`,
 *   }));
 *
 * Then use it in suite.yaml:
 *   - { kind: custom.length, max: 5 }
 */
const registry = new Map<string, CustomAssertionFn>();

export function registerAssertion(kind: string, fn: CustomAssertionFn): void {
  registry.set(kind, fn);
}

export function getCustomAssertion(kind: string): CustomAssertionFn | undefined {
  return registry.get(kind);
}

export function hasCustomAssertion(kind: string): boolean {
  return registry.has(kind);
}

export function listCustomAssertions(): string[] {
  return [...registry.keys()];
}
