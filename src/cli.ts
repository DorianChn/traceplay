#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { VERSION } from './version.js';
import { runRecord } from './commands/record.js';
import { runReplay } from './commands/replay.js';
import { runTest, type ReportFormat } from './commands/test.js';
import { runInit } from './commands/init.js';

const HELP = `traceplay v${VERSION} — record, replay, and test AI agent trajectories

Usage:
  traceplay record [--port <p>] [--upstream <url>] [--out <file>] [--project <name>] [--no-redact]
  traceplay replay --cassette <file> [--port <p>]
  traceplay test <suite.yaml|suite.json> [--format console|json|markdown] [--output <file>]
  traceplay init [dir]
  traceplay version
`;

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

const VALID_FORMATS = new Set(['console', 'json', 'markdown']);

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
      });
    }

    case 'test': {
      const suite = positional[0];
      if (!suite) {
        console.error('Usage: traceplay test <suite.yaml> [--format ...] [--output ...]');
        return 2;
      }
      const format = typeof flags.format === 'string' ? flags.format : undefined;
      if (format && !VALID_FORMATS.has(format)) {
        console.error(`Unknown format "${format}". Expected one of: console, json, markdown`);
        return 2;
      }
      return runTest({
        suite,
        format: format as ReportFormat | undefined,
        output: typeof flags.output === 'string' ? flags.output : undefined,
      });
    }

    case 'init':
      return runInit({ dir: positional[0] });

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
