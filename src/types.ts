/**
 * Core trace model — the single source of truth shared by the recorder,
 * replayer, assertion engine and reporters.
 *
 * Rule: this file is frozen during M1. Any breaking change after release
 * bumps Cassette.version and ships a migration in cassette/store.ts.
 */

export type EventType =
  | 'user.message'
  | 'llm.request'
  | 'llm.response'
  | 'tool.call'
  | 'tool.result'
  | 'agent.error';

export interface BaseEvent {
  /** Stable id, unique within one trace. */
  id: string;
  /** 0-based ordering index. */
  seq: number;
  /** ISO-8601 timestamp. */
  at: string;
  type: EventType;
}

export interface UserMessageEvent extends BaseEvent {
  type: 'user.message';
  content: string;
}

export interface LLMRequestEvent extends BaseEvent {
  type: 'llm.request';
  provider: 'openai-compatible' | 'anthropic' | 'other';
  model: string;
  /** Normalized message array (provider-specific shapes flattened here). */
  messages: unknown[];
  temperature?: number;
  /** sha256 of the canonicalized request (volatile fields removed). */
  requestHash: string;
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
  /** Raw provider payload; answer text extraction lives in the assert engine. */
  output: unknown;
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
  /** True when secrets (Authorization, api keys) were stripped on record. */
  redacted: boolean;
  providerBaseUrl?: string;
  project?: string;
}

/** A cassette = one recorded trajectory, persisted as JSONL. */
export interface Cassette {
  version: 1;
  meta: CassetteMeta;
  events: TraceEvent[];
}

/**
 * Declarative assertions. Implemented kinds are wired in assert/engine.ts;
 * kinds marked `todo` there are scheduled for later milestones (see ROADMAP).
 */
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
  /** Path to cassette, relative to the suite file. */
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
