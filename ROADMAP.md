# traceplay — Roadmap

## v0.1.0 — ✅ Complete (2026-09-01)

All core milestones delivered and verified (39 tests passing, including end-to-end record→replay integration).

### M0 — Skeleton + offline test
- [x] Core data model (`TraceEvent`, `Cassette`, `Assertion`)
- [x] JSONL cassette store
- [x] Assertion engine (7 types)
- [x] CLI routing + example suite

### M1 — Recording proxy
- [x] HTTP proxy at agent ↔ provider boundary
- [x] OpenAI-compatible `/chat/completions` + Anthropic `/v1/messages` normalization
- [x] Secret redaction (headers + body fields)
- [x] Upstream forwarding (http/https)
- [x] Cassette header + event append

### M2 — Offline replay server
- [x] Load cassette at startup
- [x] Request canonicalization + sha256 matching
- [x] Return recorded raw body + status + headers
- [x] 404 with re-record hint on miss

### M3 — Full assertions + reporters
- [x] All 9 assertion types (tool.called/order/args, forbid.tool, answer.contains/matches/judge, budget.maxTokens/maxSteps)
- [x] `tool.args` with JSONPath (`$.a.b[0].c`, `[*]`)
- [x] `answer.judge` with on-disk cache (deterministic reruns)
- [x] Console / JSON / Markdown reporters

### M4 — CI + scaffolding
- [x] `traceplay init` project scaffolder
- [x] GitHub Actions CI (build + test + dogfood)
- [x] Exit-code gating (0 pass / 1 fail / 2 usage)

### M5 — Agent Skills adapter
- [x] SKILL.md parser (frontmatter + body)
- [x] Mock agent skill runner → cassette
- [x] Test suite generator from skill + test inputs

---

## v0.2 — Planned

- [ ] **Streaming support**: record SSE streaming responses, extract usage from final chunk, replay as stream
- [ ] **Fuzzy matching**: when exact hash misses, fall back to embedding/keyword similarity with a confidence threshold
- [ ] **Tool call recording**: intercept MCP / function calling tool invocations at the proxy boundary (currently only LLM calls are recorded; tool events are produced by the skills mock runner)
- [ ] **More providers**: Gemini, Groq, Ollama, local vLLM endpoints
- [ ] **GitHub Action marketplace**: publish `traceplay/action` for one-line CI integration
- [ ] **pre-commit hook**: validate cassettes + run test suite on commit
- [ ] **Cassette inspector CLI**: `traceplay inspect cassette.jsonl` — pretty-print events, token usage, timeline

## v0.3 — Planned

- [ ] **Web UI**: local dashboard to browse cassettes, inspect traces, compare A/B runs
- [ ] **Cassette diff**: compare two cassettes (e.g. before/after a prompt change) and highlight behavioral differences
- [ ] **Property-based test generation**: auto-generate edge-case test inputs from a skill's description
- [ ] **Plugin system**: custom assertion types, custom normalizers, custom reporters
- [ ] **TypeScript SDK**: first-class `import { record, replay, test } from 'traceplay'` for in-process testing

---

## Success metrics (v0.1 launch, 2-week window)

- GitHub stars: 500+ first week, 2k+ first month
- npm weekly downloads: 1k+
- External adoption: 3+ high-star agent/skill projects reference traceplay in README or CI
- Issue quality: "support X provider / Y assertion" requests = positioning validated

## Launch checklist

1. `npm publish` (0.1.0)
2. GitHub repo public + topics: `ai-agents`, `llm`, `testing`, `vcr`, `record-replay`, `agent-skills`, `ci`
3. Show HN: "Show HN: traceplay – VCR + pytest for AI agents, offline replay"
4. Reddit: r/LocalLLaMA, r/ClaudeAI, r/MachineLearning
5. X/Twitter: 30s terminal GIF, @ Langfuse/skillkit maintainers
6. Chinese: 掘金, V2EX, 少数派 (long-form: "为什么 AI agent 需要回归测试")
7. Product Hunt
8. Awesome-list PRs: awesome-claude-code, awesome-agent-skills, awesome-llm-tools
9. Issue/PR in high-star skill repos: "发布前可用 traceplay 做技能回归测试"
