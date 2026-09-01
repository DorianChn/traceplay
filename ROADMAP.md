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

## v0.6.0 — ✅ Complete
Multi-step agents first-class: ordered replay, mutation testing, step assertions, recorder hardening.
- [x] **Multi-step stateful replay (R4)** — `turn`/`parentId` edges, `createReplaySession` advances step-by-step over a shrinking suffix; repeated prompts match by ordinal; `exhausted`/out-of-order diagnoses; `--stateless` escape hatch; backward compatible with old cassettes
- [x] **Mutation testing (R7)** — `traceplay mutate` with 7 mutators covering every assertion family; killed/survived scoring and CI gating
- [x] **Semantic cassette diff (R10)** — drifted prompts pair as changed-in-place (from/to) instead of removed+added; shared request→response linker
- [x] **Step-targeted answer assertions (R11)** — optional 1-based `step` on `answer.contains/matches/judge`, default stays the final answer
- [x] **Recorder hardening (R12)** — loopback bind by default, optional management token, orphan `tool.result` rejection, `callId` correlation
- [x] **Engineering debt** — shared response linker (§6.2), collision-free random event ids (§6.3), user-regex ReDoS screening (§6.4), judge cache key includes API base (§6.5), judge 30s timeout (§6.7)
- 179 tests passing

## v0.7.0 — ✅ Complete

Assert the whole trajectory: structured-output checks, tool→answer data-flow guarantees, data-driven cases, and a shareable HTML report.
- [x] **Structured-output assertion (R8)** — `answer.shape`: valid-JSON gate, `required` paths, typed `fields` (`string/number/integer/boolean/array/object/null` plus `equals/contains/matches/enum`), wildcard paths, optional `step`
- [x] **Cross-step data-flow assertion (R8)** — `flow.usesResult` links a tool call to its result and requires the answer to cite its values (anti-hallucination), with `fromPath`/`minHits`
- [x] **Property/data-driven cases (R8)** — case-level `each` rows with `{{ key }}` substitution, shared by `test` and `mutate` via `suite/expand.ts`
- [x] **Self-contained HTML report** — `test --format html`: verdict card + per-case trajectory timeline and assertions, inline CSS, zero external requests, all text escaped
- [x] **Recorder hardening** — serialized cassette write queue keeps `seq`/`turn` monotonic under concurrent bursts and drains on close (§6.14); non-JSON bodies are forwarded but flagged via `x-traceplay-skipped` and summarized at close instead of being silently dropped (§6.11)
- 212 tests passing

## v0.8+ — Future directions
- [ ] **Single-repo restructure (R5, deferred)**: one repository with semver tags instead of per-version snapshot folders; branches for parallel majors. Deliberately not done to keep independently-uploadable version folders; decide A (sequential independent repos) vs B (mono-repo + tags)
- [ ] **Remaining R8 enhancements**: cassette merge/rebase for re-recording after intentional prompt changes; JSON-schema (draft) export/import for `answer.shape`
- [ ] **LLM-powered generation**: use a judge model to produce semantic edge cases when `TRACEPLAY_JUDGE_API_KEY` is set
- [ ] **Hosted dashboard / telemetry export** (Langfuse-compatible)
- [ ] **MCP tool recording**: auto-capture MCP tool calls via the MCP protocol instead of manual POSTs
- [ ] **Official SDKs**: Python (`traceplay-py`) and Go bindings
- [ ] **Deeper property DSL**: generators / ranges and cross-field constraints beyond `each` row substitution

---

## North-star & success metrics

- **North star (primary)**: 3+ high-star agent/skill projects reference traceplay in their CI — the strongest signal of real adoption.
- **Leading indicator**: issues requesting "support X provider / Y assertion" = positioning validated.
- **Stretch goals (not the bar)**: GitHub stars and npm weekly downloads are lagging/vanity metrics for a cold-start CLI; treat 500 first-week / 2k first-month stars and 1k weekly downloads as upside, not the success criterion.

## Launch checklist

1. `npm publish` (v0.7.0) — run `make check` first; `prepublishOnly` enforces build + tests
2. GitHub repo public + topics: `ai-agents`, `llm`, `testing`, `vcr`, `record-replay`, `agent-skills`, `ci`
3. Ship a **real multi-step agent** demo (not a single-turn weather call); show a one-word early edit still replaying correctly
4. Show HN: "Show HN: traceplay – VCR + pytest for AI agents, offline zero-token replay" — proactively answer "how is this different from promptfoo?" in the first comment (see README Comparison)
5. Reddit: r/LocalLLaMA, r/ClaudeAI, r/MachineLearning
6. X/Twitter: layered-matching demo GIF, @ Langfuse/promptfoo maintainers
7. Chinese: 掘金, V2EX, 少数派
8. Product Hunt
9. Awesome-list PRs: awesome-claude-code, awesome-agent-skills, awesome-llm-tools
10. Issue/PR in high-star skill repos: "发布前可用 traceplay 做技能回归测试"
