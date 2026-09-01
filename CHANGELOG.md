# Changelog

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
- **Vacuous assertions** — `generateSkillSuite` no longer emits
  `answer.contains: ""` for empty inputs (would always pass).
- **Consistency** — `package-lock.json` root version, pre-commit `rev`, and
  GitHub Action `uses:` tag now match v0.3.0.
- **Tests** — added `parseArgs`, Gemini stream, non-200 status and gzip
  integration tests. Now **69 tests**, all passing.

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
