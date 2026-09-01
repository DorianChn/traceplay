# Multi-step replay & mutation testing (v0.6)

This document covers the two v0.6 features that make traceplay treat a whole
agent **trajectory** — not a single LLM call — as the unit of replay and test:

1. **Ordered, stateful replay** for agents that loop and repeat prompts.
2. **Mutation testing** that proves your assertions actually catch regressions.

---

## 1. Ordered replay

### The problem with stateless matching on a loop

Agents frequently send the same request more than once:

- a writer agent that calls the model with `"continue"` until the draft ends;
- a planner that asks `"what's next?"` after every tool call;
- a retry wrapper that resends an identical body after a tool failure.

A stateless matcher scans the *whole* cassette for every incoming request, so
the second and third `"continue"` both replay the **first** recorded draft —
the agent then reacts to a stale answer and the trajectory diverges.

### How the session works

`createReplaySession(events, options)` keeps a cursor `consumed` (the number of
recorded `llm.request` steps already played):

- at step *k*, only recorded requests with order ≥ *k* are candidates (the
  not-yet-consumed **suffix**);
- a hit on recorded order *o* advances the cursor to *o + 1*;
- the N-th identical prompt therefore matches the N-th recorded occurrence
  naturally, with no special case for duplicates;
- when the suffix is empty the outcome is `exhausted`;
- when no forward match exists but the request matches an already-consumed
  step, the diagnosis says so (`out of recorded order`);
- `reset()` rewinds the cursor to zero.

Order comes from the recorded `turn` field when present, otherwise from event
sequence — so cassettes recorded by v0.1–v0.5 work unchanged.

### CLI and SDK

```bash
# ordered by default; --stateless restores the v0.5 global scan
traceplay replay --cassette run.jsonl --port 8124
traceplay replay --cassette run.jsonl --stateless
```

```typescript
import { createReplaySession, readCassette } from 'traceplay';

const cassette = await readCassette('run.jsonl');
const session = createReplaySession(cassette.events, { fuzzy: true });

for (const liveRequest of agentRequests) {
  const outcome = session.match(liveRequest);
  // outcome.found / .requestIndex / .responseIndex / .strategy / .diagnostic
}
```

### Complexity & benchmark

- A stateless scan is O(n) per request and O(n²) for an n-step trajectory.
- The ordered session scans only the remaining suffix, so total work is the
  triangular sum ≈ O(n²/2) with a smaller constant, and the *per-request* cost
  **decreases** as replay progresses. L0/L1 hits are O(suffix) hash probes and
  return immediately.
- A locked test replays a 200-step trajectory in well under 1 second
  (`tests/replay-session.test.ts` → "scales linearly"). On typical 5–20 step
  agent runs matching is effectively instant.

### When to use `--stateless`

Use the global scan when requests genuinely arrive out of order relative to
the recording (parallel fan-out, a load-balanced client that reorders), or when
you replay one cassette against many independent single-shot requests. For a
single agent walking one trajectory in order, keep the default.

---

## 2. Mutation testing

### Green is not enough

A suite can be 100% green and still worthless: an assertion such as
`answer.matches: ".*"` passes for *any* answer, including a broken one.
Traditional coverage cannot see this. Mutation testing borrows the idea from
Stryker/mutmut and applies it to agent trajectories: **inject a fault and check
that the test fails**. If it still passes, the assertion has a hole.

### Status of each (assertion × mutator) pair

| Status | Meaning | Counted in score? |
|---|---|---|
| `killed` | The injected fault made the assertion fail — it is effective | yes |
| `survived` | The assertion stayed green despite the fault — strengthen it | yes |
| `baseline-failed` | The assertion already fails on the real cassette | skipped |
| `no-mutator` | No applicable mutator / no target to mutate in this cassette | skipped |
| `todo` | e.g. an `answer.judge` with no judge API key | skipped |

`mutationScore = killed / (killed + survived)` — skipped items never inflate
the score.

### Mutators and the assertions they challenge

| Mutator | Injected fault | Targets |
|---|---|---|
| `answer.text` | replace the targeted answer with a fixed wrong string | `answer.contains/matches/judge` |
| `answer.drop` | empty the targeted answer | same |
| `tool.drop-call` | remove a tool call (and its linked result) | `tool.called`, `tool.order` |
| `tool.inject-forbidden` | inject a call to the banned tool | `forbid.tool` |
| `tool.args` | perturb every primitive value in the tool arguments | `tool.args` |
| `budget.tokens` | multiply every recorded token count ×100 | `budget.maxTokens` |
| `budget.steps` | append an extra LLM request/response | `budget.maxSteps` |

`answer.*` mutators honor the assertion's `step`, so a step-2 assertion is
challenged by mutating step 2 specifically.

### Run it

```bash
traceplay mutate suite.yaml                 # console, exits 1 on any survivor
traceplay mutate suite.yaml --format json   # machine-readable
traceplay mutate suite.yaml --no-strict     # report only, always exit 0
```

```typescript
import { runMutationTesting, listMutators } from 'traceplay';
const report = await runMutationTesting(cassette.events, assertions);
console.log(report.mutationScore, report.killed, report.survived);
```

### Workflow

1. Get `traceplay test` green.
2. Run `traceplay mutate`. Every critical-path assertion should be `killed`.
3. For each `survived`, tighten the assertion (specific substring/value, a
   narrower regex, an exact tool-arg equality, a realistic budget).
4. Add `traceplay mutate` to CI (it gates on survivors by default) so the
   suite does not quietly become vacuous as it grows.

### A note on scope

Mutation testing deliberately mutates a **deep copy** — the loaded cassette
and its event array are never modified (locked by a test). Mutators are
deterministic and offline; like the rest of traceplay they make no network
calls.
