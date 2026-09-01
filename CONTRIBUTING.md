# Contributing to traceplay

Thanks for your interest in improving traceplay! This document covers how to
set up a development environment, run tests, and submit changes.

## Development setup

```bash
# Node.js 20+ required
node --version

# Install dependencies
npm install

# Build (TypeScript -> dist/)
npm run build

# Run the full test suite
npm test

# Run the CLI directly from source (no build needed)
npm run dev -- --help
npm run dev -- test examples/demo/suite.example.yaml
```

## Project structure

```
src/
  cli.ts                 # CLI entry point (parseArgs + command dispatch)
  commands/              # One file per CLI command (record, replay, test, ...)
  recorder/              # Recording proxy (forward + proxy)
  replayer/              # Offline replay server (matcher + server)
  cassette/              # JSONL cassette store, normalization, SSE streaming
  assert/                # Assertion engine + matchers (tool/answer/budget/judge)
  report/                # Console / JSON / Markdown reporters
  skills/                # Agent Skills adapter (SKILL.md -> mock agent -> cassette)
  core/                  # hash, redact, jsonpath
  ui/                    # (v0.3+) local web dashboard
  matrix/                # (v0.4+) multi-suite comparison runner
  generate/              # (v0.4+) edge-case test generation
tests/                   # Vitest unit + integration tests
examples/                # Example suites and cassettes
```

## Running a single test

```bash
npx vitest run tests/assert.test.ts
npx vitest run tests/integration.test.ts -t "gzip"
```

## Code style

- TypeScript with `strict` mode enabled (`tsconfig.json`).
- 2-space indentation, LF line endings (see `.editorconfig`).
- No runtime dependencies beyond `yaml` — keep the CLI fast to install.
- Public functions should have JSDoc comments explaining intent, not just
  what the code does.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add fuzzy matching for replay
fix: preserve non-200 status codes in recorder
test: add gzip decompression integration test
docs: update README with GitHub Action usage
chore: bump dependencies
```

## Pull request checklist

- [ ] `npm run build` passes with no errors
- [ ] `npm test` passes (all tests green)
- [ ] New functionality includes tests
- [ ] Documentation (`README.md`, `CHANGELOG.md`) updated if relevant
- [ ] No unrelated changes mixed into the PR

## Reporting bugs

Please use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
and include:

- The traceplay version (`traceplay version`)
- A minimal reproduction (cassette + suite YAML if relevant)
- Expected vs actual behavior

## Feature requests

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).
We prioritize features that fit the project's core mission: **deterministic,
offline regression testing for AI agent trajectories**.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities privately.
