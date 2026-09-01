#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { VERSION } from './version.js';
import { runRecord } from './commands/record.js';
import { runReplay } from './commands/replay.js';
import { runTest, type ReportFormat } from './commands/test.js';
import { runInit } from './commands/init.js';
import { runInspect } from './commands/inspect.js';
import { runUI } from './commands/ui.js';
import { runDiff } from './commands/diff.js';
import { runGenerate } from './commands/generate.js';
import { runMatrixCmd } from './commands/matrix.js';
import { runCoverage } from './commands/coverage.js';
import { runMutate } from './commands/mutate.js';

const HELP = `traceplay v${VERSION} — record, replay, and test AI agent trajectories

Usage:
  traceplay record [--port <p>] [--upstream <url>] [--out <file>] [--project <name>] [--no-redact] [--no-tools] [--host 127.0.0.1] [--token <secret>]
  traceplay replay --cassette <file> [--port <p>] [--fuzzy] [--fuzzy-threshold <0..1>] [--structured-threshold <0..1>] [--ambiguity-gap <0..1>] [--stateless]
  traceplay test <suite.yaml|suite.json> [--format console|json|markdown|html] [--output <file>]
  traceplay mutate <suite.yaml|suite.json> [--format console|json] [--output <file>] [--no-strict]
  traceplay inspect <cassette.jsonl>
  traceplay diff <a.jsonl> <b.jsonl>
  traceplay ui --cassettes <dir> [--port <p>]
  traceplay generate --skill <SKILL.md> --out <dir> [--base <prompt>]
  traceplay matrix --config <matrix.yaml> [--format console|markdown|json] [--output <file>]
  traceplay coverage <suite.yaml>
  traceplay init [dir] [--pre-commit]
  traceplay version
`;

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

const VALID_FORMATS = new Set(['console', 'json', 'markdown']);
const TEST_FORMATS = new Set(['console', 'json', 'markdown', 'html']);

/** Parse a --port flag value, rejecting non-integers and out-of-range ports. */
export function parsePort(value: string | boolean | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`invalid port "${value}": expected an integer between 1 and 65535`);
  }
  return n;
}

/** Parse a 0..1 similarity/threshold flag, rejecting non-numbers and out-of-range values. */
export function parseScore(value: string | boolean | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`invalid ${flag} "${value}": expected a number between 0 and 1`);
  }
  return n;
}

