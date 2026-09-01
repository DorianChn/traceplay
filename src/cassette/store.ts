import { promises as fs } from 'node:fs';
import type { Cassette, CassetteMeta, TraceEvent } from '../types.js';

/**
 * Cassette file format (JSONL):
 *   line 0  = meta header  { cassette:"traceplay", version:1, ...CassetteMeta }
 *   line 1+ = one TraceEvent per line
 *
 * JSONL lets the recorder append events without holding the whole trace in
 * memory, and a crashed run still leaves a readable prefix.
 */

const MARKER = 'traceplay';

export function serializeHeader(meta: CassetteMeta): string {
  return JSON.stringify({ cassette: MARKER, version: 1, ...meta });
}

export function serializeEvent(event: TraceEvent): string {
  return JSON.stringify(event);
}

export async function writeCassette(
  path: string,
  meta: CassetteMeta,
  events: TraceEvent[],
): Promise<void> {
  const lines = [serializeHeader(meta), ...events.map(serializeEvent)];
  await fs.writeFile(path, lines.join('\n') + '\n', 'utf8');
}

export async function writeHeader(path: string, meta: CassetteMeta): Promise<void> {
  await fs.writeFile(path, serializeHeader(meta) + '\n', 'utf8');
}

export async function appendEvent(path: string, event: TraceEvent): Promise<void> {
  await fs.appendFile(path, serializeEvent(event) + '\n', 'utf8');
}

export async function readCassette(path: string): Promise<Cassette> {
  const raw = await fs.readFile(path, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`Empty cassette: ${path}`);
  }
  const header = JSON.parse(lines[0]) as Record<string, unknown>;
  if (header.cassette !== MARKER) {
    throw new Error(`Not a traceplay cassette (missing marker): ${path}`);
  }
  const meta: CassetteMeta = {
    recordedAt: typeof header.recordedAt === 'string' ? header.recordedAt : new Date(0).toISOString(),
    redacted: header.redacted === true,
    providerBaseUrl: typeof header.providerBaseUrl === 'string' ? header.providerBaseUrl : undefined,
    project: typeof header.project === 'string' ? header.project : undefined,
  };
  const events = lines.slice(1).map((l) => JSON.parse(l) as TraceEvent);
  return { version: 1, meta, events };
}
