# Changelog

## v0.6.0 — multi-step agents first-class: ordered replay, mutation testing, step assertions

This release treats a whole agent trajectory — not a single LLM call — as the
unit of replay and testing. Repeated prompts now replay in sequence, assertions
can target any intermediate step, and a built-in mutation tester proves your
assertions actually catch regressions.

### Added
- **Stateful, ordered replay (R4).** A new `createReplaySession` walks the
  recorded trajectory in order: at step *k* it only considers recorded requests
  from step *k* onward, so a prompt that appears N times (e.g. an agent that says
  "continue" repeatedly) replays the 1st, 2nd, 3rd recorded response in
  sequence instead of always replaying the first. After the last step it reports
  an explicit `exhausted` outcome; a request matching only an already-consumed
  step is diagnosed as out-of-order. The HTTP replayer is stateful by default;
  `--stateless` (or `stateful:false`) restores the v0.5 global scan.
- **Multi-step metadata (R4 stage 1).** Recorded `llm.request` events carry
  optional `turn` (0-based step number) and `parentId` (previous request id);
  `tool.call` events carry `callId`. All optional — old cassettes derive order
  from event sequence and need no migration (schema version unchanged).
- **Mutation testing (R7) — `traceplay mutate`.** For every assertion that passes
  on the real cassette, traceplay injects a fault (wrong/empty answer, dropped
  tool call, injected forbidden tool, perturbed tool args, 100× token blow-up,
  extra LLM step) and checks the assertion flips to **fail**: caught = `killed`,
  still green = `survived` (a weak/ vacuous assertion). Reports a mutation score
  and exits non-zero when a mutation survives, so CI blocks hollow test suites.
  Seven mutators cover every assertion family.
- **Step-targeted answer assertions (R11).** `answer.contains` /
  `answer.matches` / `answer.judge` accept an optional 1-based `step` to assert
  against an intermediate response; omitting it keeps the v0.1–v0.5 default of
  the final answer.
- **Semantic cassette diff (R10).** `traceplay diff` no longer reports a
  one-word prompt edit as a misleading removed+added pair: hash-different but
  highly-similar requests are paired as a single `changed` step with `from`/`to`
  prompt and answer. Exact-hash matches keep the fast path; genuine adds/removes
  are still listed.
- **Recorder hardening (R12).** The recorder binds to `127.0.0.1` by default
  (use `--host` to override, with a warning) so it is not reachable off-loopback;
  an optional management token (`--token` / `TRACEPLAY_TOKEN`, accepted as
  `Authorization: Bearer` or `x-traceplay-token`, constant-time compared) guards
  the tool-reporting endpoints; an orphan `tool.result` with no matching
  `tool.call` is rejected with `400`, and `tool.call` echoes a `callId`.
- **SDK**: `createReplaySession`, `linkResponse`/`linkResponseIndex`,
  `runMutationTesting`/`listMutators`, `responseAtStep`/`listResponses`,
  `isLikelyCatastrophic`/`compileUserRegex`, and diff types are exported.

### Changed
- Shared request→response linkage (`replayer/link.ts`) is now used by both the
  matcher and the diff report (review §6.2), removing two divergent linkers.
- Event ids use a timestamp + random suffix instead of a module-level counter,
  so two recorders started concurrently in one process can never interleave ids
  (review §6.3); `resetCounter` remains as a no-op for back-compat.
- The LLM-judge cache key includes the API base URL, so switching judge
  providers can never return a stale verdict (review §6.5).

### Security & correctness hardening
- **ReDoS guard (§6.4).** User-supplied `answer.matches` / `tool.args matches`
  regexes are screened for classic nested-quantifier catastrophic shapes
  (`(a+)+`, `(.*)*`, …) and refused with a clear failure instead of risking a
  hung, uninterruptible regex; invalid regexes also fail cleanly.
