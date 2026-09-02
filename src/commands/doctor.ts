import { readCassette } from '../cassette/store.js';
import { diagnoseCassette, doctorExitCode, type DoctorResult } from '../cassette/doctor.js';

export interface DoctorArgs {
  cassette: string;
  json?: boolean;
}

const LEVEL_ICON: Record<string, string> = { error: '✗', warning: '!', info: 'i' };

/**
 * `traceplay doctor <cassette.jsonl> [--json]`
 *
 * Diagnose a cassette's health: orphan events, missing responses/results,
 * empty outputs, missing usage, seq gaps, non-200 responses, agent errors.
 */
export async function runDoctor(args: DoctorArgs): Promise<number> {
  const cassette = await readCassette(args.cassette);
  const result: DoctorResult = diagnoseCassette(cassette);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`doctor — ${args.cassette}`);
    console.log(
      `  events: ${result.eventCount}  requests: ${result.requestCount}  responses: ${result.responseCount}  ` +
        `tool.calls: ${result.toolCallCount}  tool.results: ${result.toolResultCount}`,
    );
    console.log(
      `  ${result.counts.error} error(s), ${result.counts.warning} warning(s), ${result.counts.info} info`,
    );
    if (result.findings.length > 0) {
      console.log('');
      for (const f of result.findings) {
        const seq = typeof f.seq === 'number' ? ` [seq ${f.seq}]` : '';
        console.log(`  ${LEVEL_ICON[f.level] || ' '} [${f.level.toUpperCase()}] ${f.code}${seq}: ${f.message}`);
      }
    } else {
      console.log('  ✓ no issues found');
    }
  }

  return doctorExitCode(result);
}
