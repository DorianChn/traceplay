# traceplay

> **Record, replay, and test AI agent trajectories.** VCR + pytest for AI agents —capture a real run once, replay it offline with zero tokens, and assert behavior in CI.

[![CI](https://github.com/<your-handle>/traceplay/actions/workflows/ci.yml/badge.svg)](https://github.com/<your-handle>/traceplay/actions)
[![npm version](https://img.shields.io/npm/v/traceplay.svg)](https://www.npmjs.com/package/traceplay)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-212%20passing-brightgreen)]()

## Why you need this

**Testing an AI agent is broken three ways:**

- **Non-deterministic** —the same prompt can return different answers, so you can't hard-code the expected output.
- **Expensive & flaky** —every test run hits the real API: it burns tokens, needs network, and flakes.
- **Multi-step and opaque** —an agent can print the *right* final answer while calling the wrong tool, passing bad arguments, or blowing the token budget. Eyeballing the last line misses all of it.

traceplay fixes this the same way VCR/nock fixed flaky HTTP tests —**record one real run, replay it offline for free, and assert the whole trajectory.** It is local, deterministic, and language-agnostic (it sits at the HTTP boundary, so agents written in Python, Go, or TypeScript all work). Observability tools such as Langfuse and Phoenix watch production traces, and skill linters check markdown —neither gives you an offline regression suite.

| | Without traceplay | With traceplay |
| --- | --- | --- |
| After editing a prompt | Re-chat manually, watch every step, pay API fees | `traceplay test suite.yaml` in seconds, offline |
| Responses | Flaky —output drifts from run to run | Identical recorded responses, every time |
| Cost per run | Tokens on every run | $0 after the first recording |
| What's verified | The final answer, by eye | Tools 路 args 路 call order 路 answer 路 token/step budget 路 forbidden tools |
| In CI | Needs API keys + network, flakes | Exit-code gate; no keys, no network |

- **Record once** —point your agent's `BASE_URL` at the local proxy; every LLM call is persisted to a JSONL cassette with secrets redacted.
- **Replay offline** —later runs return recorded responses by request hash: no API keys, no tokens, no flakiness.
- **Assert trajectories** —declare tool order/arguments, final answer, token budgets, and forbidden tools in YAML.
- **CI-ready** —one binary, exit-code gating, console/JSON/Markdown reporters, and a GitHub Actions workflow.

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
鈼?fetches weather and answers
  [PASS] tool.called —tool "get_weather" called 1 time(s)
  [PASS] tool.args —tool "get_weather" args at $.city equals "Xiamen"
  [PASS] answer.contains —answer contains "sunny"
  [PASS] budget.maxTokens —used 144 tokens, budget 2000
  [PASS] forbid.tool —forbidden tool "execute_shell" not called

5 passed, 0 failed, 0 scaffolded (TODO)
```

## More examples

The `examples/` directory ships with ready-to-run suites covering common
scenarios. Each has a cassette + suite YAML —run them with
`traceplay test examples/<name>/suite.*.yaml`.

| Example | What it demonstrates |
| --- | --- |
| `demo/` | Single tool call + answer + budget assertions (the 30-second demo) |
| `anthropic/` | Anthropic-format cassette (`content` blocks, `system` field) —proves provider-agnostic replay |
| `streaming/` | SSE streaming response —full content captured during recording, asserted offline |
| `multi-tool/` | Agent calling two tools in order, with `tool.args` JSONPath checks and `forbid.tool` guards |
| `multistep/` | A looping agent that sends the same `"continue"` prompt twice and gets different drafts —ordered replay plus `step` assertions on intermediate answers (v0.6); try `traceplay mutate` on it |
| `structured/` | A tool-using agent that returns JSON —`answer.shape` schema checks, `flow.usesResult` anti-hallucination, and an `each`-parametrized case (v0.7); render it with `--format html` |

## Installation

```bash
npm install -g traceplay
# or run without installing
npx traceplay --help
```

Requires Node 鈮?20.

## What's new in v0.7 —assert the whole trajectory

v0.6 made multi-step **replay** first-class; v0.7 closes the loop on the
**assertion** side. Agents increasingly return structured JSON and chain tool
output into their final answer —plain substring checks can't validate either.
v0.7 adds three assertion powers plus a report you can attach to a PR.

- **Validate structured answers** —`answer.shape` requires the answer to parse
  as JSON and match a lightweight type/value schema (great for JSON-mode and
  tool-schema outputs):

  ```yaml
  - kind: answer.shape
    required: ["$.ticket", "$.priority"]
    fields:
      "$.ticket":   { matches: "^TC-\\d+$" }
      "$.priority": { enum: [low, high] }
      "$.tags[*]":  "string"
  ```

- **Prove the answer used its tools (anti-hallucination)** —`flow.usesResult`
  fails when the final answer ignores the values a tool actually returned:

  ```yaml
  - kind: flow.usesResult
    tool: get_ticket      # answer must cite 鈮? values get_ticket returned
    minHits: 2
  ```

- **Data-driven cases** —one template, many rows via `each`, with `{{ key }}`
  placeholders. Works for both `test` and `mutate`:

  ```yaml
  each:
    - { value: TC-4821 }
    - { value: mina }
  assertions:
    - { kind: answer.contains, text: "{{value}}" }
  ```

- **Shareable HTML report** —`traceplay test suite.yaml --format html
  --output report.html` writes one self-contained file: a verdict card plus a
  per-case **Trajectory** timeline next to the assertions. No server, no
  external assets —drop it in a PR or send the file. See
  [`docs/asserting-structure.md`](./docs/asserting-structure.md) and the
  runnable `examples/structured/` suite. **212 tests** across 34 files.

## What's new in v0.6 —multi-step agents first-class

v0.5 made the *matcher* trustworthy; v0.6 makes the whole **trajectory** the unit of replay and test. Real agents loop, call tools between LLM turns, and often send the same prompt ("continue", "next step") several times. Treating each request in isolation replays the wrong response on repeat prompts and lets you assert only the final answer. v0.6 fixes all of that —and adds a mutation tester that proves your assertions aren't hollow.

- **Ordered, stateful replay** —replay now walks the recorded trajectory step by step. At step *k* it only considers recorded requests from step *k* onward, so a prompt that appears N times replays the 1st, 2nd, 3rd recorded response **in sequence**; after the last step it reports `exhausted`, and a request that only matches an already-played step is flagged as out-of-order. Old cassettes work unchanged (order is derived from event order); `--stateless` restores the v0.5 global scan.
- **`traceplay mutate` —mutation testing for agent assertions.** A green suite is only as good as its ability to catch a real regression. traceplay now injects faults into the cassette (wrong/empty answer, dropped tool call, an injected *forbidden* tool, perturbed tool args, a 100脳 token blow-up, an extra LLM step) and checks each assertion flips red. A fault the assertion catches is `killed`; one it misses is `survived` —a vacuous assertion to strengthen. It exits non-zero when a mutation survives, so CI blocks hollow suites. (The same idea as Stryker/mutmut, applied to agent trajectories.)
- **Assert any intermediate step** —`answer.contains` / `answer.matches` / `answer.judge` take an optional 1-based `step` to check a mid-trajectory response, not just the last one:
  ```yaml
  - { kind: answer.contains, step: 1, text: "first draft" }   # an intermediate answer
  - { kind: answer.contains, text: "final answer" }           # default: last step
  ```
- **Semantic cassette diff** —`traceplay diff` no longer reports a one-word prompt edit as a removed+added pair; hash-different but highly-similar requests are paired as a single **changed** step showing the `from`/`to` prompt and answer.
- **Recorder hardening** —binds to `127.0.0.1` by default, optional management token (`--token` / `TRACEPLAY_TOKEN`), and rejects orphan `tool.result`s that reference an unknown call.
- **176 tests**, including a 10-step ordered trajectory, repeated-prompt sequencing, exhausted/out-of-order paths, killed/survived mutation paths, step assertions, semantic-diff pairing, and the recorder security surface.

See [Multi-step replay & mutation testing](#multi-step-replay--mutation-testing) below.

## What's new in v0.5 —trustworthy replay on real, drifting agents

v0.5 closes the single most important gap for a record/replay tool: **the request matcher**. A multi-step agent carries its full conversation history in every request, so a one-word edit to step 1 used to change the hash of every later step, and the only fallback was an order-blind token overlap that could silently replay the *wrong* response. The matcher is now layered and ambiguity-aware.

- **Four-layer matching** —`exact (L0) 鈫?semantic (L1) 鈫?structured (L2) 鈫?fuzzy (L3)`. L0/L1 are deterministic hash lookups; L1 folds whitespace and drops sampling noise (`seed`). L2 is a role-aware, order-aware similarity that weights the **current user intent** above shared boilerplate. L3 token-overlap is last-resort recall and is gated by the same intent anchor.
- **Ambiguity detection** —when the two best candidates are almost tied, the replayer returns **`409 Conflict`** instead of guessing. A silent wrong replay is worse than a hard miss for a regression suite.
- **Drift diagnosis** —every miss (`404`) reports the incoming intent and the closest recorded request, so you can see *where* the trajectory diverged instead of guessing.
- **Determinism contract** —checked-in **golden fixtures** (`fixtures/golden/`) lock canonicalization hashes and replay output byte-for-byte; cassettes carry an explicit schema version with a migration error for unknown versions.
- **Hardening** —secret body fields and tool-call arguments are now redacted *before* they touch a cassette (the replayer redacts identically, so rotating an API key never causes a miss); `tool.args equals` ignores object-key order.
- **136 tests**, including adversarial negatives, role/order permutations, a 5-step context-drift fixture, ambiguity cases, HTTP-level 409/404 tests, golden contracts, end-to-end redaction, and record/replay parity.

See [Request matching](#request-matching-why-replay-stays-trustworthy) for the full model.

## What's new in v0.4

- **Edge-case generation** —`traceplay generate --skill <SKILL.md> --out <dir>` derives boundary test inputs (empty, special chars, extreme length, off-topic, role-confusion) from a skill description and generates a runnable suite.
- **Matrix runner** —`traceplay matrix --config matrix.yaml` runs multiple suites (one per model/prompt variant) into a comparison scorecard.
- **Coverage** —`traceplay coverage <suite.yaml>` shows which assertion kinds you use and which trace event types are untested.
- **Plugin system** —`registerAssertion('custom.x', fn)` adds assertion kinds usable directly from `suite.yaml`.

## What's new in v0.3

- **Web dashboard** —`traceplay ui --cassettes <dir>` opens a local explorer of your cassettes as visual event timelines.
- **Cassette diff** —`traceplay diff <a.jsonl> <b.jsonl>` compares two runs (before/after a prompt change) and reports added/removed requests, changed responses, and tool-call changes.
- **TypeScript SDK** —the whole CLI is now a thin wrapper over a public API: `import { startRecorder, runTest, compareCassettes } from 'traceplay'`.
- **Tool-call recording** —the recorder exposes `POST /__traceplay/tool.call` and `POST /__traceplay/tool.result` so agents can record tool activity in the same cassette (disable with `--no-tools`).

## What's new in v0.2

- **Streaming support** —record and replay OpenAI-compatible SSE streams; the recorder pipes chunks to your agent in real time while capturing content + usage.
- **Fuzzy replay** —`traceplay replay --fuzzy` falls back to similarity matching when the exact hash misses (threshold configurable via `--fuzzy-threshold`). Exact matching stays the deterministic default.
- **Gemini provider** —normalize `:generateContent` / `:streamGenerateContent` endpoints.
- **`traceplay inspect <cassette.jsonl>`** —timeline + token stats for any cassette.
- **GitHub Action** —`traceplay/action` composite action for one-line CI.
- **pre-commit hook** —`.pre-commit-hooks.yaml` + `traceplay init --pre-commit`.

## Commands

### `traceplay record`

Start a recording proxy. Point your agent's `BASE_URL` at `http://localhost:<port>`.

```bash
traceplay record [--port 8123] [--upstream https://api.openai.com/v1] [--out cassette.jsonl] [--project name] [--no-redact] [--host 127.0.0.1] [--token <secret>]
```

- `--port`: local proxy port (default 8123)
- `--upstream`: real LLM provider URL (default OpenAI)
- `--out`: cassette output path (default `cassette.jsonl`)
- `--project`: project name stored in cassette metadata
- `--no-redact`: disable secret redaction (not recommended)
- `--host`: interface to bind (default `127.0.0.1`, loopback-only; binding elsewhere prints a warning). Or set `TRACEPLAY_HOST`.
- `--token`: when set, the `/__traceplay/tool.*` management endpoints require this secret as `Authorization: Bearer <token>` or `x-traceplay-token: <token>` (or set `TRACEPLAY_TOKEN`)

Supports OpenAI-compatible `/chat/completions` and Anthropic `/v1/messages` endpoints. Authorization headers and secret body fields are redacted before persistence. Each recorded request is tagged with its 0-based `turn` and the previous request's `parentId`; each `tool.call` is assigned a `callId`, and a `tool.result` that references an unknown call is rejected.

### `traceplay replay`

Start an offline replay server from a cassette. Replay is **stateful and ordered by default**: it walks the recorded trajectory step by step, so a repeated prompt replays its 1st, 2nd, 3rd recorded response in sequence. Within each step, incoming requests are matched in layers —exact and semantic hashes first (deterministic), then role/order-aware structured similarity and finally token-overlap recall when `--fuzzy` is set. On a hit, the recorded response is returned exactly —including streaming SSE responses —and the `x-traceplay-match` response header reports which layer matched.

```bash
traceplay replay --cassette cassette.jsonl [--port 8124] [--fuzzy] [--stateless] \
  [--structured-threshold 0.55] [--fuzzy-threshold 0.6] [--ambiguity-gap 0.1]
```

- `--cassette`: path to a recorded cassette (required)
- `--port`: local server port (default 8124)
- `--fuzzy`: enable the L2/L3 similarity layers (L0/L1 always run)
- `--stateless`: disable ordered replay and scan the whole cassette for every request (the v0.5 behavior)
- `--structured-threshold`: minimum L2 structured score (0..1, default 0.55)
- `--fuzzy-threshold`: minimum L3 token-overlap score (0..1, default 0.6)
- `--ambiguity-gap`: required gap between the best and runner-up candidate (0..1, default 0.1)

Responses: a hit returns the recorded bytes; a tie the matcher cannot resolve returns **`409 Conflict`**; once every recorded step is consumed an extra request returns **`404`** with an `exhausted` diagnosis; an unmatched request returns **`404`** with a drift diagnosis. No network calls are ever made.

### `traceplay inspect`

Pretty-print a cassette: event timeline, token usage, tool calls, errors.

```bash
traceplay inspect cassette.jsonl
```

### `traceplay test`

Run a test suite against one or more cassettes.

```bash
traceplay test suite.yaml [--format console|json|markdown|html] [--output report.html]
```

- `suite.yaml|suite.json`: test suite file (required)
- `--format`: output format (default `console`; `html` writes a self-contained trajectory report)
- `--output`: write report to file instead of stdout

A case may carry an `each` list of rows; its assertion template then runs once
per row with `{{ key }}` placeholders substituted (data-driven tests). Exit code
0 = all pass, 1 = any failure, 2 = usage error.

### `traceplay mutate`

Mutation-test the suite itself. For every assertion that passes on the real cassette, traceplay injects a fault into a copy of the cassette and re-runs that assertion: if it flips to fail the fault was **killed** (the assertion is effective); if it stays green it **survived** (the assertion is too weak to catch that regression).

```bash
traceplay mutate suite.yaml [--format console|json] [--output report.txt] [--no-strict]
```

| Mutator | Fault injected | Should be caught by |
|---|---|---|
| `answer.text` / `answer.drop` | replace / empty the targeted answer | `answer.contains` / `matches` / `judge` |
| `tool.drop-call` | remove a tool call and its result | `tool.called` / `tool.order` |
| `tool.inject-forbidden` | inject a call to the banned tool | `forbid.tool` |
| `tool.args` | perturb every primitive argument value | `tool.args` |
| `budget.tokens` | multiply every token count 脳100 | `budget.maxTokens` |
| `budget.steps` | append an extra LLM step | `budget.maxSteps` |

Exit code 0 = no mutation survived (or `--no-strict`); 1 = at least one survived. Use it to keep a regression suite honest as it grows.

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
| `answer.contains` | answer contains text (optionally at step N) | `{ kind: answer.contains, text: "sunny" }` |
| `answer.matches` | answer matches regex (optionally at step N) | `{ kind: answer.matches, regex: "\\d+C" }` |
| `answer.judge` | LLM-as-judge with rubric (cached, optional step) | `{ kind: answer.judge, rubric: "mentions temperature" }` |
| `answer.shape` | answer is valid JSON matching `required` paths / typed `fields` (optional step) | `{ kind: answer.shape, required: ["$.id"], fields: { "$.id": "string" } }` |
| `flow.usesResult` | answer cites value(s) a named tool returned (anti-hallucination) | `{ kind: flow.usesResult, tool: get_ticket, minHits: 2 }` |
| `budget.maxTokens` | total token usage 鈮?value | `{ kind: budget.maxTokens, value: 2000 }` |
| `budget.maxSteps` | number of LLM requests 鈮?value | `{ kind: budget.maxSteps, value: 5 }` |

`tool.args` supports `equals` (exact JSON match) or `matches` (regex). The answer kinds accept an optional **`step`** (1-based among `llm.response` events) to assert an intermediate answer; omit it to target the final answer (the default). `answer.shape` validates structured (JSON-mode) answers: `required` lists JSONPaths that must exist, and `fields` maps a JSONPath to a type (`string`/`number`/`integer`/`boolean`/`array`/`object`/`null`) or to `{ equals?, contains?, matches?, enum? }`; `$.items[*].id` checks every element. `flow.usesResult` collects the primitive values a tool returned and fails unless the answer cites `minHits` of them (use `fromPath` to select one value). A case-level **`each`** list of rows runs the assertion template once per row with `{{ key }}` substitution. User-supplied regexes are screened for catastrophic nested quantifiers and refused rather than allowed to hang the run. `answer.judge` requires `TRACEPLAY_JUDGE_API_KEY` and caches verdicts (keyed by answer, rubric, model **and** API base) to `.traceplay/judge-cache/` for deterministic reruns; without a key it is marked `todo`, and judge calls carry a 30s timeout.

Full field-by-field reference with troubleshooting: [docs/assertions.md](docs/assertions.md)

## Reporters

- **console** (default): human-readable pass/fail output
- **json**: structured `TestReport` for programmatic consumption
- **markdown**: PR-comment-ready table with pass/fail icons
- **html**: single self-contained file —verdict card, per-case trajectory timeline and assertions; no server or external assets, safe to attach to a PR

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
your agent 鈹€鈹€BASE_URL鈹€鈹€鈻?traceplay record 鈹€鈹€鈻?LLM provider
                              鈹?                              鈻?                    cassette.jsonl (header + events)
                              鈹?              鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹粹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?              鈻?                              鈻?     traceplay replay (offline)      traceplay test (assert)
     match by requestHash             YAML assertions 鈫?exit code
```

A **cassette** is JSONL: line 0 is metadata, every subsequent line is one `TraceEvent` (`user.message`, `llm.request`, `llm.response`, `tool.call`, `tool.result`, `agent.error`). The replayer matches incoming requests through the layered matcher below and returns the corresponding recorded `llm.response` (raw body + status + headers).

Full cassette schema reference: [docs/cassette-format.md](docs/cassette-format.md)

## Request matching: why replay stays trustworthy

In a multi-step agent, **every request carries the accumulated conversation**, so a one-word change in step 1 changes the hash of steps 2 onward. A naive "exact hash, else bag-of-words similarity" matcher either misses everything after a tiny edit or —worse —silently replays the wrong response. traceplay matches in four layers and refuses to guess when it cannot decide:

| Layer | Name | What it tolerates | Deterministic? | Cost |
|---|---|---|---|---|
| L0 | `exact` | Nothing —byte-stable canonical hash | 鉁?| O(1) hash lookup |
| L1 | `semantic` | Whitespace/formatting, per-call `seed` & sampling noise | 鉁?| O(1) hash lookup |
| L2 | `structured` | Wording drift; weights the **last user message** (current intent), system prompt, and ordered flow; penalizes turn-count / role-sequence divergence | probabilistic, thresholded | O(n) |
| L3 | `fuzzy` | Token-set overlap (last-resort recall), gated by the same current-intent anchor | probabilistic, thresholded | O(n) |

L0/L1 always run and are exact hash lookups —they can never return the wrong response. L2/L3 run only with `--fuzzy`. **Ambiguity detection:** if the best and second-best candidates score within `--ambiguity-gap` (default 0.1), the replayer returns `409 Conflict` and asks you to re-record, because a test that passes against the wrong recorded answer is a false sense of safety. Every miss returns a diagnosis comparing the incoming intent with the closest recorded request.

Full algorithm, tuning guide, and failure cookbook: [docs/matching.md](docs/matching.md)

## Project structure

```
src/
鈹溾攢鈹€ cli.ts                  # entry point, command routing
鈹溾攢鈹€ types.ts                # core data model (frozen)
鈹溾攢鈹€ core/
鈹?  鈹溾攢鈹€ hash.ts             # L0/L1 canonicalization + sha256
鈹?  鈹溾攢鈹€ redact.ts           # secret redaction
鈹?  鈹溾攢鈹€ equal.ts            # key-order-insensitive deep equality
鈹?  鈹溾攢鈹€ regex-safe.ts       # ReDoS screening for user regexes
鈹?  鈹溾攢鈹€ template.ts         # {{ key }} substitution for parametrized cases
鈹?  鈹斺攢鈹€ jsonpath.ts         # minimal JSONPath evaluator
鈹溾攢鈹€ cassette/
鈹?  鈹溾攢鈹€ store.ts            # JSONL read/write
鈹?  鈹斺攢鈹€ normalize.ts        # provider request/response normalization (+ turn/parentId)
鈹溾攢鈹€ recorder/
鈹?  鈹溾攢鈹€ proxy.ts            # recording HTTP proxy (loopback bind, token, callId)
鈹?  鈹斺攢鈹€ forward.ts          # upstream request forwarding
鈹溾攢鈹€ replayer/
鈹?  鈹溾攢鈹€ server.ts           # offline replay server (stateful session / 404 / 409)
鈹?  鈹溾攢鈹€ matcher.ts          # layered matcher + ordered ReplaySession
鈹?  鈹斺攢鈹€ link.ts             # shared request鈫抮esponse linkage
鈹溾攢鈹€ mutate/
鈹?  鈹溾攢鈹€ mutators.ts         # fault-injection operators (answer/tool/budget)
鈹?  鈹斺攢鈹€ runner.ts           # mutation testing runner + score
鈹溾攢鈹€ assert/
鈹?  鈹溾攢鈹€ engine.ts           # assertion dispatcher
鈹?  鈹溾攢鈹€ judge.ts            # LLM-as-judge with disk cache + timeout
鈹?  鈹斺攢鈹€ matchers/
鈹?      鈹溾攢鈹€ tool.ts         # tool.called/order/args/forbid
鈹?      鈹溾攢鈹€ answer.ts       # answer.contains/matches/judge (+ step)
鈹?      鈹溾攢鈹€ structure.ts    # answer.shape + flow.usesResult (v0.7)
鈹?      鈹斺攢鈹€ budget.ts       # budget.maxTokens/maxSteps
鈹溾攢鈹€ suite/
鈹?  鈹斺攢鈹€ expand.ts           # expand each-row parametrized cases (shared test/mutate)
鈹溾攢鈹€ report/
鈹?  鈹溾攢鈹€ console.ts          # console reporter
鈹?  鈹溾攢鈹€ json.ts             # JSON reporter
鈹?  鈹溾攢鈹€ diff.ts             # semantic cassette diff (changed-in-place)
鈹?  鈹溾攢鈹€ markdown.ts         # Markdown reporter
鈹?  鈹溾攢鈹€ html.ts             # self-contained HTML report (v0.7)
鈹?  鈹斺攢鈹€ timeline.ts         # compress events into a renderable timeline
鈹溾攢鈹€ commands/
鈹?  鈹溾攢鈹€ record.ts           # `traceplay record`
鈹?  鈹溾攢鈹€ replay.ts           # `traceplay replay`
鈹?  鈹溾攢鈹€ test.ts             # `traceplay test`
鈹?  鈹溾攢鈹€ mutate.ts           # `traceplay mutate`
鈹?  鈹斺攢鈹€ init.ts             # `traceplay init`
鈹斺攢鈹€ skills/
    鈹溾攢鈹€ runner.ts           # mock agent skill runner
    鈹斺攢鈹€ adapter.ts          # generate test suites from skills
```

## Comparison

| | traceplay | promptfoo | Langfuse / Phoenix | skillkit / skilllint | single-call replay mocks |
|---|---|---|---|---|---|
| What it tests | Full multi-step **trajectories** | Prompt/eval outputs & assertions | Production traces | Skill markdown structure | One isolated LLM call |
| Replay | Offline, deterministic, **zero-token**, layered matching | Caches/real calls, not trajectory replay | No | No | Yes, but single request only |
| Language | Any (HTTP-boundary proxy) | TS / Python | SDK-specific | TS / Python | SDK-specific |
| Where it runs | Local + CI | Local + CI | Hosted / self-hosted | Local + CI | Local |
| Assertions | 11 kinds: tools, order, args, answer, **JSON shape**, **tool鈫抋nswer data-flow**, budget, forbidden; data-driven via `each` | Eval assertions + scoring | Metrics & dashboards | Lint rules | Response snapshot only |
| Mismatch safety | Ambiguity 鈫?`409`, never a silent wrong replay; ordered replay for repeated prompts | —| —| —| Often first/any match |
| Asserts the tests | Built-in **mutation testing** (`traceplay mutate`) proves each assertion catches injected faults | —| —| —| —|
| Report artifact | console / json / markdown / **self-contained HTML trajectory** | json / web UI | Dashboards | —| text |
| Best for | Regression-gating agent behavior offline | Prompt eval & version management | Observability & debugging | Linting skill packages | Unit-level response stubs |

**traceplay vs promptfoo —complementary, not competing.** promptfoo excels at *evaluating and comparing prompts/models*; traceplay excels at *regression-gating a whole agent run offline with zero tokens*. Use promptfoo to choose your prompt and traceplay to lock down the resulting multi-step behavior in CI. Observability platforms (Langfuse, Phoenix) watch what happens in production; traceplay deterministically replays what happened on your machine. Skill linters check markdown, not behavior.

## CI integration (GitHub Action)

Drop a step into your workflow —no build setup needed:

```yaml
- uses: traceplay/action@v0.7.0
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
    rev: v0.7.0
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

Reports requests **changed in place** (a prompt edit that didn't add/remove a step), added/removed requests, changed responses, and tool-call changes. A one-word prompt edit is paired as a single changed step (with `from`/`to`) instead of a misleading removed+added pair.

## Multi-step replay & mutation testing

### Why ordered replay matters

Consider an agent that drafts in a loop —it sends the same prompt `"continue"` three times and gets three different drafts. A stateless matcher that scans the whole cassette for every request replays the *first* draft all three times. A stateful session keeps a cursor:

```
recorded steps:   [continue 鈫?draft-1] [continue 鈫?draft-2] [final 鈫?done]
stateful replay:  continue 鈬?draft-1   continue 鈬?draft-2   final   鈬?done   鉁?stateless replay: continue 鈬?draft-1   continue 鈬?draft-1   final   鈬?done   鉂?```

At step *k* the session only considers recorded steps *k onward*, so the work shrinks as the replay progresses and a repeated prompt naturally hits its next occurrence. Use it from the SDK for fine control:

```typescript
import { createReplaySession } from 'traceplay';
const session = createReplaySession(cassette.events);
session.match(requestBody1); // 鈫?step 1, advances cursor
session.match(requestBody2); // 鈫?step 2
session.reset();             // rewind to step 1
```

### Why mutation testing matters

A test that passes no matter what is worse than no test —it gives false confidence. `traceplay mutate` turns that intuition into a number. It mutates the cassette and asks "does this assertion catch it?":

```
  KILLED    answer.contains [answer.text]   —answer does not contain "refund issued"
  SURVIVED  answer.matches  [answer.text]   —answer matches /.*/
Mutation score: 50%  (1 killed, 1 survived, 0 skipped)
```

The `.*` regex matches the mutated answer too, so it **survives** —a clear signal to write a tighter assertion. Aim for a 100% mutation score on the assertions that guard critical behavior. Run it in CI alongside `traceplay test`; it exits non-zero whenever a fault escapes.


## TypeScript SDK

The entire CLI is a thin wrapper over a public API:

```typescript
import { startRecorder, startReplayer, runTest, compareCassettes, runAssertions } from 'traceplay';

// record a session programmatically
const recorder = await startRecorder({ port: 8123, upstream: 'https://api.openai.com/v1', cassettePath: './c.jsonl', redact: true });

// compare two cassettes in a test
const report = compareCassettes(a, b);
```

## Edge-case generation

Generate a boundary-input test suite for any Agent Skill:

```bash
traceplay generate --skill ./skills/code-review/SKILL.md --out ./skill-tests
traceplay test ./skill-tests/suite.yaml
```

Creates cassettes for empty input, whitespace, special characters, numeric
extremes, extreme length, off-topic, and role-confusion prompts.

## Matrix runner

Compare multiple suites (e.g. one per model or prompt variant):

```yaml
# matrix.yaml
runs:
  - { name: gpt-4o,   suite: suites/gpt-4o/suite.yaml }
  - { name: claude-3, suite: suites/claude-3/suite.yaml }
format: markdown
```

```bash
traceplay matrix --config matrix.yaml --output matrix-report.md
```

## Coverage

See which behaviors your suite does and doesn't exercise:

```bash
traceplay coverage suite.yaml
```

## Plugin system

Add custom assertion kinds in your own code:

```typescript
import { registerAssertion } from 'traceplay';
registerAssertion('custom.minEvents', ({ events, assertion }) => ({
  status: events.length >= (assertion.min as number) ? 'pass' : 'fail',
  message: `events=${events.length}`,
}));
```

```yaml
# suite.yaml
- { kind: custom.minEvents, min: 5 }
```

## Development

```bash
npm install
npm run build
npm test          # 212 tests, incl. structured/data-flow assertions, ordered replay, mutation testing, layered matching, redaction & golden contracts
npm run dev -- test examples/demo/suite.example.yaml
```

## License

MIT — see [LICENSE](./LICENSE).
