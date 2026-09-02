import type {
  Assertion,
  AssertResult,
  ShapeFieldExpect,
  ShapeFieldSpec,
  ShapeType,
  ToolCallEvent,
  ToolResultEvent,
  TraceEvent,
} from '../../types.js';
import { jsonPath } from '../../core/jsonpath.js';
import { deepEqual } from '../../core/equal.js';
import { compileUserRegex } from '../../core/regex-safe.js';
import { extractAnswerText, responseAtStep } from './answer.js';

function stepLabel(step?: number): string {
  return typeof step === 'number' && step > 0 ? ` [step ${step}]` : '';
}

function fail(assertion: Assertion, message: string): AssertResult {
  return { status: 'fail', assertion, message };
}

function pass(assertion: Assertion, message: string): AssertResult {
  return { status: 'pass', assertion, message };
}

/* ------------------------------------------------------------------ *
 * answer.shape — structured-output (JSON-mode / tool-schema) checks  *
 * ------------------------------------------------------------------ */

function matchesType(value: unknown, type: ShapeType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function normalizeSpec(spec: ShapeFieldSpec): ShapeFieldExpect {
  return typeof spec === 'string' ? { type: spec } : spec;
}

function checkFieldExpect(path: string, value: unknown, spec: ShapeFieldSpec): string | undefined {
  const expect = normalizeSpec(spec);
  if (expect.type && !matchesType(value, expect.type)) {
    return `${path}: expected ${expect.type}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`;
  }
  if ('equals' in expect && expect.equals !== undefined && !deepEqual(value, expect.equals)) {
    return `${path}: expected to equal ${JSON.stringify(expect.equals)}, got ${JSON.stringify(value)}`;
  }
  if (expect.contains !== undefined) {
    const asText = typeof value === 'string' ? value : JSON.stringify(value);
    if (!asText.includes(expect.contains)) return `${path}: "${asText}" does not contain "${expect.contains}"`;
  }
  if (expect.matches !== undefined) {
    try {
      const re = compileUserRegex(expect.matches);
      const asText = typeof value === 'string' ? value : JSON.stringify(value);
      if (!re.test(asText)) return `${path}: "${asText}" does not match /${expect.matches}/`;
    } catch (err) {
      return `${path}: ${(err as Error).message}`;
    }
  }
  if (Array.isArray(expect.enum) && !expect.enum.some((candidate) => deepEqual(value, candidate))) {
    return `${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(expect.enum)}`;
  }
  return undefined;
}

export function checkAnswerShape(
  events: TraceEvent[],
  assertion: Extract<Assertion, { kind: 'answer.shape' }>,
): AssertResult {
  const label = stepLabel(assertion.step);
  const requireJson = assertion.json !== false;
  const rawText = extractAnswerText(events, assertion.step);

  if (!responseAtStep(events, assertion.step)) {
    return fail(assertion, `answer.shape${label}: no response at that step`);
  }

  let root: unknown = rawText;
  if (requireJson) {
    try {
      root = JSON.parse(rawText);
    } catch {
      return fail(assertion, `answer.shape${label}: answer is not valid JSON: ${truncate(rawText, 80)}`);
    }
  }

  const problems: string[] = [];
  let checked = 0;

  for (const requiredPath of assertion.required ?? []) {
    const hits = jsonPath(root, requiredPath);
    if (hits.length === 0) problems.push(`${requiredPath}: required but missing`);
    else checked += 1;
  }

  for (const [path, spec] of Object.entries(assertion.fields ?? {})) {
    const hits = jsonPath(root, path);
    if (hits.length === 0) {
      problems.push(`${path}: not found`);
      continue;
    }
    for (const hit of hits) {
      checked += 1;
      const problem = checkFieldExpect(path, hit, spec);
      if (problem) problems.push(problem);
    }
  }

  if (problems.length > 0) {
    return fail(assertion, `answer.shape${label} failed — ${problems.join('; ')}`);
  }
  const fieldCount = (assertion.required?.length ?? 0) + Object.keys(assertion.fields ?? {}).length;
  return pass(
    assertion,
    fieldCount === 0
      ? `answer.shape${label}: valid JSON`
      : `answer.shape${label}: ${checked} field check(s) passed`,
  );
}

/* ------------------------------------------------------------------ *
 * flow.usesResult — later answer must use an earlier tool result     *
 * ------------------------------------------------------------------ */

/** Minimum length for a string leaf to count as a citable value. */
const MIN_LEAF_LEN = 3;
/** Above this length a string is treated as serialized blob, not a leaf. */
const MAX_LEAF_LEN = 120;

function collectLeaves(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(String(value));
    return;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.length >= MIN_LEAF_LEN && t.length <= MAX_LEAF_LEN) out.add(t);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLeaves(item, out);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectLeaves(v, out);
  }
}

/** Tool results emitted by calls of the given tool name (linked by callId). */
function toolResultsByName(events: TraceEvent[], toolName: string): ToolResultEvent[] {
  const callIds = new Set<string>();
  for (const e of events) {
    if (e.type === 'tool.call' && (e as ToolCallEvent).name === toolName) {
      const id = (e as ToolCallEvent).callId;
      if (id) callIds.add(id);
    }
  }
  return events.filter(
    (e): e is ToolResultEvent => e.type === 'tool.result' && callIds.has((e as ToolResultEvent).callId),
  );
}

export function checkFlowUsesResult(
  events: TraceEvent[],
  assertion: Extract<Assertion, { kind: 'flow.usesResult' }>,
): AssertResult {
  const label = stepLabel(assertion.step);
  const results = toolResultsByName(events, assertion.tool);
  if (results.length === 0) {
    return fail(assertion, `flow.usesResult: no result recorded for tool "${assertion.tool}"`);
  }

  const sourceValues = new Set<string>();
  for (const result of results) {
    if (assertion.fromPath) {
      for (const picked of jsonPath(result.output, assertion.fromPath)) collectLeaves(picked, sourceValues);
    } else {
      collectLeaves(result.output, sourceValues);
    }
  }
  if (sourceValues.size === 0) {
    return fail(
      assertion,
      `flow.usesResult${label}: tool "${assertion.tool}" produced no citable value${
        assertion.fromPath ? ` at ${assertion.fromPath}` : ''
      }`,
    );
  }

  const answer = extractAnswerText(events, assertion.step).toLowerCase();
  const minHits = Math.max(1, assertion.minHits ?? 1);
  const matched: string[] = [];
  for (const candidate of sourceValues) {
    if (answer.includes(candidate.toLowerCase())) matched.push(candidate);
  }

  if (matched.length >= minHits) {
    return pass(
      assertion,
      `flow.usesResult${label}: answer uses ${matched.length} value(s) from "${assertion.tool}" (e.g. ${truncate(
        matched[0],
        40,
      )})`,
    );
  }
  return fail(
    assertion,
    `flow.usesResult${label}: answer ignores "${assertion.tool}" — used ${matched.length}/${sourceValues.size} of its values, need ${minHits}`,
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
