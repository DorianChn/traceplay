# Changelog

## 2026-09-01 — hardening pass

- **CLI entry guard** — `cli.ts` only runs `main()` when executed directly
  (ESM `import.meta.url` check); importing it no longer starts servers or
  calls `process.exit`.
- **`--flag=value` syntax** — CLI flags accept `=` syntax (`--format=json`) in
  addition to `--flag value`; `parseArgs` is exported and unit-tested.
- **Faithful status codes** — non-200 upstream responses are no longer
  rewritten to `200`; they are recorded and replayed with their real status.
- **gzip/deflate responses** — upstream responses are transparently
  decompressed before recording; `content-encoding` is dropped so replay
  serves plain text.
- **Vacuous assertions** — `generateSkillSuite` no longer emits
  `answer.contains: ""` for empty inputs (would always pass).
- **Consistency** — `package-lock.json` root version matches the release.
- **Tests** — fixed the `cli.test.ts` example-suite path (broke after the
  folder moved into the version tree); added `parseArgs`, non-200 status and
  gzip integration tests. Now **44 tests**, all passing.

---

## v0.1.0 — Initial release

- Core data model, JSONL cassette store (header + typed trace events)
- Recording proxy (OpenAI + Anthropic), secret redaction (headers + body fields)
- Offline replay server with exact request-hash matching
- 9 assertion types across tools / answers / budgets:
  `tool.called`, `tool.args`, `tool.notCalled`, `answer.contains`,
  `answer.matches`, `answer.judge`, `budget.maxTokens`, `budget.maxToolCalls`,
  `budget.maxTokensPerCall`
- Console / JSON / Markdown reporters
- Agent Skills adapter (SKILL.md → mock agent → cassette → suite)
- `init` scaffolder, GitHub Actions CI, example suite
- 39 unit/integration tests passing
