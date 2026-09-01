# Cassette format

A traceplay cassette is a **JSONL** file (one JSON object per line). Line 0
is a metadata header; every subsequent line is a `TraceEvent`.

```
line 0:  { "cassette": "traceplay", "version": 1, ... }
line 1:  { "id": "e1", "seq": 0, "type": "user.message", ... }
line 2:  { "id": "e2", "seq": 1, "type": "llm.request", ... }
line 3:  { "id": "e3", "seq": 2, "type": "llm.response", ... }
...
```

## Header (line 0)

| Field | Type | Description |
| --- | --- | --- |
| `cassette` | string | Always `"traceplay"` — used to identify the file format |
| `version` | number | Cassette schema version (currently `1`). An unknown version raises an explicit migration error on read |
| `recordedAt` | string | ISO 8601 timestamp of recording start |
| `redacted` | boolean | Whether secrets have been redacted (`true` by default) |
| `providerBaseUrl` | string | Upstream base URL the recorder forwarded to |
| `project` | string | Optional project label (from `--project` flag) |

## TraceEvent

Every event shares these fields:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique event ID (e.g. `"e1"`) |
| `seq` | number | Monotonic sequence number (0-based) |
| `at` | string | ISO 8601 timestamp |
| `type` | string | Event type (see below) |

### `user.message`

A message from the user to the agent.

| Field | Type | Description |
| --- | --- | --- |
| `content` | string | The user's message text |

### `llm.request`

An outgoing request to an LLM provider (normalized).

| Field | Type | Description |
| --- | --- | --- |
| `provider` | string | Normalized provider: `openai-compatible`, `anthropic`, `gemini` |
| `model` | string | Model name |
| `messages` | array | Chat messages (OpenAI format; Anthropic/Gemini are normalized) |
| `system` | string | System prompt (Anthropic-style; optional) |
| `stream` | boolean | Whether this was a streaming request |
| `requestHash` | string | L0 match key: `sha256(canonicalize(body))` |
| `semanticHash` | string | L1 match key (recorded since v0.5): `sha256(semanticCanonicalize(body))`, whitespace folded and sampling noise removed. Absent in older cassettes; computed on replay |

### `llm.response`

A recorded LLM response.

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | string | `id` of the corresponding `llm.request` |
| `status` | number | HTTP status code (e.g. `200`, `401`) |
| `output` | object | Raw response body (provider-specific; `choices[]` for OpenAI, `content[]` for Anthropic) |
| `stream` | boolean | Whether the response was streamed |
| `usage` | object | Token usage: `{ promptTokens, completionTokens }` |

### `tool.call`

A tool invocation by the agent.

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | Tool name |
| `arguments` | object | Tool arguments (JSON object) |

### `tool.result`

The result of a tool call.

| Field | Type | Description |
| --- | --- | --- |
| `callId` | string | `id` of the corresponding `tool.call` |
| `output` | string | Tool output (stringified) |

### `agent.error`

An error encountered during the agent run.

| Field | Type | Description |
| --- | --- | --- |
| `message` | string | Error message |
| `stack` | string | Optional stack trace |

## Provider normalization

The recorder normalizes requests from three provider families before storing:

| Provider | Endpoint pattern | Normalized `provider` |
| --- | --- | --- |
| OpenAI-compatible | `/chat/completions` | `openai-compatible` |
| Anthropic | `/v1/messages` | `anthropic` |
| Google Gemini | `:generateContent`, `:streamGenerateContent` | `gemini` |

Responses are stored in their original provider format. The assertion engine
extracts answer text from both OpenAI (`choices[0].message.content`) and
Anthropic (`content[].text`) formats.

## Redaction

The recorder automatically redacts sensitive fields before writing to the
cassette:

- **Headers**: `authorization`, `api-key`, `x-api-key`, `cookie` → `[REDACTED]`
- **Body fields**: `api_key`, `secret`, `password`, `token` → `[REDACTED]`

The header's `redacted: true` field confirms that redaction was applied.

## Replay matching

The replayer matches incoming requests by `requestHash`:
`sha256(canonicalize(requestBody))`. Volatile fields (`stream`, `id`,
`timestamp`, `user`, etc.) are excluded from canonicalization so that
otherwise-identical requests match. If no exact match is found and `--fuzzy`
is enabled, the replayer falls back to Jaccard similarity (default threshold
`0.6`).

## Example

See `examples/demo/cassette.example.jsonl` for a complete, runnable cassette
with a user message, LLM request, tool call, tool result, and LLM response.
