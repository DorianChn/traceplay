import { createHash } from 'node:crypto';

/**
 * Request canonicalization + hashing.
 *
 * The replayer matches incoming requests against recorded ones by hash.
 * We strip volatile fields (ids, timestamps, stream flag) and sort keys
 * so that semantically identical requests produce the same hash regardless
 * of key order or incidental metadata.
 */

const VOLATILE_KEYS = new Set([
  'id',
  'request_id',
  'requestId',
  'trace_id',
  'traceId',
  'timestamp',
  'created_at',
  'createdAt',
  'user',
  'stream',
  'stream_options',
]);

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      sorted[key] = sortValue(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function requestHash(request: unknown): string {
  return createHash('sha256').update(canonicalize(request)).digest('hex');
}