- **Judge network timeout (§6.7).** LLM-judge HTTP calls have a 30s hard timeout
  and degrade to `todo` on failure, so an unreachable judge can never hang a run.

### Complexity note (R4 benchmark)
- Stateless global scan is O(n) per request → O(n²) for an n-step trajectory.
  The ordered session scans only the not-yet-consumed suffix, shrinking as the
  replay progresses (≈ O(n²/2) work overall, with a much smaller constant and no
  repeated-prompt ambiguity); a 200-step ordered replay resolves in well under
  1s (locked by `tests/replay-session.test.ts`).

### Tests
- 176 passing across 29 files (was 136 / 23): a 10-step ordered trajectory,
  repeated-prompt sequencing, exhausted/out-of-order/reset, legacy-cassette
  compatibility, link fallback, step assertions, ReDoS screening, semantic diff
  pairing, killed/survived/baseline-failed mutation paths, mutation deep-copy
  isolation, loopback binding, orphan-result 400 and token 401/200 paths.



This release makes replay reliable on real, drifting multi-step agents instead
of single-turn demos.

### Added
- **Four-layer request matcher** (`replayer/matcher.ts`): `exact (L0)` →
  `semantic (L1)` → `structured (L2)` → `fuzzy (L3)`. L0/L1 are deterministic
  hash lookups; L1 folds whitespace and drops sampling noise (`seed`).
- **Structured similarity (L2)**: role-aware and order-aware (bigram Sørensen–
  Dice), weighting the last user message (current intent) over shared
  boilerplate, with turn-count and role-sequence penalties.
- **Intent-anchored L3 recall**: token-set overlap is gated by the current-
  intent anchor so role/order permutations with an identical bag of words can
  no longer match.
- **Ambiguity detection**: near-tied top candidates return HTTP `409 Conflict`
  instead of silently replaying the wrong response; configurable via
  `--ambiguity-gap`.
- **Drift diagnosis**: `404` responses and match outcomes report the incoming
  intent and closest recorded request; hits expose `x-traceplay-match` /
  `x-traceplay-score` headers.
- **Determinism contract**: checked-in `fixtures/golden/` lock canonicalization
  hashes and replay bytes (`tests/golden-contract.test.ts`).
- **Cassette schema versioning**: explicit `version` validation with a clear
  migration error for unknown/missing schema versions.
- **CLI**: `--structured-threshold`, `--ambiguity-gap` flags with 0..1
  validation (`parseScore`); SDK exports `structuredSimilarity`, `bigramDice`,
  `semanticRequestHash`, matching constants and types.
- **Docs**: `docs/matching.md` (matcher internals + tuning + failure cookbook);
  honest comparison with promptfoo and single-call replay mocks.

### Changed
- Recorded `llm.request` events now also store `semanticHash` (L1); cassettes
  from v0.1–v0.4 without it remain supported (computed on the fly).
- Default replay now runs L0 **and** L1 (both deterministic) before reporting a
  miss; `--fuzzy` additionally enables L2/L3.

### Security & correctness hardening
- **Secrets are now actually redacted at record time.** `redactBody` existed but
  was never wired into the recording path; request bodies and tool-call
  arguments/results are now redacted before they touch a cassette, while the raw
  bytes forwarded upstream stay untouched. The replayer redacts the incoming
  request identically before hashing, so credential rotation never causes a
  miss and recorded/live requests still match exactly.
- **`tool.args equals` is now key-order insensitive** via a new
  `core/equal.ts` (`deepEqual`/`stableStringify`); semantically identical
  objects whose keys were serialized in a different order no longer fail.

### Tests
- 136 passing (was 101): adversarial negatives, role/order permutations, a
  5-step context-drift fixture, ambiguity cases, legacy-cassette back-compat,
  HTTP-level 409/404 tests, golden contracts, record/replay L1 shape parity,
  end-to-end secret redaction, tool-argument key-order equality, and `parseScore`
  coverage.

