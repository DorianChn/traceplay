#!/usr/bin/env node
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

const HELP = `traceplay v${VERSION} — record, replay, and test AI agent trajectories

Usage:
  traceplay record [--port <p>] [--upstream <url>] [--out <file>] [--project <name>] [--no-redact] [--no-tools]
  traceplay replay --cassette <file> [--port <p>] [--fuzzy] [--fuzzy-threshold <0..1>]
  traceplay test <suite.yaml|suite.json> [--format console|json|markdown] [--output <file>]
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

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
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
        port: typeof flags.port === 'string' ? Number(flags.port) : undefined,
        upstream: typeof flags.upstream === 'string' ? flags.upstream : undefined,
        out: typeof flags.out === 'string' ? flags.out : undefined,
        project: typeof flags.project === 'string' ? flags.project : undefined,
        noRedact: flags['no-redact'] === true,
        noTools: flags['no-tools'] === true,
      });

    case 'replay': {
      const cassette = typeof flags.cassette === 'string' ? flags.cassette : positional[0];
      if (!cassette) {
        console.error('Usage: traceplay replay --cassette <file> [--port <p>]');
        return 2;
      }
      return runReplay({
        cassette,
        port: typeof flags.port === 'string' ? Number(flags.port) : undefined,
        fuzzy: flags.fuzzy === true,
        fuzzyThreshold:
          typeof flags['fuzzy-threshold'] === 'string' ? Number(flags['fuzzy-threshold']) : undefined,
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
      return runUI({ cassettes, port: typeof flags.port === 'string' ? Number(flags.port) : undefined });
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
      return runMatrixCmd({
        config,
        format: (typeof flags.format === 'string' ? flags.format : undefined) as 'console' | 'markdown' | 'json' | undefined,
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
      const format = (typeof flags.format === 'string' ? flags.format : undefined) as ReportFormat | undefined;
      return runTest({
        suite,
        format,
        output: typeof flags.output === 'string' ? flags.output : undefined,
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

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
