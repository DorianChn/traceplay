# Request matching in depth

The matcher is the heart of a record/replay tool. If it returns the wrong
recorded response, your test passes for the wrong reason — which is more
dangerous than failing. This document explains the problem traceplay solves
and the four-layer matcher v0.5 uses to solve it safely.

## 1. Why naive matching breaks on multi-step agents

A single-turn client sends one self-contained request, so hashing the request
body works perfectly. A multi-step agent does not: **every request carries the
accumulated conversation.**

```
step 1 → [u1]
step 2 → [u1, a1, u2]
step 3 → [u1, a1, u2, a2, u3]
```

Change one word in `u1` and the request body of steps 2…N all change — so an
exact-hash matcher misses every later step. Falling back to a bag-of-words
overlap is unsafe because it ignores order and speaker role: "ask then act"
and "act then ask" collapse to the same token set.

## 2. The four layers

`matchRequest` tries layers in order and returns on the first hit.

| Layer | Strategy | Tolerates | Deterministic | When it runs |
|---|---|---|---|---|
| L0 | `exact` | key ordering, volatile metadata (`id`, timestamps, `stream`) | yes | always |
| L1 | `semantic` | whitespace/formatting, per-call `seed` and sampling noise | yes | always |
| L2 | `structured` | wording drift while the current intent is preserved | no (thresholded) | `--fuzzy` |
| L3 | `fuzzy` | broader token-set overlap | no (thresholded) | `--fuzzy`, after L2 misses |

- **L0** is `sha256(canonicalize(body))` with sorted keys and a fixed set of
  volatile metadata keys removed.
- **L1** is `sha256(semanticCanonicalize(body))`: the same process, plus
  collapsing runs of whitespace and dropping sampling-noise fields such as
  `seed`. It is still a hash lookup — it can only hit an *identical-after-
  normalization* request, never a "similar" one, so it cannot mis-match.
- **L2/L3** are O(n) scans over recorded requests and only run when the two
  deterministic lookups miss and `--fuzzy` is enabled.

Recorded requests store both `requestHash` (L0) and `semanticHash` (L1).
Cassettes recorded by v0.1–v0.4 only have `requestHash`; L1 is then computed
on the fly, so old cassettes keep working.

Before any layer runs, both sides apply the **same** `redactBody` pass:
secret-shaped fields (`api_key`, `token`, `password`, …) are replaced with
`[REDACTED]`. The recorder does this before persisting/hashing, and the
replayer does it before matching, so (a) cassettes never hold raw credentials
and (b) rotating or differing API keys never causes a match miss. The raw
request bytes forwarded to the upstream provider during recording are not
modified.

## 3. Structured similarity (L2)

Whole-text overlap is split by role and order, then weighted:

1. **Current intent (weight 0.5)** — the *last user message*. This anchors what
   the agent is asking for right now.
2. **System prompt (weight 0.2)** — shared instructions.
3. **Ordered flow (weight 0.3)** — the full conversation, compared with an
   order-sensitive metric.

Each piece is scored with **Sørensen–Dice over token bigrams**, which (unlike a
token-set Jaccard) is sensitive to word order. Two structural penalties apply:

- turn-count difference `d` multiplies the score by `0.9 ^ d`;
- a different role sequence (`user/assistant/...`) multiplies it by `0.9`.

## 4. Intent-anchored recall (L3)

L3 keeps the order-insensitive token-set Jaccard for maximum recall, but it is
**gated by the current-intent anchor**: if the last-user-message similarity is
below `INTENT_ANCHOR_FLOOR` (0.34), the candidate's score is scaled down
proportionally. This stops a request whose words overlap but whose live intent
differs — including role-reversed conversations — from being rescued by shared
boilerplate.

## 5. Ambiguity detection

Probabilistic matches are never accepted on raw score alone. If the best and
runner-up candidates score within `--ambiguity-gap` (default 0.1), the matcher
returns an **ambiguous** outcome and the replayer responds with HTTP
`409 Conflict` instead of guessing. Lower the gap deliberately (accept closer
calls) or re-record with a more specific cassette to resolve it.

## 6. Tuning knobs

| Flag | Default | Effect |
|---|---|---|
| `--structured-threshold` | 0.55 | Minimum L2 score to accept |
| `--fuzzy-threshold` | 0.6 | Minimum L3 score to accept |
| `--ambiguity-gap` | 0.1 | Minimum best-vs-runner-up separation |

Raise thresholds for stricter (safer) matching in CI; lower them when exploring
a rapidly changing prompt. Prefer keeping `--fuzzy` off in locked-down release
CI so only deterministic L0/L1 matches count.

## 7. Reading failures

- **404 `no cassette match`** — the body includes `incoming last-user message`
  and the `closest recorded request`, with scores. Use them to see exactly
  where the trajectory diverged, then re-record.
- **409 `ambiguous cassette match`** — two recorded responses fit almost
  equally; the matcher refuses to choose. Make your recorded cases more
  distinct or lower `--ambiguity-gap` consciously.
- Response header **`x-traceplay-match`** reports the layer that produced each
  hit (`exact` / `semantic` / `structured` / `fuzzy`), and
  `x-traceplay-score` reports the similarity score for probabilistic layers.

## 8. Determinism contract

`fixtures/golden/` contains a checked-in cassette plus the exact canonical
hashes of fixed request bodies. `tests/golden-contract.test.ts` asserts that
these hashes and the replayed bytes never change unintentionally. If you change
canonicalization, the golden test fails — update the golden files deliberately
and review the diff rather than letting replay drift silently. Cassette files
also carry an explicit schema `version`; an unknown version produces a clear
migration error instead of a confusing parse failure.
