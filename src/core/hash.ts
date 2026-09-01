import { createHash } from 'node:crypto';

/**
 * Request canonicalization + hashing.
 *
 * The replayer matches incoming requests against recorded ones by hash.
 * We strip volatile fields (ids, timestamps, stream flag) and sort keys
 * so that semantically identical requests produce the same hash regardless
 * of key order or incidental metadata.
 *
 * v0.5 introduces a second, looser "semantic" layer (L1): it additionally
 * folds incidental whitespace and drops sampling-noise fields such as
 * `seed`, so a request that only differs in formatting still matches
 * deterministically — without ever resorting to probabilistic similarity.
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

/**
 * Fields additionally ignored by the L1 semantic hash. They carry sampling
 * noise / per-call metadata that does not change *which recorded answer* a
 * request is asking for. Fields that affect the answer (model, temperature,
 * top_p, messages, tools, …) are deliberately NOT stripped.
 */
const SEMANTIC_VOLATILE_KEYS = new Set<string>([
  ...VOLATILE_KEYS,
  'seed',
]);

interface CanonicalOptions {
  strip: Set<string>;
  normalizeText: boolean;
}

function canonicalizeValue(value: unknown, opts: CanonicalOptions): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => canonicalizeValue(v, opts));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (opts.strip.has(key)) continue;
      sorted[key] = canonicalizeValue(obj[key], opts);
    }
    return sorted;
  }
  if (opts.normalizeText && typeof value === 'string') {
    // Trim edges and collapse runs of whitespace (incl. newlines/tabs) so
    // that cosmetic formatting differences do not break a deterministic hit.
    return value.trim().replace(/\s+/g, ' ');
  }
  return value;
}

/** L0: strict canonical form — key-sorted, volatile metadata removed. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value, { strip: VOLATILE_KEYS, normalizeText: false }));
}

/** L1: semantic canonical form — L0 plus whitespace folding + sampling-noise removal. */
export function semanticCanonicalize(value: unknown): string {
  return JSON.stringify(
    canonicalizeValue(value, { strip: SEMANTIC_VOLATILE_KEYS, normalizeText: true }),
  );
}

export function requestHash(request: unknown): string {
  return createHash('sha256').update(canonicalize(request)).digest('hex');
}

/** L1 hash: deterministic, but tolerant of cosmetic drift. */
export function semanticRequestHash(request: unknown): string {
  return createHash('sha256').update(semanticCanonicalize(request)).digest('hex');
}
