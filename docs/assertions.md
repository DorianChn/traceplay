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

### `answer.contains`

Asserts that the final LLM response text contains the given substring
(case-sensitive).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `text` | string | yes | Substring to search for |

```yaml
- { kind: answer.contains, text: "sunny" }
```

### `answer.matches`

Asserts that the final LLM response text matches the given regular expression.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `regex` | string | yes | Regular expression (JS syntax) |

```yaml
- { kind: answer.matches, regex: "\\d+\\s*C" }
```

### `answer.judge`

Uses an LLM-as-judge to evaluate the final answer against a free-form rubric.
Requires `TRACEPLAY_JUDGE_API_KEY` (OpenAI-compatible endpoint). Verdicts are
cached to `.traceplay/judge-cache/<sha256>.json` for deterministic reruns.
Without a key, the assertion is marked `todo` (does not fail the suite).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `rubric` | string | yes | Evaluation criteria in natural language |
| `model` | string | no | Judge model (defaults to `gpt-4o-mini`) |

```yaml
- { kind: answer.judge, rubric: "mentions temperature and conditions" }
```

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
