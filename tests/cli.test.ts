import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { runTest } from '../src/commands/test.js';
import { runInit } from '../src/commands/init.js';
import { parseArgs, parsePort } from '../src/cli.js';

const EXAMPLE_SUITE = fileURLToPath(new URL('../examples/demo/suite.example.yaml', import.meta.url));

describe('commands/test', () => {
  it('runs the example suite and exits 0', async () => {
    const code = await runTest({ suite: EXAMPLE_SUITE });
    expect(code).toBe(0);
  });

  it('outputs JSON format when requested', async () => {
    const outPath = join(tmpdir(), `tp-cli-${Date.now()}.json`);
    const code = await runTest({ suite: EXAMPLE_SUITE, format: 'json', output: outPath });
    expect(code).toBe(0);
    const raw = await fs.readFile(outPath, 'utf8');
    const report = JSON.parse(raw);
    expect(report.suite).toBe('demo');
    expect(report.summary.pass).toBeGreaterThan(0);
    expect(report.summary.fail).toBe(0);
    await fs.unlink(outPath).catch(() => undefined);
  });

  it('outputs Markdown format when requested', async () => {
    const outPath = join(tmpdir(), `tp-cli-${Date.now()}.md`);
    const code = await runTest({ suite: EXAMPLE_SUITE, format: 'markdown', output: outPath });
    expect(code).toBe(0);
    const raw = await fs.readFile(outPath, 'utf8');
    expect(raw).toContain('traceplay test report');
    expect(raw).toContain('| PASS |');
    await fs.unlink(outPath).catch(() => undefined);
  });

  it('exits 2 when suite path missing', async () => {
    // runTest itself doesn't validate args; the CLI does.
    // We test that a non-existent file throws.
    await expect(runTest({ suite: '/nonexistent/suite.yaml' })).rejects.toThrow();
  });
});

describe('commands/init', () => {
  it('scaffolds a project directory', async () => {
    const dir = join(tmpdir(), `tp-init-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const code = await runInit({ dir });
    expect(code).toBe(0);

    const suite = await fs.readFile(join(dir, 'suite.yaml'), 'utf8');
    expect(suite).toContain('suite: my-agent');
    expect(suite).toContain('answer.contains');

    const cassettesDir = join(dir, 'cassettes');
    expect(await fs.stat(cassettesDir)).toBeDefined();

    const gitignore = await fs.readFile(join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('traceplay');

    // cleanup
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });
});

describe('cli/parseArgs', () => {
  it('parses flags with space-separated values and boolean flags', () => {
    const { positional, flags } = parseArgs(['suite.yaml', '--format', 'json', '--fuzzy']);
    expect(positional).toEqual(['suite.yaml']);
    expect(flags).toEqual({ format: 'json', fuzzy: true });
  });

  it('parses --flag=value syntax', () => {
    const { positional, flags } = parseArgs(['--port=9999', '--format=json', 'x']);
    expect(positional).toEqual(['x']);
    expect(flags).toEqual({ port: '9999', format: 'json' });
  });

  it('treats a flag with no value as a boolean', () => {
    const { flags } = parseArgs(['--fuzzy', '--verbose']);
    expect(flags).toEqual({ fuzzy: true, verbose: true });
  });
});

describe('cli/parsePort', () => {
  it('returns undefined when no value is given', () => {
    expect(parsePort(undefined)).toBeUndefined();
    expect(parsePort(true)).toBeUndefined();
  });

  it('parses a valid integer port', () => {
    expect(parsePort('8123')).toBe(8123);
  });

  it('rejects non-numeric, out-of-range, and non-integer ports', () => {
    expect(() => parsePort('abc')).toThrow(/invalid port/);
    expect(() => parsePort('0')).toThrow(/invalid port/);
    expect(() => parsePort('70000')).toThrow(/invalid port/);
    expect(() => parsePort('80.5')).toThrow(/invalid port/);
  });
});
