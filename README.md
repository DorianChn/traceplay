# traceplay

> **Record, replay, and test AI agent trajectories.** VCR + pytest for AI agents — capture a real run once, replay it offline with zero tokens, and assert behavior in CI.

[![CI](https://github.com/<your-handle>/traceplay/actions/workflows/ci.yml/badge.svg)](https://github.com/<your-handle>/traceplay/actions)
[![npm version](https://img.shields.io/npm/v/traceplay.svg)](https://www.npmjs.com/package/traceplay)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-70%20passing-brightgreen)]()

## Why

AI agents fail silently. A prompt edit, a model upgrade, or a tool schema change can make an agent "succeed" while doing the wrong thing. Existing tools either watch production traces (Langfuse, Phoenix) or lint skill markdown (skillkit, skilllint). **traceplay gives you a local, deterministic, language-agnostic regression suite for multi-step agent trajectories** — the same way VCR/nock gave web apps reliable HTTP tests.

- **Record once** — point your agent's `BASE_URL` at the local proxy; every LLM call is persisted to a JSONL cassette with redacted secrets.
- **Replay offline** — subsequent runs return recorded responses by request hash. No API keys, no tokens, no flakiness.
- **Assert trajectories** — declare tool call order, arguments, final answer, token budgets, and forbidden tools in YAML.
- **CI-ready** — one binary, exit-code gating, console/JSON/Markdown reporters, GitHub Actions included.

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
      - { kind: tool.args, name: get_weather, jsonPath: $.city, equals: Xiamen }
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
  [PASS] tool.args — tool "get_weather" args at $.city equals "Xiamen"
  [PASS] answer.contains — answer contains "sunny"
  [PASS] budget.maxTokens — used 144 tokens, budget 2000
  [PASS] forbid.tool — forbidden tool "execute_shell" not called

5 passed, 0 failed, 0 scaffolded (TODO)
```

## More examples

The `examples/` directory ships with ready-to-run suites covering common
scenarios. Each has a cassette + suite YAML — run them with
`traceplay test examples/<name>/suite.*.yaml`.

| Example | What it demonstrates |
| --- | --- |
| `demo/` | Single tool call + answer + budget assertions (the 30-second demo) |
| `anthropic/` | Anthropic-format cassette (`content` blocks, `system` field) — proves provider-agnostic replay |
| `streaming/` | SSE streaming response — full content captured during recording, asserted offline |
| `multi-tool/` | Agent calling two tools in order, with `tool.args` JSONPath checks and `forbid.tool` guards |

## Installation

```bash
npm install -g traceplay
# or run without installing
npx traceplay --help
```

Requires Node ≥ 20.

## What's new in v0.3

- **Web dashboard** — `traceplay ui --cassettes <dir>` opens a local explorer of your cassettes as visual event timelines.
- **Cassette diff** — `traceplay diff <a.jsonl> <b.jsonl>` compares two runs (before/after a prompt change) and reports added/removed requests, changed responses, and tool-call changes.
- **TypeScript SDK** — the whole CLI is now a thin wrapper over a public API: `import { startRecorder, runTest, compareCassettes } from 'traceplay'`.
- **Tool-call recording** — the recorder exposes `POST /__traceplay/tool.call` and `POST /__traceplay/tool.result` so agents can record tool activity in the same cassette (disable with `--no-tools`).

## What's new in v0.2

- **Streaming support** — record and replay OpenAI-compatible SSE streams; the recorder pipes chunks to your agent in real time while capturing content + usage.
- **Fuzzy replay** — `traceplay replay --fuzzy` falls back to similarity matching when the exact hash misses (threshold configurable via `--fuzzy-threshold`). Exact matching stays the deterministic default.
- **Gemini provider** — normalize `:generateContent` / `:streamGenerateContent` endpoints.
- **`traceplay inspect <cassette.jsonl>`** — timeline + token stats for any cassette.
- **GitHub Action** — `traceplay/action` composite action for one-line CI.
- **pre-commit hook** — `.pre-commit-hooks.yaml` + `traceplay init --pre-commit`.

## Commands

### `traceplay record`

Start a recording proxy. Point your agent's `BASE_URL` at `http://localhost:<port>`.

```bash
traceplay record [--port 8123] [--upstream https://api.openai.com/v1] [--out cassette.jsonl] [--project name] [--no-redact]
```

- `--port`: local proxy port (default 8123)
- `--upstream`: real LLM provider URL (default OpenAI)
- `--out`: cassette output path (default `cassette.jsonl`)
- `--project`: project name stored in cassette metadata
- `--no-redact`: disable secret redaction (not recommended)

Supports OpenAI-compatible `/chat/completions` and Anthropic `/v1/messages` endpoints. Authorization headers and secret body fields are redacted before persistence.

### `traceplay replay`

Start an offline replay server from a cassette. Incoming requests are matched by hash (or by similarity with `--fuzzy`); on a hit, the recorded response is returned exactly — including streaming SSE responses.

```bash
traceplay replay --cassette cassette.jsonl [--port 8124] [--fuzzy] [--fuzzy-threshold 0.6]
```

- `--cassette`: path to a recorded cassette (required)
- `--port`: local server port (default 8124)
- `--fuzzy`: allow approximate matching when the exact hash misses
- `--fuzzy-threshold`: minimum similarity (0..1) for fuzzy matches (default 0.6)

Unmatched requests return 404 with a hint to re-record. No network calls are ever made.

### `traceplay inspect`

Pretty-print a cassette: event timeline, token usage, tool calls, errors.

```bash
traceplay inspect cassette.jsonl
```

### `traceplay test`

Run a test suite against one or more cassettes.

```bash
traceplay test suite.yaml [--format console|json|markdown] [--output report.md]
```

- `suite.yaml|suite.json`: test suite file (required)
- `--format`: output format (default `console`)
- `--output`: write report to file instead of stdout

Exit code 0 = all pass, 1 = any failure, 2 = usage error.

### `traceplay init`

Scaffold a new traceplay project in a directory.

```bash
traceplay init [dir]
```

Creates `suite.yaml`, `cassettes/`, and appends traceplay entries to `.gitignore`.

## Assertions reference

| Kind | Checks | Example |
|---|---|---|
| `tool.called` | tool invoked (optionally exact times) | `{ kind: tool.called, name: get_weather, times: 1 }` |
| `tool.order` | tools invoked in given subsequence | `{ kind: tool.order, names: [search, summarize] }` |
| `tool.args` | JSONPath match on tool arguments | `{ kind: tool.args, name: get_weather, jsonPath: $.city, equals: Xiamen }` |
| `forbid.tool` | tool never invoked | `{ kind: forbid.tool, name: execute_shell }` |
| `answer.contains` | final answer contains text | `{ kind: answer.contains, text: "sunny" }` |
| `answer.matches` | final answer matches regex | `{ kind: answer.matches, regex: "\\d+C" }` |
| `answer.judge` | LLM-as-judge with rubric (cached) | `{ kind: answer.judge, rubric: "mentions temperature" }` |
| `budget.maxTokens` | total token usage ≤ value | `{ kind: budget.maxTokens, value: 2000 }` |
| `budget.maxSteps` | number of LLM requests ≤ value | `{ kind: budget.maxSteps, value: 5 }` |

`tool.args` supports `equals` (exact JSON match) or `matches` (regex). `answer.judge` requires `TRACEPLAY_JUDGE_API_KEY` and caches verdicts to `.traceplay/judge-cache/` for deterministic reruns; without a key it is marked `todo`.

Full field-by-field reference with troubleshooting: [docs/assertions.md](docs/assertions.md)

## Reporters

- **console** (default): human-readable pass/fail output
- **json**: structured `TestReport` for programmatic consumption
- **markdown**: PR-comment-ready table with pass/fail icons

```bash
traceplay test suite.yaml --format markdown --output pr-report.md
```

## Testing Agent Skills

traceplay can generate test cassettes for Agent Skills (SKILL.md) using a mock agent runtime:

```typescript
import { runSkill } from 'traceplay/src/skills/runner.js';
import { generateSkillSuite } from 'traceplay/src/skills/adapter.js';

// Run a skill once and produce a cassette
await runSkill({
  skillPath: './skills/code-review/SKILL.md',
  userMessage: 'review src/index.ts',
  outPath: './cassettes/code-review.jsonl',
});

// Generate a full test suite from multiple test inputs
await generateSkillSuite({
  skillPath: './skills/code-review/SKILL.md',
  outDir: './skill-tests',
  inputs: [
    { name: 'finds-bugs', userMessage: 'review this buggy file', assertions: [{ kind: 'answer.contains', text: 'bug' }] },
    { name: 'stays-in-budget', userMessage: 'review large file', assertions: [{ kind: 'budget.maxTokens', value: 500 }] },
  ],
});
```

For real skill testing against your actual agent runtime, record with `traceplay record` instead.

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

A **cassette** is JSONL: line 0 is metadata, every subsequent line is one `TraceEvent` (`user.message`, `llm.request`, `llm.response`, `tool.call`, `tool.result`, `agent.error`). The replayer matches incoming requests by `sha256(canonicalized request body)` and returns the corresponding recorded `llm.response` (raw body + status + headers).

Full cassette schema reference: [docs/cassette-format.md](docs/cassette-format.md)

## Project structure

```
src/
├── cli.ts                  # entry point, command routing
├── types.ts                # core data model (frozen)
├── core/
│   ├── hash.ts             # canonicalization + sha256
│   ├── redact.ts           # secret redaction
│   └── jsonpath.ts         # minimal JSONPath evaluator
├── cassette/
│   ├── store.ts            # JSONL read/write
│   └── normalize.ts        # provider request/response normalization
├── recorder/
│   ├── proxy.ts            # recording HTTP proxy
│   └── forward.ts          # upstream request forwarding
├── replayer/
│   ├── server.ts           # offline replay server
│   └── matcher.ts          # request hash matching
├── assert/
│   ├── engine.ts           # assertion dispatcher
│   ├── judge.ts            # LLM-as-judge with disk cache
│   └── matchers/
│       ├── tool.ts         # tool.called/order/args/forbid
│       ├── answer.ts       # answer.contains/matches/judge
│       └── budget.ts       # budget.maxTokens/maxSteps
├── report/
│   ├── console.ts          # console reporter
│   ├── json.ts             # JSON reporter
│   └── markdown.ts         # Markdown reporter
├── commands/
│   ├── record.ts           # `traceplay record`
│   ├── replay.ts           # `traceplay replay`
│   ├── test.ts             # `traceplay test`
│   └── init.ts             # `traceplay init`
└── skills/
    ├── runner.ts           # mock agent skill runner
    └── adapter.ts          # generate test suites from skills
```

## Comparison

| | traceplay | skillkit / skilllint | Langfuse / Phoenix |
|---|---|---|---|
| What it tests | Full multi-step trajectories | Skill markdown structure | Production traces |
| Replay | Offline, deterministic, zero tokens | No | No |
| Language | Any (HTTP-boundary proxy) | TS/Python | SDK-specific |
| Where it runs | Local + CI | Local + CI | Hosted/self-hosted platform |
| Assertions | 9 types (tools, answer, budget) | Lint rules | Metrics & dashboards |
| Best for | Regression-gating agent behavior | Linting skill packages | Observability & debugging |

## CI integration (GitHub Action)

Drop a step into your workflow — no build setup needed:

```yaml
- uses: traceplay/action@v0.3.0
  with:
    suite: suite.yaml
    format: markdown   # console | json | markdown
    output: traceplay-report.md
```

The composite action sets up Node and runs `traceplay test` with exit-code
gating, so a behavioral regression fails the build.

## pre-commit

Add the hook to your `.pre-commit-config.yaml` (or generate it with
`traceplay init --pre-commit`):

```yaml
repos:
  - repo: https://github.com/<your-handle>/traceplay
    rev: v0.3.0
    hooks:
      - id: traceplay
        args: [suite.yaml]
```

Your agent regression suite now runs before every commit.

## Web dashboard

Browse recorded cassettes as visual event timelines, no browser extension needed:

```bash
traceplay ui --cassettes ./cassettes --port 8130
# open http://localhost:8130
```

## Cassette diff

Compare two runs (e.g. before/after a prompt edit) to see what changed:

```bash
traceplay diff cassettes/before.jsonl cassettes/after.jsonl
```

Reports added/removed requests, changed responses, and tool-call changes.

## TypeScript SDK

The entire CLI is a thin wrapper over a public API:

```typescript
import { startRecorder, startReplayer, runTest, compareCassettes, runAssertions } from 'traceplay';

// record a session programmatically
const recorder = await startRecorder({ port: 8123, upstream: 'https://api.openai.com/v1', cassettePath: './c.jsonl', redact: true });

// compare two cassettes in a test
const report = compareCassettes(a, b);
```

## Development

```bash
npm install
npm run build
npm test          # 69 tests, including record→replay integration
npm run dev -- test examples/demo/suite.example.yaml
```

## License

MIT — see [LICENSE](./LICENSE).
