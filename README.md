# traceplay

> **VCR + pytest for AI agents.** Record a real LLM/tool trajectory once, replay it offline with zero tokens, and assert behavior in CI.

[![CI](https://github.com/<your-handle>/traceplay/actions/workflows/ci.yml/badge.svg)](https://github.com/<your-handle>/traceplay/actions)
[![npm version](https://img.shields.io/npm/v/traceplay.svg)](https://www.npmjs.com/package/traceplay)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## Why

AI agents fail silently: a prompt edit, a model upgrade, or a tool schema change can make an agent "succeed" while doing the wrong thing. Existing tools either watch production traces (Langfuse, Phoenix) or string-match subprocess output (skill test harnesses). **traceplay gives you a local, deterministic, language-agnostic regression suite for multi-step agent trajectories** — the same way VCR/nock gave web apps reliable HTTP tests.

- **Record once** — point your agent's `BASE_URL` at the local proxy; every LLM call and tool call is persisted to a JSONL cassette.
- **Replay offline** — subsequent runs return recorded responses by request hash. No API keys, no tokens, no flakiness.
- **Assert trajectories** — declare tool call order, arguments, final answer, token budgets, and forbidden tools in YAML.
- **CI-ready** — one binary, exit-code gating, GitHub Action included.

## 30-second demo

```bash
# 1. Record a real run
npx traceplay record --port 8123 --out ./cassettes/weather.jsonl
#    in another terminal: BASE_URL=http://localhost:8123 node my-agent.js

# 2. Write a test suite
cat > suite.yaml <<'EOF'
suite: weather-agent
cases:
  - name: fetches weather and answers
    cassette: ./cassettes/weather.jsonl
    assertions:
      - { kind: tool.called, name: get_weather }
      - { kind: answer.contains, text: sunny }
      - { kind: budget.maxTokens, value: 2000 }
      - { kind: forbid.tool, name: execute_shell }
EOF

# 3. Run offline, in CI
npx traceplay test suite.yaml
```

```
● fetches weather and answers
  [PASS] tool.called — tool "get_weather" called 1 time(s)
  [PASS] answer.contains — answer contains "sunny"
  [PASS] budget.maxTokens — used 144 tokens, budget 2000
  [PASS] forbid.tool — forbidden tool "execute_shell" not called

4 passed, 0 failed, 0 scaffolded (TODO)
```

## How it works

```
your agent ──BASE_URL──► traceplay record ──► LLM provider
                              │
                              ▼
                    cassette.jsonl (header + events)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     traceplay replay (offline)      traceplay test (assert)
     match by requestHash             YAML assertions → exit code
```

A **cassette** is JSONL: line 0 is metadata, every subsequent line is one `TraceEvent` (`user.message`, `llm.request`, `llm.response`, `tool.call`, `tool.result`, `agent.error`). The core data model is in [`src/types.ts`](./src/types.ts) and is frozen for M1.

## Assertions reference

| Kind | Checks | Status |
|---|---|---|
| `tool.called` | tool invoked (optionally exact times) | ✅ M0 |
| `tool.order` | tools invoked in given subsequence | ✅ M0 |
| `forbid.tool` | tool never invoked | ✅ M0 |
| `answer.contains` / `answer.matches` | final answer text | ✅ M0 |
| `budget.maxTokens` / `budget.maxSteps` | cost & step budgets | ✅ M0 |
| `tool.args` | JSONPath match on tool arguments | 🚧 M3 |
| `answer.judge` | LLM-as-judge with cached verdicts | 🚧 M3 |

## Comparison

| | traceplay | skillkit / skilllint | Langfuse / Phoenix |
|---|---|---|---|
| What it tests | Full multi-step trajectories | Skill markdown structure + subprocess stdout | Production traces |
| Replay | Offline, deterministic, zero tokens | No | No |
| Language | Any (HTTP-boundary proxy) | TS/Python | SDK-specific |
| Where it runs | Local + CI | Local + CI | Hosted/self-hosted platform |
| Best for | Regression-gating agent behavior | Linting skill packages | Observability & debugging |

## Roadmap

See [ROADMAP.md](./ROADMAP.md). Current milestone: **M0 — skeleton + offline `test` against hand-written cassettes.** Up next: M1 recording proxy, M2 replay server, M3 full assertions, M4 GitHub Action + `init`, M5 Agent Skills adapter + launch.

## Development

```bash
npm install
npm run build
npm test
npm run dev test examples/demo/suite.example.yaml
```

Requires Node ≥ 20.

## License

MIT — see [LICENSE](./LICENSE).
