/**
 * traceplay — public TypeScript SDK.
 *
 * Everything the CLI does, exposed as functions so you can drive
 * record / replay / test programmatically inside your own tooling:
 *
 *   import { startRecorder, runTest } from 'traceplay';
 */
export { VERSION } from './version.js';

// core
export { canonicalize, semanticCanonicalize, requestHash, semanticRequestHash } from './core/hash.js';
export { redactHeaders, redactBody } from './core/redact.js';
export { jsonPath } from './core/jsonpath.js';
export { deepEqual, stableStringify } from './core/equal.js';

// cassette
export { readCassette, writeCassette } from './cassette/store.js';
export {
  detectProvider,
  normalizeRequest,
  normalizeResponse,
  normalizeStreamResponse,
} from './cassette/normalize.js';
export {
  isStreamingContentType,
  extractStreamContent,
  extractStreamUsage,
  serializeSSE,
} from './cassette/stream.js';

// recorder & replayer
export { startRecorder } from './recorder/proxy.js';
export { forwardRequest, forwardRaw } from './recorder/forward.js';
export { startReplayer } from './replayer/server.js';
export {
  matchRequest,
  createReplaySession,
  similarity,
  structuredSimilarity,
  bigramDice,
  tokenSequence,
  DEFAULT_STRUCTURED_THRESHOLD,
  DEFAULT_FUZZY_THRESHOLD,
  DEFAULT_AMBIGUITY_GAP,
} from './replayer/matcher.js';
export type { MatchStrategy, MatchOptions, MatchOutcome, ScoredCandidate, ReplaySession } from './replayer/matcher.js';
export { linkResponse, linkResponseIndex } from './replayer/link.js';

// assertions & reports
export { runAssertions } from './assert/engine.js';
export { judgeAnswer } from './assert/judge.js';
export { formatConsole } from './report/console.js';
export { formatJson } from './report/json.js';
export { formatMarkdown } from './report/markdown.js';
export { formatInspect } from './report/inspect.js';
export { compareCassettes, formatDiff } from './report/diff.js';
export type { DiffReport, ChangedRequest, ChangedResponse, DiffEntry, ToolChange } from './report/diff.js';

// v0.6: multi-step answer helpers + mutation testing
export {
  extractAnswerText,
  listResponses,
  responseAtStep,
} from './assert/matchers/answer.js';
export {
  runMutationTesting,
  formatMutationReport,
  listMutators,
} from './mutate/runner.js';
export type {
  MutationReport,
  MutationResult,
  MutationStatus,
  MutatorInfo,
} from './mutate/runner.js';
export { MUTATORS, mutatorsFor } from './mutate/mutators.js';
export type { Mutator, MutationKind } from './mutate/mutators.js';

// commands (programmatic)
export { runTest, evaluateSuite } from './commands/test.js';
export { runMutate, evaluateMutations } from './commands/mutate.js';
export { runInit } from './commands/init.js';

// skills
export { readSkill, runSkill } from './skills/runner.js';
export { generateSkillSuite } from './skills/adapter.js';

// UI
export { startUI } from './ui/server.js';

// v0.4: plugins, generation, matrix, coverage
export { registerAssertion, getCustomAssertion, listCustomAssertions } from './assert/registry.js';
export { generateEdgeCases, defaultBaseFromSkill } from './generate/edgecases.js';
export { runMatrix } from './matrix/runner.js';
export { formatMatrixConsole, formatMatrixMarkdown, formatMatrixJson } from './report/matrix.js';
export { computeCoverage, formatCoverage } from './report/coverage.js';

// types
export type * from './types.js';
