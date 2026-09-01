# Changelog

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