export function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);

  switch (command) {
    case 'version':
      console.log(VERSION);
      return 0;

    case 'record':
      return runRecord({
        port: parsePort(flags.port),
        upstream: typeof flags.upstream === 'string' ? flags.upstream : undefined,
        out: typeof flags.out === 'string' ? flags.out : undefined,
        project: typeof flags.project === 'string' ? flags.project : undefined,
        noRedact: flags['no-redact'] === true,
        noTools: flags['no-tools'] === true,
        host: typeof flags.host === 'string' ? flags.host : undefined,
        token: typeof flags.token === 'string' ? flags.token : undefined,
      });

    case 'replay': {
      const cassette = typeof flags.cassette === 'string' ? flags.cassette : positional[0];
      if (!cassette) {
        console.error('Usage: traceplay replay --cassette <file> [--port <p>]');
        return 2;
      }
      return runReplay({
        cassette,
        port: parsePort(flags.port),
        fuzzy: flags.fuzzy === true,
        fuzzyThreshold: parseScore(flags['fuzzy-threshold'], '--fuzzy-threshold'),
        structuredThreshold: parseScore(flags['structured-threshold'], '--structured-threshold'),
        ambiguityGap: parseScore(flags['ambiguity-gap'], '--ambiguity-gap'),
        stateless: flags.stateless === true,
      });
    }

    case 'inspect': {
      const cassette = typeof flags.cassette === 'string' ? flags.cassette : positional[0];
      if (!cassette) {
        console.error('Usage: traceplay inspect <cassette.jsonl>');
        return 2;
      }
      return runInspect({ cassette });
    }

    case 'diff': {
      const [a, b] = positional;
      if (!a || !b) {
        console.error('Usage: traceplay diff <a.jsonl> <b.jsonl>');
        return 2;
      }
      return runDiff({ a, b });
    }

    case 'ui': {
      const cassettes = typeof flags.cassettes === 'string' ? flags.cassettes : positional[0];
      if (!cassettes) {
        console.error('Usage: traceplay ui --cassettes <dir> [--port <p>]');
        return 2;
      }
      return runUI({ cassettes, port: parsePort(flags.port) });
    }

    case 'generate': {
      const skill = typeof flags.skill === 'string' ? flags.skill : positional[0];
      const out = typeof flags.out === 'string' ? flags.out : positional[1];
      if (!skill || !out) {
        console.error('Usage: traceplay generate --skill <SKILL.md> --out <dir> [--base <prompt>]');
        return 2;
      }
      return runGenerate({ skill, out, base: typeof flags.base === 'string' ? flags.base : undefined });
    }

    case 'matrix': {
      const config = typeof flags.config === 'string' ? flags.config : positional[0];
      if (!config) {
        console.error('Usage: traceplay matrix --config <matrix.yaml> [--format ...] [--output ...]');
        return 2;
      }
      const matrixFormat = typeof flags.format === 'string' ? flags.format : undefined;
      if (matrixFormat && !VALID_FORMATS.has(matrixFormat)) {
        console.error(`Unknown format "${matrixFormat}". Expected one of: console, json, markdown`);
        return 2;
      }
      return runMatrixCmd({
        config,
        format: matrixFormat as 'console' | 'markdown' | 'json' | undefined,
        output: typeof flags.output === 'string' ? flags.output : undefined,
      });
    }

    case 'coverage': {
      const suite = positional[0];
      if (!suite) {
        console.error('Usage: traceplay coverage <suite.yaml>');
        return 2;
      }
      return runCoverage({ suite });
    }

    case 'test': {
      const suite = positional[0];
      if (!suite) {
        console.error('Usage: traceplay test <suite.yaml> [--format ...] [--output ...]');
        return 2;
      }
      const format = typeof flags.format === 'string' ? flags.format : undefined;
      if (format && !TEST_FORMATS.has(format)) {
        console.error(`Unknown format "${format}". Expected one of: console, json, markdown, html`);
        return 2;
      }
      return runTest({
        suite,
        format: format as ReportFormat | undefined,
        output: typeof flags.output === 'string' ? flags.output : undefined,
      });
    }

    case 'mutate': {
      const suite = positional[0];
      if (!suite) {
        console.error('Usage: traceplay mutate <suite.yaml> [--format console|json] [--output <file>] [--no-strict]');
        return 2;
      }
      const mutateFormat = typeof flags.format === 'string' ? flags.format : undefined;
      if (mutateFormat && mutateFormat !== 'console' && mutateFormat !== 'json') {
        console.error(`Unknown format "${mutateFormat}". Expected one of: console, json`);
        return 2;
      }
      return runMutate({
        suite,
        format: mutateFormat as 'console' | 'json' | undefined,
        output: typeof flags.output === 'string' ? flags.output : undefined,
        strict: flags['no-strict'] !== true,
      });
    }

    case 'init':
      return runInit({ dir: positional[0], preCommit: flags['pre-commit'] === true });

    case '--help':
    case '-h':
    case 'help':
    case undefined:
      console.log(HELP);
      return 0;

    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

// Run only when invoked directly as a CLI. Importing this module (from tests
// or SDK consumers) must not start servers or process.exit.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      // User-facing errors print a clean one-line message. Set TRACEPLAY_DEBUG=1
      // for the full stack trace when diagnosing an internal bug.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`error: ${message}`);
      if (process.env.TRACEPLAY_DEBUG && err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      process.exit(1);
    });
}