## 2026-09-01 — robustness & release-readiness pass

- **Friendly errors for bad input** — corrupted cassette lines now report the
  exact line number and file; missing suite files, missing `cases`/`cassette`/`assertions`,
  and malformed YAML/JSON all produce clear one-line messages instead of raw
  stack traces.
- **UTF-8 BOM tolerance** — cassettes and suites saved by Windows editors
  (which prepend a BOM) now load correctly.
- **Input validation** — unknown `--format` values exit 2 with the list of
  valid formats; invalid `--port` values (non-numeric, out of 1-65535 range)
  are rejected before the server starts.
- **Cleaner CLI errors** — user-facing errors print a single `error: ...`
  line; set `TRACEPLAY_DEBUG=1` for a full stack trace.
- **npm release readiness** — added `prepublishOnly` (build + test gate),
  `repository`/`homepage`/`bugs` metadata, and a `Makefile` with
  common tasks (`make check` runs typecheck + build + test).
- **Tests** — added boundary coverage for corrupted/empty/BOM cassettes,
  suite validation, unknown formats, and port parsing.

## 2026-09-01 — project maturity pass

- **Open-source scaffolding** — added `.editorconfig`, `.gitattributes`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub issue
  templates (bug report + feature request), and a pull request template.
- **New examples** — added ready-to-run suites for Anthropic-format
  cassettes, SSE streaming responses, and multi-tool agent trajectories
  (see `examples/anthropic/`, `examples/streaming/`,
  `examples/multi-tool/`).
- **Documentation** — added `docs/assertions.md` (field-by-field assertion
  reference with troubleshooting) and `docs/cassette-format.md` (full JSONL
  schema reference); linked both from the README.
- **Bug fix** — `tool.args` assertions with a missing or empty `jsonPath`
  field no longer crash the test runner; they now fail with a clear message.
  Regression test added.
- **README** — added a "More examples" section and cross-links to the new
  docs; updated the tests badge.

## 2026-09-01 — hardening pass

- **CLI entry guard** — `cli.ts` only runs `main()` when executed directly
  (ESM `import.meta.url` check); importing it no longer starts servers or
  calls `process.exit`.
- **`--flag=value` syntax** — CLI flags accept `=` syntax (`--format=json`) in
  addition to `--flag value`; `parseArgs` is exported and unit-tested.
- **Faithful status codes** — the recorder no longer rewrites upstream
  responses to `200`; non-200 responses are recorded and replayed with their
  real status (regression test added).
- **Gemini streaming** — SSE content/usage extraction now understands Gemini's
  `candidates[].content.parts[].text` and `usageMetadata` (tests added).
- **gzip/deflate responses** — upstream responses are transparently
  decompressed before recording; `content-encoding` is dropped so replay
  serves plain text.
- **Vacuous assertions** — `generate` no longer emits `answer.contains: ""`
  for empty inputs (would pass for every answer); it now emits only the
  resource-budget assertion.
- **LLM-as-judge caching** — added a dedicated test proving disk-cache hits
  (no network) and graceful `todo` degradation on call failure.
- **Matrix path resolution** — suite paths in `matrix.yaml` are now resolved
  relative to the config file (not the working directory), so `traceplay
  matrix` works from any cwd (regression test added).
- **Consistency** — `package-lock.json` root version, pre-commit `rev`, and
  GitHub Action `uses:` tag now match v0.4.0.
- **Tests** — added `parseArgs`, Gemini stream, non-200 status, gzip
  integration, and judge-cache tests. Now **85 tests**, all passing.

---

## v0.4.0 — Edge-case generation, matrix runner, coverage, plugin system

**New capabilities**
- **`traceplay generate --skill <SKILL.md> --out <dir>`** — property-style
  edge-case test generation. Derives boundary inputs (empty, whitespace,
  special chars, numeric extremes, extreme length, off-topic, role-confusion)
  from a skill description, runs each through the mock agent, and writes a
  suite you can test immediately.
