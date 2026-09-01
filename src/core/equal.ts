/**
 * Order-insensitive deep equality for assertions.
 *
 * `JSON.stringify({a:1,b:2}) !== JSON.stringify({b:2,a:1})`, so a naive string
 * comparison makes `tool.args equals` fail on semantically identical objects
 * whose keys were serialized in a different order. These helpers sort object
 * keys recursively before comparing.
 */

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** Deep equality that ignores object-key insertion order. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  return stableStringify(a) === stableStringify(b);
}
