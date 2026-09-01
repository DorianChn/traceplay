/**
 * Minimal JSONPath evaluator for `tool.args` assertions.
 *
 * Supports: `$.a.b`, `$.a[0]`, `$.a[*].b`, `$..` is NOT supported.
 * Returns an array of all matches (empty when nothing matches).
 */

export function jsonPath(root: unknown, path: string): unknown[] {
  if (typeof path !== 'string') return [];
  let p = path.trim();
  if (p.startsWith('$')) p = p.slice(1);
  if (p.length === 0) return [root];

  const tokens = p.match(/\.[^.[\]]+|\[\d+\]|\[\*\]/g) || [];
  let results: unknown[] = [root];

  for (const token of tokens) {
    if (token.startsWith('.')) {
      const key = token.slice(1);
      results = results.flatMap((item) =>
        item !== null && typeof item === 'object' && key in (item as object)
          ? [(item as Record<string, unknown>)[key]]
          : [],
      );
    } else if (token === '[*]') {
      results = results.flatMap((item) => (Array.isArray(item) ? item : []));
    } else if (/^\[\d+\]$/.test(token)) {
      const index = parseInt(token.slice(1, -1), 10);
      results = results.flatMap((item) =>
        Array.isArray(item) && index >= 0 && index < item.length ? [item[index]] : [],
      );
    }
  }

  return results;
}