- **`traceplay matrix --config matrix.yaml`** — run multiple suites (one per
  model/prompt variant) and produce a comparison scorecard in
  console / Markdown / JSON.
- **`traceplay coverage <suite.yaml>`** — reports assertion-kind usage and
  which trace event types are (or aren't) exercised, surfacing untested
  behaviors.
- **Plugin system** — `registerAssertion(kind, fn)` lets you add custom
  assertion kinds used directly from `suite.yaml`; unknown kinds fail with a
  helpful hint instead of silently passing.

**v0.3.0 recap** — web UI, cassette diff, TypeScript SDK, tool-call recording.
**v0.2.0 recap** — streaming, fuzzy replay, Gemini, inspect, GitHub Action, pre-commit.
**v0.1.0 recap** — record/replay/test core, 9 assertions, 3 reporters, skills adapter.

---

## v0.3.0 — Web UI, cassette diff, TypeScript SDK, tool-call recording

**New capabilities**
- **`traceplay ui --cassettes <dir>`** — local web dashboard to browse,
  inspect, and explore recorded cassettes as visual event timelines.
- **`traceplay diff <a.jsonl> <b.jsonl>`** — compare two cassettes
  (before/after a prompt or model change) and report added/removed requests,
  changed responses, and tool-call changes.
- **TypeScript SDK** — `import { startRecorder, startReplayer, runTest, runAssertions, compareCassettes } from 'traceplay'`; the whole CLI is now a thin wrapper over the public API (`src/index.ts`).
- **Tool-call recording** — the recording proxy exposes
  `POST /__traceplay/tool.call` and `POST /__traceplay/tool.result` so agents
  can report tool activity into the same cassette as their LLM calls
  (disable with `--no-tools`).

**v0.2.0 recap** — streaming, fuzzy replay, Gemini, inspect, GitHub Action, pre-commit.
**v0.1.0 recap** — record/replay/test core, 9 assertions, 3 reporters, skills adapter.

---

## v0.2.0 — Streaming, fuzzy matching, Gemini, inspection, CI & pre-commit

**New capabilities**
- **Streaming (SSE) support** — the recorder now passes streaming responses
  through to your agent in real time while capturing the full content and
  token usage for the cassette. The replayer serves recorded streams back as
  OpenAI-compatible `text/event-stream`, so streaming agents replay offline.
- **Fuzzy matching** — `traceplay replay --fuzzy [--fuzzy-threshold 0..1]`.
  When the exact request hash misses, the replayer falls back to
  message-similarity matching, tolerating small wording changes while keeping
  exact matching (deterministic) as the default.
- **Gemini provider** — normalization for `:generateContent` /
  `:streamGenerateContent` endpoints (contents + systemInstruction →
  messages, usageMetadata → tokens).
- **`traceplay inspect <cassette.jsonl>`** — pretty-print a cassette: event
  timeline, token usage, tool calls, errors. Great for debugging recordings.
- **GitHub Action** — `action.yml` composite action (`traceplay/action`) for
  one-line CI integration.
- **pre-commit hook** — `.pre-commit-hooks.yaml` + `traceplay init --pre-commit`
  generates `.pre-commit-config.yaml`.

**v0.1.0 recap**
- Record / replay / test CLI (VCR + pytest for AI agents)
- 9 assertion types (tools, answers, budgets), 3 reporters, JSONL cassettes
- Agent Skills adapter (SKILL.md → mock agent → cassette → suite)
- 39 unit/integration tests

---

## v0.1.0 — Initial release

- Core data model, JSONL cassette store, assertion engine
- Recording proxy (OpenAI + Anthropic), secret redaction
- Offline replay server with exact hash matching
- 9 assertion types, console/JSON/Markdown reporters
- `init` scaffolder, GitHub Actions CI, example suite
- 39 tests passing
