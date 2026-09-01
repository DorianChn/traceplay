#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { startRecorder } from './recorder/proxy.js';
import { readCassette } from './cassette/store.js';
import { runAssertions } from './assert/engine.js';
import { formatCase, formatSummary, summarize } from './report/console.js';
import { VERSION } from './version.js';
import type { AssertResult, TestSuite } from './types.js';

const argv = process.argv.slice(2);
const [command, ...rest] = argv;

const HELP = `traceplay v${VERSION} — VCR + pytest for AI agents

Usage:
  traceplay record --port <p> --upstream <url> --out <cassette.jsonl>
  traceplay replay --cassette <file> --port <p>      (M2)
  traceplay test <suite.yaml|suite.json>
  traceplay init [dir]                                (M4)
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
  switch (command) {
    case 'version':
      console.log(VERSION);
      return 0;
    case 'record':
      return cmdRecord(rest);
    case 'test':
      return cmdTest(rest);
    case 'replay':
      console.log('[traceplay] replay lands in M2 — see ROADMAP.md');
      return 0;
    case 'init':
      console.log('[traceplay] init lands in M4 — copy examples/demo to start now.');
      return 0;
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

async function cmdRecord(args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  const port = Number(flags.port ?? 8123);
  const upstream = String(flags.upstream ?? 'https://api.openai.com/v1');
  const out = String(flags.out ?? 'cassette.jsonl');
  const handle = await startRecorder({ port, upstream, cassettePath: out, redact: true });
  console.log(`[traceplay] recording on http://localhost:${handle.port} -> ${out}`);
  console.log('[traceplay] point your agent BASE_URL here. Ctrl+C to stop.');
  // M1: write cassette header on start, append events per request.
  return await new Promise<number>((resolve) => {
    const shutdown = async () => {
      await handle.close();
      resolve(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

async function cmdTest(args: string[]): Promise<number> {
  const { positional } = parseArgs(args);
  const suitePath = positional[0];
  if (!suitePath) {
    console.error('Usage: traceplay test <suite.yaml|suite.json>');
    return 2;
  }
  const raw = await fs.readFile(suitePath, 'utf8');
  const suite: TestSuite = suitePath.endsWith('.json')
    ? (JSON.parse(raw) as TestSuite)
    : (parseYaml(raw) as TestSuite);

  const suiteDir = dirname(isAbsolute(suitePath) ? suitePath : resolve(process.cwd(), suitePath));
  const allResults: AssertResult[] = [];

  for (const testCase of suite.cases) {
    const cassettePath = isAbsolute(testCase.cassette)
      ? testCase.cassette
      : resolve(suiteDir, testCase.cassette);
    const cassette = await readCassette(cassettePath);
    const results = runAssertions(cassette.events, testCase.assertions);
    allResults.push(...results);
    console.log(formatCase(testCase, results));
  }

  const summary = summarize(allResults);
  console.log(formatSummary(summary));
  return summary.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
