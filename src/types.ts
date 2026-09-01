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

export type Assertion =
  | { kind: 'tool.called'; name: string; times?: number }
  | { kind: 'tool.order'; names: string[] }
  | { kind: 'tool.args'; name: string; jsonPath: string; equals?: unknown; matches?: string }
  | { kind: 'forbid.tool'; name: string }
  | { kind: 'answer.contains'; text: string }
  | { kind: 'answer.matches'; regex: string }
  | { kind: 'answer.judge'; rubric: string; model?: string }
  | { kind: 'budget.maxTokens'; value: number }
  | { kind: 'budget.maxSteps'; value: number };

export interface TestCase {
  name: string;
  cassette: string;
  assertions: Assertion[];
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

export interface CaseReport {
  name: string;
  cassette: string;
  results: AssertResult[];
  passed: boolean;
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
