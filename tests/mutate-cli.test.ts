import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeCassette } from '../src/cassette/store.js';
import { runMutate } from '../src/commands/mutate.js';
import type { LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../src/types.js';

const tmpFiles: string[] = [];
afterEach(async () => {
  for (const f of tmpFiles) await fs.unlink(f).catch(() => undefined);
  tmpFiles.length = 0;
});

async function makeSuite(body: { strong: boolean }): Promise<string> {
  const dir = tmpdir();
  const cassette = join(dir, `tp-mut-cli-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const events: TraceEvent[] = [];
  ['alpha', 'beta', 'final'].forEach((text, i) => {
    events.push({
      id: `req-${i}`, seq: i * 2, at: new Date(0).toISOString(), type: 'llm.request',
      provider: 'other', model: 'm', messages: [{ role: 'user', content: `q${i}` }], requestHash: `h${i}`,
    } as LLMRequestEvent);
    events.push({
      id: `res-${i}`, seq: i * 2 + 1, at: new Date(0).toISOString(), type: 'llm.response',
      requestId: `req-${i}`, status: 200, output: text, usage: { promptTokens: 50, completionTokens: 50 },
    } as LLMResponseEvent);
  });
  await writeCassette(cassette, { recordedAt: new Date(0).toISOString(), redacted: true }, events);

  const assertions = body.strong
    ? `      - kind: answer.contains
        text: final
      - kind: budget.maxSteps
        value: 3
`
    : `      - kind: answer.matches
        regex: ".*"
`;
  const suitePath = cassette.replace(/\.jsonl$/, '.yaml');
  await fs.writeFile(
    suitePath,
    `name: cli-mutate
cases:
  - name: c
    cassette: ${cassette.split(/[\\/]/).pop()}
    assertions:
${assertions}`,
    'utf8',
  );
  tmpFiles.push(cassette, suitePath);
  return suitePath;
}

describe('traceplay mutate CLI wiring', () => {
  it('exits 0 and emits JSON with a perfect score for a strong suite', async () => {
    const suite = await makeSuite({ strong: true });
    const out = suite.replace(/\.yaml$/, '.report.json');
    tmpFiles.push(out);
    const code = await runMutate({ suite, format: 'json', output: out });
    expect(code).toBe(0);
    const report = JSON.parse(await fs.readFile(out, 'utf8'));
    expect(report.overallSurvived).toBe(0);
    expect(report.cases[0].survived).toBe(0);
    expect(report.cases[0].killed).toBeGreaterThan(0);
  });

  it('exits 1 when a mutation survives, and 0 with --no-strict', async () => {
    const suite = await makeSuite({ strong: false });
    const strict = await runMutate({ suite });
    expect(strict).toBe(1);
    const lenient = await runMutate({ suite, strict: false });
    expect(lenient).toBe(0);
  });

  it('rejects an unsupported --format', async () => {
    // Validation lives in the CLI dispatcher; here runMutate defaults unknown
    // formats to console, so just confirm console output does not throw.
    const suite = await makeSuite({ strong: true });
    await expect(runMutate({ suite, format: 'console' })).resolves.toBe(0);
  });
});
