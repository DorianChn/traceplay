# Asserting structured answers, data flow, and sharing a report (v0.7)

v0.6 made a whole **trajectory** replayable offline. v0.7 makes the same
trajectory *assertable in the ways real agents behave today*:

1. Agents increasingly return **structured JSON** (JSON mode, tool/function
   schemas). A substring check cannot validate its shape.
2. A multi-step agent is supposed to **use the values its tools returned**. An
   answer that ignores them is a hallucination even if it "sounds right".
3. You often want **one assertion template over many expected values** instead
   of copy-pasting a case per value.
4. A regression review is easier when a CI run produces a **single shareable
   artifact** showing both the trajectory and the assertions.

This guide covers the four v0.7 additions. A complete, runnable version lives in
[`../examples/structured/`](../examples/structured/).

---

## 1. `answer.shape` — validate structured output

The targeted answer must parse as JSON, then satisfy `required` paths and
`fields` expectations.

```yaml
- kind: answer.shape
  step: 3                         # optional: 1-based response, default = final
  json: true                      # default; set false to skip the JSON parse
  required: ["$.ticket", "$.assignee"]
  fields:
    "$.ticket":      { matches: "^TC-\\d+$" }
    "$.priority":    { enum: [low, high] }
    "$.assignee":    "string"
    "$.slaHours":    "integer"
    "$.tags[*]":     "string"
    "$.nextStep":    { contains: "mina" }
```

### Types

A bare field value is a type: `string`, `number`, `integer`, `boolean`,
`array`, `object`, `null`. (`integer` additionally requires a whole number.)

### Expectation keys

| Key | Passes when |
| --- | --- |
| `type` | value matches the primitive type |
| `equals` | value is deeply equal (object key order ignored) |
| `contains` | the stringified value contains the substring |
| `matches` | it matches the (ReDoS-screened) regex |
| `enum` | it equals one of the listed candidates |

Every matched value for a path is checked, so `$.tags[*]: "string"` fails if any
tag is not a string. A path that matches nothing fails with `not found`, and a
single result message lists **all** problems at once.

### When the answer is prose

If the model returns prose rather than JSON, `answer.shape` fails with
`answer is not valid JSON`. Either target the structured step with `step`,
record with JSON mode enabled, or set `json: false` to run checks against the raw
text (only `$` will resolve, to a `string`).

---

## 2. `flow.usesResult` — prove the answer used its tools (anti-hallucination)

A tool call is only useful if its output flows into the answer. This assertion
links a `tool.call` to its `tool.result` (by `callId`), collects the values the
tool returned, and requires the answer to cite them.

```yaml
- kind: flow.usesResult
  tool: get_ticket     # which tool's result must be consumed
  fromPath: $.ticket   # optional: use one value instead of every leaf
  minHits: 2           # distinct values that must appear (default 1)
  step: 3              # optional answer to check (default = final)
```

How it works:

1. Find every `tool.call` for `tool`, follow its `callId` to the `tool.result`.
2. Collect candidate values. By default these are the result's **primitive
   leaves** (strings 3–120 chars and finite numbers). Use `fromPath` to select a
   specific JSONPath value instead.
3. Count how many distinct candidates occur in the targeted answer
   (case-insensitive). Pass when `count >= minHits`.

> The 3-char floor and 120-char ceiling avoid nonsense matches on tokens like
> `"ok"` or on a whole serialized object. For precise control, name the value
> with `fromPath`.

**Example.** `get_ticket` returned
`{ ticket: "TC-4821", assignee: "mina" }`. An answer *"I routed TC-4821 to
mina"* cites two values and passes (`minHits: 2`); *"Someone will look at it
soon"* cites zero and fails — the agent ignored its tool.

---

## 3. `each` — data-driven cases

Put an `each` list on a case and the assertion template runs once per row, with
`{{ key }}` substituted in every string field.

```yaml
- name: key entities are echoed
  cassette: run.jsonl
  each:
    - { value: TC-4821 }
    - { value: mina }
  assertions:
    - { kind: answer.contains, text: "{{value}}" }
```

You get one labeled result per row (`name #1 [value=TC-4821]`,
`name #2 [value=mina]`). The same expansion applies to `traceplay mutate`, so a
parametrized suite is mutation-tested row by row. An unknown placeholder is left
as written rather than silently emptied.

---

## 4. The self-contained HTML report

```bash
traceplay test suite.yaml --format html --output report.html
```

`report.html` is one static file — inline CSS, **no external requests** — with:

- a verdict card (pass/fail/todo counts, pass-rate bar);
- per case, a **Trajectory** timeline (event chips, turn number, HTTP status,
  token count, error flags) beside the **Assertions** list;
- all cassette/assertion text HTML-escaped.

Open it locally, attach it to a pull request, or upload it as a CI artifact:

```yaml
- run: npx traceplay test suite.yaml --format html --output traceplay.html
- uses: actions/upload-artifact@v4
  with:
    name: traceplay-report
    path: traceplay.html
```

---

## 5. Combine with mutation testing

`answer.shape` and `flow.usesResult` guard structured behavior; `traceplay
mutate` then checks those guards are not vacuous. Assertion kinds without a
dedicated fault operator are reported as `skip` (never as a false kill), while
text/tool/budget assertions are mutated as usual.

```bash
traceplay test   examples/structured/suite.structured.yaml
traceplay mutate examples/structured/suite.structured.yaml
traceplay test   examples/structured/suite.structured.yaml --format html --output report.html
```
