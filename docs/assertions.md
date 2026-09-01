# Assertions reference

Every assertion in a `suite.yaml` case is an object with a `kind` field.
The test engine evaluates assertions in order; a case passes when all its
assertions pass.

```yaml
suite: my-agent
cases:
  - name: descriptive case name
    cassette: ./path/to/cassette.jsonl
    assertions:
      - { kind: tool.called, name: search }
      - { kind: answer.contains, text: "expected phrase" }
```

## Tool assertions

### `tool.called`

Asserts that a tool with the given name was invoked at least once (or exactly
`times` times).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Tool name to match |
| `times` | number | no | Exact call count (omit for "at least one") |

```yaml
- { kind: tool.called, name: get_weather }
- { kind: tool.called, name: get_weather, times: 2 }
```

### `tool.order`

Asserts that tools were invoked in the given subsequence (not necessarily
consecutive).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `names` | string[] | yes | Expected tool call order |

```yaml
- { kind: tool.order, names: [search, summarize] }
```

### `tool.args`

Asserts that at least one call of the named tool has arguments matching a
JSONPath expression. Supports `equals` (exact JSON value match) or `matches`
(regex on stringified value).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Tool name to match |
| `jsonPath` | string | yes | JSONPath into `arguments` (e.g. `$.city`, `$.items[0].id`) |
| `equals` | unknown | no* | Exact value to match (JSON equality) |
| `matches` | string | no* | Regex to test against the matched value |

\* One of `equals` or `matches` is required. If `jsonPath` is missing or
empty, the assertion fails with a clear message (does not crash).

```yaml
- { kind: tool.args, name: get_weather, jsonPath: $.city, equals: Xiamen }
- { kind: tool.args, name: search, jsonPath: $.query, matches: "weather|forecast" }
```

Supported JSONPath syntax: `$.a.b`, `$.a[0]`, `$.a[*].b`. Recursive
descent (`$..`) is not supported.

### `forbid.tool`

Asserts that a tool was **never** invoked. Fails if any `tool.call` event
with the given name exists.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Forbidden tool name |

```yaml
- { kind: forbid.tool, name: execute_shell }
```

## Answer assertions

> **Targeting an intermediate step (since v0.6).** The `answer.*` assertions
> accept an optional `step` (1-based among `llm.response` events). Omit it (or
> pass 0) to assert against the **final** answer — the v0.1–v0.5 default. Use
> `step: 2` to assert against the second LLM response in a multi-step run.
>
> ```yaml
> - { kind: answer.contains, step: 1, text: "first draft" }   # intermediate
> - { kind: answer.contains, text: "done" }                    # final answer
> ```

### `answer.contains`

Asserts that the targeted LLM response text (final by default) contains the
given substring (case-sensitive).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `text` | string | yes | Substring to search for |
| `step` | number | no | 1-based response index; omit for the final answer (v0.6) |

```yaml
- { kind: answer.contains, text: "sunny" }
```

### `answer.matches`

Asserts that the targeted LLM response text (final by default) matches the
given regular expression. Patterns with catastrophic nested quantifiers (e.g.
`(a+)+`) are refused rather than allowed to hang the run.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `regex` | string | yes | Regular expression (JS syntax) |
| `step` | number | no | 1-based response index; omit for the final answer (v0.6) |

```yaml
- { kind: answer.matches, regex: "\\d+\\s*C" }
```

### `answer.judge`

Uses an LLM-as-judge to evaluate the targeted answer (final by default) against
a free-form rubric. Requires `TRACEPLAY_JUDGE_API_KEY` (OpenAI-compatible
endpoint). Verdicts are cached to `.traceplay/judge-cache/<sha256>.json` (keyed
by answer, rubric, model and API base) for deterministic reruns; judge calls
carry a 30s timeout. Without a key, the assertion is marked `todo` (does not
fail the suite).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `rubric` | string | yes | Evaluation criteria in natural language |
| `model` | string | no | Judge model (defaults to `gpt-4o-mini`) |
| `step` | number | no | 1-based response index; omit for the final answer (v0.6) |

```yaml
- { kind: answer.judge, rubric: "mentions temperature and conditions" }
```

> **Prove answer assertions work:** `traceplay mutate suite.yaml` injects a
> wrong/empty answer and confirms each answer assertion flips to fail. One that
> stays green (e.g. a `.*` regex) is reported as `survived`. See
> `docs/multi-step.md`.

### `answer.shape` (since v0.7)

