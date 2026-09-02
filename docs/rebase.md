# Rebasing and maintaining cassettes (v0.8)

A cassette is a snapshot of one agent run. As your agent evolves — prompts
change, tools get swapped, models get upgraded — some recorded steps become stale
while others are still perfectly valid. Re-recording every cassette from scratch
is slow and costs tokens. v0.8 gives you three commands to maintain cassettes
without starting over.

## 1. `traceplay rebase` — merge a partial re-record

The core workflow:

1. You have an existing cassette `run.jsonl` with 5 steps.
2. You change the prompt for steps 1 and 3 only.
3. You re-run the agent with the recorder on, but the agent only emits the
   changed steps — or you re-record the whole run and want to keep only what
   changed. The result is `run-rerecorded.jsonl`.
4. Merge:

```bash
traceplay rebase run.jsonl run-rerecorded.jsonl --output run.merged.jsonl
```

The output cassette contains:

- **updated** — steps present in both cassettes where the response changed. The
  new recording wins by default (`--strategy theirs`). Use `--strategy ours` to
  keep the old response.
- **unchanged** — steps present in both with identical responses. The old
  cassette's bytes are kept (timestamps and ids preserved).
- **added** — steps only in the new recording.
- **retained** — steps only in the old cassette (the new recording didn't cover
  them). These are appended after the new recording's steps, so a partial prefix
  re-record produces the correct full trajectory.

```
rebase → run.merged.jsonl
  events:    10
  unchanged: 2
  updated:   2 (response changed, head wins)
  added:     1
  retained:  2 (from base, not re-recorded)

updated segments:
  [a1b2c3d4e5f6]
    base: The answer is 42.
    head: The answer is 43 (corrected).
```

### How segments are matched

A **segment** is one `llm.request` plus every event until the next request
(its response, tool calls, tool results). Segments are matched by request
fingerprint, in priority order:

1. `semanticHash` (v0.5+, whitespace/sampling-noise insensitive)
2. `requestHash` (exact canonical body)
3. canonicalized `messages` JSON (fallback for very old cassettes)

Repeated identical fingerprints (e.g. an agent that loops "continue") are matched
in order — the Nth request in the new recording matches the Nth matching request
in the old one.

### When to use `--strategy ours`

Default (`theirs`) assumes the new recording is authoritative. Use `ours` when
you re-recorded only to capture a new step, and the old responses for overlapping
steps are still the ones you want (e.g. you re-recorded with a different model
and want to keep the original provider's responses).

### Programmatic API

```ts
import { readCassette, rebaseCassettes, writeCassette } from 'traceplay';

const base = await readCassette('run.jsonl');
const head = await readCassette('run-rerecorded.jsonl');
const { cassette, summary, updates } = rebaseCassettes(base, head, { prefer: 'head' });
await writeCassette('run.merged.jsonl', cassette.meta, cassette.events);
```

## 2. `traceplay shape-from-schema` — generate assertions from a schema

If your agent returns structured JSON (JSON mode, or a tool/function schema), you
already have a schema somewhere — an OpenAI function definition, a JSON Schema
file, or a TypeScript type. Instead of hand-writing `answer.shape` fields,
generate them:

```bash
traceplay shape-from-schema ticket.schema.json --step 1 --output assertions.yaml
```

Output:

```yaml
- kind: answer.shape
  step: 1
  required:
    - "$.ticket"
    - "$.meta.zone"
  fields:
    "$.ticket":      { matches: "^TC-\\d+$", type: "string" }
    "$.priority":    { enum: ["low", "high"], type: "string" }
    "$.tags":        "array"
    "$.tags[*]":     "string"
    "$.meta":        "object"
    "$.meta.zone":   "string"
```

Paste this into a suite's `assertions:` list. The converter is best-effort: it
handles `type`, `properties`, `required`, `items` (→ `$.path[*]`), `enum`,
`pattern` (→ `matches`), `const` (→ `equals`), and nested objects. Keywords it
doesn't understand (`minimum`, `maxLength`, `oneOf`, `$ref`) are silently
skipped — review the output and add manual checks where needed.

It also accepts an OpenAI function definition (`{ name, parameters: {...} }`) and
uses the `parameters` subtree automatically.

## 3. `traceplay doctor` — catch cassette rot before CI does

Cassettes degrade silently: a tool call gets interrupted mid-recording, a provider
stops returning `usage`, a response comes back empty. These don't crash replay,
but they make assertions silently weaker (e.g. `budget.maxTokens` always reads 0).

```bash
traceplay doctor run.jsonl
```

```
doctor — run.jsonl
  events: 12  requests: 3  responses: 3  tool.calls: 2  tool.results: 2
  1 error(s), 2 warning(s), 0 info

  ✗ [ERROR] ORPHAN_RESULT [seq 9]: tool.result with callId "call_7f3" has no matching tool.call
  ! [WARNING] NO_USAGE [seq 4]: llm.response has no usage — budget.maxTokens will read as 0
  ! [WARNING] EMPTY_OUTPUT [seq 4]: llm.response has empty output
```

Exit code is **1 when any error-level finding exists**, so you can gate CI on
cassette health. Warnings and info exit 0. `--json` emits the full finding list
for custom tooling.

Checks include: orphan `tool.result` / `llm.response`, missing responses/results,
empty outputs, missing `usage`, non-200 responses, `seq` gaps and duplicates,
`agent.error` events, duplicate request hashes, and pre-v0.5 cassettes without
`semanticHash`.

## Typical maintenance loop

```bash
# 1. Change the agent, re-record only the affected steps (or the whole run)
traceplay record --out run-rerecorded.jsonl

# 2. Merge onto the existing cassette
traceplay rebase run.jsonl run-rerecorded.jsonl --output run.jsonl

# 3. Verify the merged cassette is healthy
traceplay doctor run.jsonl

# 4. If the agent now returns structured JSON, generate shape assertions
traceplay shape-from-schema agent-output.schema.json --output shape-assertions.yaml

# 5. Re-run the test suite
traceplay test suite.yaml
```
