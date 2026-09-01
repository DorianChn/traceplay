import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { runTest } from '../src/commands/test.js';
import { runInit } from '../src/commands/init.js';

const EXAMPLE_SUITE = join('C:', 'Users', '36712', 'Desktop', 'traceplay', 'examples', 'demo', 'suite.example.yaml');

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