Validates a **structured** answer — the JSON agents return in JSON mode or when
emitting a tool schema. The targeted answer text must parse as JSON (disable
with `json: false`), then every `required` path must exist and every `fields`
entry must hold.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `required` | string[] | no | JSONPaths that must be present |
| `fields` | map | no | JSONPath → a type name or an expectation object |
| `json` | boolean | no | Require valid JSON (default `true`) |
| `step` | number | no | 1-based response index; omit for the final answer |

A bare field value is a type name: `string`, `number`, `integer`, `boolean`,
`array`, `object`, `null`. An expectation object may use:

| Key | Meaning |
| --- | --- |
| `type` | primitive type name |
| `equals` | deep, key-order-insensitive equality |
| `contains` | substring of the (stringified) value |
| `matches` | ReDoS-screened regex |
| `enum` | value must be one of the listed candidates |

Wildcards check every element: `$.tags[*]` applies the expectation to each tag.

```yaml
- kind: answer.shape
  required: ["$.ticket", "$.priority"]
  fields:
    "$.ticket":   { matches: "^TC-\\d+$" }
    "$.priority": { enum: [low, high] }
    "$.tags[*]":  "string"
```

### `flow.usesResult` (since v0.7)

A data-flow / anti-hallucination guarantee: the targeted answer must actually
**use** value(s) the named tool returned. It links the tool's `tool.call` to its
`tool.result` (via `callId`), collects the result's primitive leaves, and counts
how many appear in the answer. This catches an agent that calls a tool, ignores
what it returned, and invents an answer.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tool` | string | yes | Tool whose result must be consumed |
| `fromPath` | string | no | JSONPath selecting a specific source value (default: all primitive leaves) |
| `minHits` | number | no | Distinct source values the answer must contain (default 1) |
| `step` | number | no | 1-based response index; omit for the final answer |

Strings shorter than 3 characters and serialized blobs longer than 120 are not
treated as citable values (they would cause false matches); matching is
case-insensitive.

```yaml
- { kind: flow.usesResult, tool: get_ticket, minHits: 2 }
- { kind: flow.usesResult, tool: lookup, fromPath: "$.data.id" }
```

## Parametrized cases — `each` (since v0.7)

Instead of copying a case once per expected value, give it an `each` list of
rows. The assertion template runs once per row, substituting `{{ key }}`
placeholders in every string field, and each row becomes a separately labeled
result. Both `traceplay test` and `traceplay mutate` expand rows identically.

```yaml
- name: every key entity is echoed
  cassette: run.jsonl
  each:
    - { value: TC-4821 }
    - { value: mina }
  assertions:
    - { kind: answer.contains, text: "{{value}}" }
```

Unknown placeholders (no matching row key) are left intact rather than silently
blanked, so a typo stays visible. See `docs/asserting-structure.md` for a full
worked example and the HTML report.

## Budget assertions

### `budget.maxTokens`

Asserts that total token usage (prompt + completion across all LLM requests)
does not exceed the value. Requires `usage` fields in `llm.response` events.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `value` | number | yes | Maximum total tokens |

```yaml
- { kind: budget.maxTokens, value: 2000 }
```

### `budget.maxSteps`

Asserts that the number of LLM requests (`llm.request` events) does not
exceed the value.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `value` | number | yes | Maximum LLM call count |

```yaml
- { kind: budget.maxSteps, value: 5 }
```

## Troubleshooting

- **`tool.args` crashes with `Cannot read properties of undefined`** — you
  likely used `path:` instead of `jsonPath:`. The field name is `jsonPath`.
- **`answer.contains` always passes** — check that the cassette has a
  `llm.response` event with content. Streaming cassettes store accumulated
  text in `output.content`.
- **`budget.maxTokens` shows 0 tokens** — the cassette's `llm.response`
  events are missing `usage` fields. Re-record with a provider that returns
  usage, or add `usage` manually.
- **`answer.judge` is always `todo`** — `TRACEPLAY_JUDGE_API_KEY` is not
  set. Set it to enable judging; `todo` does not fail the suite.
- **`answer.shape` says "not valid JSON"** — the targeted answer is prose, not
  JSON. Either point `step` at the structured response, wrap the model output in
  JSON mode, or set `json: false` to run field checks against the raw text.
- **`flow.usesResult` reports "no citable value"** — the tool result has no
  primitive leaf between 3 and 120 characters (e.g. only booleans or a large
  blob). Use `fromPath` to name the exact value to look for in the answer.
