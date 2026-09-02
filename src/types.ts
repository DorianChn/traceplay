/**
 * Core trace model — shared by recorder, replayer, assertion engine and reporters.
 * Frozen for v0.1. Breaking changes require Cassette.version bump + migration.
 */

export type EventType =
  | 'user.message'
  | 'llm.request'
  | 'llm.response'
  | 'tool.call'
  | 'tool.result'
  | 'agent.error';

export interface BaseEvent {
  id: string;
  seq: number;
  at: string;
  type: EventType;
}

export interface UserMessageEvent extends BaseEvent {
  type: 'user.message';
  content: string;
}

export interface LLMRequestEvent extends BaseEvent {
  type: 'llm.request';
  provider: 'openai-compatible' | 'anthropic' | 'gemini' | 'other';
  model: string;
  /** Request path, e.g. /v1/chat/completions — used by replayer to route. */
  path?: string;
  messages: unknown[];
  temperature?: number;
  /** True when the client asked for a streaming response (SSE). */
  stream?: boolean;
  /** sha256 of canonicalized request body (volatile fields removed). */
  requestHash: string;
  /**
   * sha256 of the semantically-canonicalized comparable body (L1 layer):
   * whitespace folded, sampling noise removed. Recorded since v0.5; older
   * cassettes omit it and the matcher computes it on the fly.
   */
  semanticHash?: string;
  /**
   * Zero-based position of this request among the cassette's llm.request
   * events (the agent's step number). Recorded since v0.6 (R4); older
   * cassettes omit it and the session derives it from event order.
   */
  turn?: number;
  /**
   * Id of the previous llm.request in the same trajectory — the causal edge
   * that chains a multi-step agent ("previous result feeds the next prompt").
   * Undefined for the first request. Recorded since v0.6 (R4).
   */
  parentId?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LLMResponseEvent extends BaseEvent {
  type: 'llm.response';
  /** Id of the matching LLMRequestEvent. */
  requestId: string;
  status: number;
  /** Normalized answer payload — used by answer assertions. */
  output: unknown;
  /** Raw response body — used by replayer to return exact bytes. */
  rawBody?: string;
  /** Response headers (redacted) — used by replayer. */
  headers?: Record<string, string>;
  /** True when the recorded response was a streaming SSE response. */
  stream?: boolean;
  usage?: TokenUsage;
  latencyMs?: number;
}

export interface ToolCallEvent extends BaseEvent {
  type: 'tool.call';
  name: string;
  arguments: unknown;
  /** Correlates this call with its tool.result (R12). Recorded since v0.6. */
  callId?: string;
}

export interface ToolResultEvent extends BaseEvent {
  type: 'tool.result';
  callId: string;
  output: unknown;
  isError?: boolean;
}

export interface AgentErrorEvent extends BaseEvent {
  type: 'agent.error';
  message: string;
}

export type TraceEvent =
  | UserMessageEvent
  | LLMRequestEvent
  | LLMResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | AgentErrorEvent;

export interface CassetteMeta {
  recordedAt: string;
  redacted: boolean;
  providerBaseUrl?: string;
  project?: string;
}

/**
 * Cassette schema contract (R3). The on-disk format is versioned; bumping it
 * requires an explicit migration. v1 cassettes (v0.1–v0.4) remain readable.
 */
export const CURRENT_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];

export interface Cassette {
  version: 1;
  meta: CassetteMeta;
  events: TraceEvent[];
}

/** Primitive type names accepted by the answer.shape assertion (v0.7). */
export type ShapeType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

/** One field expectation inside an answer.shape assertion. */
export interface ShapeFieldExpect {
  /** Expected primitive type at the JSONPath. */
  type?: ShapeType;
  /** Value must deeply equal this (key-order insensitive). */
  equals?: unknown;
  /** String at the path must contain this substring. */
  contains?: string;
  /** String at the path must match this (ReDoS-screened) regex. */
  matches?: string;
  /** Value must be one of these. */
  enum?: unknown[];
}

/** A shape field is either a bare type name or a detailed expectation. */
export type ShapeFieldSpec = ShapeType | ShapeFieldExpect;

export type Assertion =
  | { kind: 'tool.called'; name: string; times?: number }
  | { kind: 'tool.order'; names: string[] }
  | { kind: 'tool.args'; name: string; jsonPath: string; equals?: unknown; matches?: string }
  | { kind: 'forbid.tool'; name: string }
  | { kind: 'answer.contains'; text: string; step?: number }
  | { kind: 'answer.matches'; regex: string; step?: number }
  | { kind: 'answer.judge'; rubric: string; model?: string; step?: number }
  | {
      kind: 'answer.shape';
      /** 1-based response to target (v0.6 step semantics); default = final. */
      step?: number;
      /** Require the answer text to parse as JSON (default true). */
      json?: boolean;
      /** Paths that must exist, e.g. ["$.id", "$.tags"]. */
      required?: string[];
      /** JSONPath → type/expectation for structured (e.g. JSON-mode) answers. */
      fields?: Record<string, ShapeFieldSpec>;
    }
  | {
      /**
       * Data-flow guarantee (v0.7): the targeted answer must actually use a
       * value the named tool returned — catches agents that ignore their tools
       * and hallucinate. `fromPath` pulls a specific value from the tool
       * result; otherwise primitive leaves of the result are used.
       */
      kind: 'flow.usesResult';
      tool: string;
      fromPath?: string;
      step?: number;
      /** Distinct source values the answer must contain (default 1). */
      minHits?: number;
    }
  | { kind: 'budget.maxTokens'; value: number }
  | { kind: 'budget.maxSteps'; value: number };

export interface TestCase {
  name: string;
  cassette: string;
  assertions: Assertion[];
  /**
   * Data-driven expansion (v0.7): run the assertion template once per row,
   * substituting `{{ key }}` placeholders in assertion string fields.
   */
  each?: Array<Record<string, unknown>>;
}

export interface TestSuite {
  suite: string;
  cases: TestCase[];
}

export type AssertStatus = 'pass' | 'fail' | 'todo';

export interface AssertResult {
  status: AssertStatus;
  assertion: Assertion;
  message: string;
}

/** Lightweight event summary used by the HTML timeline reporter (v0.7). */
export interface TimelineItem {
  seq: number;
  type: EventType;
  /** Short human preview (tool name / request intent / answer snippet). */
  label: string;
  /** HTTP status for llm.response. */
  status?: number;
  /** Total tokens for llm.response. */
  tokens?: number;
  /** Error flag for tool.result / agent.error. */
  isError?: boolean;
  /** 0-based llm.request turn, when applicable. */
  turn?: number;
}

export interface CaseReport {
  name: string;
  cassette: string;
  results: AssertResult[];
  passed: boolean;
  /** Compact trajectory for the HTML report (optional; other reporters ignore). */
  timeline?: TimelineItem[];
}

export interface Summary {
  pass: number;
  fail: number;
  todo: number;
  exitCode: number;
}

export interface TestReport {
  suite: string;
  cases: CaseReport[];
  summary: Summary;
  generatedAt: string;
}
