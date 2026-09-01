import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateSuite, runTest } from '../src/commands/test.js';

const EXAMPLE_CASSETTE = fileURLToPath(
  new URL('../examples/demo/cassette.example.jsonl', import.meta.url),
);

async function writeTemp(name: string, content: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'tp-suite-'));
  const p = join(dir, name);
  await fs.writeFile(p, content, 'utf8');
  return p;
}

describe('suite validation', () => {
  it('rejects a suite missing a cases array', async () => {
    const p = await writeTemp('bad.yaml', 'suite: no-cases\n');
    await expect(evaluateSuite(p)).rejects.toThrow(/"cases" array/);
  });

  it('rejects a case missing a cassette path', async () => {
    const p = await writeTemp(
      'bad.yaml',
      'suite: x\ncases:\n  - name: c\n    assertions: []\n',
    );
    await expect(evaluateSuite(p)).rejects.toThrow(/"cassette" path/);
  });

  it('rejects a case missing an assertions array', async () => {
    const p = await writeTemp(
      'bad.yaml',
      `suite: x\ncases:\n  - name: c\n    cassette: ${EXAMPLE_CASSETTE.replace(/\\/g, '/')}\n`,
    );
    await expect(evaluateSuite(p)).rejects.toThrow(/"assertions" array/);
  });

  it('wraps a missing suite file with a clear message', async () => {
    const p = join(tmpdir(), `tp-nope-${Date.now()}.yaml`);
    await expect(evaluateSuite(p)).rejects.toThrow(/Cannot read suite file/);
  });

  it('rejects malformed YAML with the suite path in the message', async () => {
    const p = await writeTemp('bad.yaml', 'suite: x\ncases: [unterminated\n  - bad: : :\n');
    await expect(evaluateSuite(p)).rejects.toThrow(/Failed to parse suite/);
  });

  it('runTest rejects an unknown report format', async () => {
    const p = await writeTemp(
      'ok.yaml',
      `suite: x\ncases:\n  - name: c\n    cassette: ${EXAMPLE_CASSETTE.replace(/\\/g, '/')}\n    assertions: []\n`,
    );
    await expect(
      runTest({ suite: p, format: 'xml' as never }),
    ).rejects.toThrow(/Unknown report format/);
  });
});
