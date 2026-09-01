# traceplay — Roadmap

## v0.1.0 — ✅ Complete
Record / replay / test core (VCR + pytest for AI agents).
- JSONL cassettes, recording proxy (OpenAI + Anthropic), secret redaction
- Offline replay server, exact hash matching
- 9 assertion types, console/JSON/Markdown reporters
- `init` scaffolder, GitHub Actions CI, Agent Skills adapter
- 39 tests passing

## v0.2.0 — ✅ Complete
Production realism: streaming, fuzzy replay, more providers, ops tooling.
- Streaming record/replay (SSE), fuzzy replay, Gemini provider
- `traceplay inspect`, GitHub Action, pre-commit hook
- 52 tests passing

## v0.3.0 — ✅ Complete
Observability & programmability: UI, diff, SDK, tool-call recording.
- Web UI (`traceplay ui`), cassette diff, TypeScript SDK, tool reporting endpoints
- 62 tests passing

## v0.4.0 — ✅ Complete
Intelligence & extensibility: generation, matrix, coverage, plugins.
- [x] **Edge-case generation** (`traceplay generate`) — property-style boundary inputs from a skill description
- [x] **Matrix runner** (`traceplay matrix`) — multi-suite comparison scorecards
- [x] **Coverage** (`traceplay coverage`) — assertion usage + untested event types
- [x] **Plugin system** — `registerAssertion(kind, fn)` custom assertions
- 85 tests passing

## v0.5.0 — ✅ Complete
Trustworthy replay on real, drifting agents (matcher hardening).
- [x] **Four-layer matcher** — exact (L0) / semantic (L1) / structured (L2) / fuzzy (L3)
- [x] **Role- & order-aware structured similarity** with a current-intent anchor
- [x] **Ambiguity detection** → `409 Conflict` instead of silent wrong replay
- [x] **Drift diagnosis** on misses + `x-traceplay-match` headers on hits
- [x] **Determinism contract** — golden fixtures lock hashes and replay bytes
- [x] **Cassette schema versioning** with explicit migration errors
- 136 tests passing

## v0.6 — Planned (scenarios & engineering debt)
- [ ] **Multi-step trajectory model (R4)**: `parentId`/`turn` edges and state-machine replay that advances step-by-step instead of a global scan; disambiguate repeated prompts by ordinal
- [ ] **Single-repo restructure (R5)**: one repository with semver tags instead of per-version snapshot folders; branches for parallel majors
- [ ] **Mutation testing (R7)**: mutate recorded answers/tool calls/budgets and prove every assertion kind catches the mutation

## v0.7+ — Future directions
- [ ] **LLM-powered generation**: use a judge model to produce semantic edge cases when `TRACEPLAY_JUDGE_API_KEY` is set
- [ ] **Hosted dashboard / telemetry export** (Langfuse-compatible)
- [ ] **MCP tool recording**: auto-capture MCP tool calls via the MCP protocol instead of manual POSTs
- [ ] **Official SDKs**: Python (`traceplay-py`) and Go bindings
- [ ] **Property-based DSL**: `for each x in [...]` parametrized assertions

---

## North-star & success metrics

- **North star (primary)**: 3+ high-star agent/skill projects reference traceplay in their CI — the strongest signal of real adoption.
- **Leading indicator**: issues requesting "support X provider / Y assertion" = positioning validated.
- **Stretch goals (not the bar)**: GitHub stars and npm weekly downloads are lagging/vanity metrics for a cold-start CLI; treat 500 first-week / 2k first-month stars and 1k weekly downloads as upside, not the success criterion.

## Launch checklist

1. `npm publish` (v0.5.0) — run `make check` first; `prepublishOnly` enforces build + tests
2. GitHub repo public + topics: `ai-agents`, `llm`, `testing`, `vcr`, `record-replay`, `agent-skills`, `ci`
3. Ship a **real multi-step agent** demo (not a single-turn weather call); show a one-word early edit still replaying correctly
4. Show HN: "Show HN: traceplay – VCR + pytest for AI agents, offline zero-token replay" — proactively answer "how is this different from promptfoo?" in the first comment (see README Comparison)
5. Reddit: r/LocalLLaMA, r/ClaudeAI, r/MachineLearning
6. X/Twitter: layered-matching demo GIF, @ Langfuse/promptfoo maintainers
7. Chinese: 掘金, V2EX, 少数派
8. Product Hunt
9. Awesome-list PRs: awesome-claude-code, awesome-agent-skills, awesome-llm-tools
10. Issue/PR in high-star skill repos: "发布前可用 traceplay 做技能回归测试"
