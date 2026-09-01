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
- [x] **Web UI** (`traceplay ui`) — local dashboard, event timelines
- [x] **Cassette diff** (`traceplay diff`) — added/removed requests, changed responses, tool changes
- [x] **TypeScript SDK** — public API in `src/index.ts` (CLI is a thin wrapper)
- [x] **Tool-call recording** — `POST /__traceplay/tool.call|result` reporting endpoints
- 69 tests passing

## v0.4 — Planned
- [ ] **Edge-case generation**: `traceplay generate` — property-based test
      inputs derived from a skill's description (empty, boundary, long, special-char)
- [ ] **Matrix runner**: `traceplay matrix` — multi-suite × multi-model scorecards
- [ ] **Coverage**: `traceplay coverage` — which assertion types cover which behaviors
- [ ] **Plugin system**: register custom assertion types / normalizers / reporters

---

## Success metrics (launch, 2-week window)

- GitHub stars: 500+ first week, 2k+ first month
- npm weekly downloads: 1k+
- External adoption: 3+ high-star agent/skill projects reference traceplay in CI
- Issue quality: "support X provider / Y assertion" requests = positioning validated

## Launch checklist

1. `npm publish` (v0.2.0)
2. GitHub repo public + topics: `ai-agents`, `llm`, `testing`, `vcr`, `record-replay`, `agent-skills`, `ci`
3. Show HN: "Show HN: traceplay – VCR + pytest for AI agents, offline replay"
4. Reddit: r/LocalLLaMA, r/ClaudeAI, r/MachineLearning
5. X/Twitter: streaming demo GIF, @ Langfuse/skillkit maintainers
6. Chinese: 掘金, V2EX, 少数派
7. Product Hunt
8. Awesome-list PRs: awesome-claude-code, awesome-agent-skills, awesome-llm-tools
9. Issue/PR in high-star skill repos: "发布前可用 traceplay 做技能回归测试"
