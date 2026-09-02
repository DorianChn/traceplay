/**
 * Tiny `{{ key }}` templating for data-driven (parametrized) suites (v0.7).
 * Deliberately minimal: no expressions, no loops — only substitution of
 * primitive row values into strings. Unknown placeholders are left intact so
 * a typo stays visible instead of silently becoming an empty string.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;

export function renderString(template: string, row: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = row[key];
      if (value === null || value === undefined) return '';
      return String(value);
    }
    return match;
  });
}

/** Recursively render every string inside an assertion / plain object. */
export function renderValue<T>(value: T, row: Record<string, unknown>): T {
  if (typeof value === 'string') return renderString(value, row) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => renderValue(item, row)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderValue(item, row);
    }
    return out as unknown as T;
  }
  return value;
}

/** One-line preview of a parametrized row, e.g. [city=Paris, code=FR]. */
export function describeRow(row: Record<string, unknown>): string {
  const parts = Object.entries(row).map(([key, value]) => {
    const shown = typeof value === 'string' ? value : JSON.stringify(value);
    return `${key}=${shown}`;
  });
  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
}
