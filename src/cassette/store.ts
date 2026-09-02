import { promises as fs } from 'node:fs';
import {
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  type Cassette,
  type CassetteMeta,
  type TraceEvent,
} from '../types.js';

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
  return JSON.stringify({ cassette: MARKER, version: CURRENT_SCHEMA_VERSION, ...meta });
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
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read cassette "${path}": ${(err as Error).message}`);
  }
  // Strip a UTF-8 BOM if present (common in files saved by Windows editors).
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`Empty cassette: ${path}`);
  }
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(lines[0]) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Invalid cassette header on line 1 of ${path}: ${(err as Error).message}`);
  }
  if (header.cassette !== MARKER) {
    throw new Error(`Not a traceplay cassette (missing marker): ${path}`);
  }
  if (typeof header.version !== 'number') {
    throw new Error(
      `Cassette is missing a numeric "version" on line 1 of ${path} (corrupt or pre-v0.1 file?)`,
    );
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(header.version)) {
    throw new Error(
      `Unsupported cassette schema v${header.version} in ${path}: this traceplay supports v${SUPPORTED_SCHEMA_VERSIONS.join(
        '/v',
      )}. Re-record the cassette or run a migration.`,
    );
  }
  const schemaVersion = header.version as 1;
  const meta: CassetteMeta = {
    recordedAt: typeof header.recordedAt === 'string' ? header.recordedAt : new Date(0).toISOString(),
    redacted: header.redacted === true,
    providerBaseUrl: typeof header.providerBaseUrl === 'string' ? header.providerBaseUrl : undefined,
    project: typeof header.project === 'string' ? header.project : undefined,
  };
  const events: TraceEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]) as TraceEvent);
    } catch (err) {
      throw new Error(`Invalid JSON on cassette line ${i + 1} of ${path}: ${(err as Error).message}`);
    }
  }
  return { version: schemaVersion, meta, events };
}
