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
export { canonicalize, requestHash } from './core/hash.js';
export { redactHeaders, redactBody } from './core/redact.js';
export { jsonPath } from './core/jsonpath.js';

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
export { matchRequest, similarity } from './replayer/matcher.js';

// assertions & reports
export { runAssertions } from './assert/engine.js';
export { judgeAnswer } from './assert/judge.js';
export { formatConsole } from './report/console.js';
export { formatJson } from './report/json.js';
export { formatMarkdown } from './report/markdown.js';
export { formatInspect } from './report/inspect.js';
export { compareCassettes, formatDiff } from './report/diff.js';

// commands (programmatic)
export { runTest } from './commands/test.js';
export { runInit } from './commands/init.js';

// skills
export { readSkill, runSkill } from './skills/runner.js';
export { generateSkillSuite } from './skills/adapter.js';

// UI
export { startUI } from './ui/server.js';

// types
export type * from './types.js';
