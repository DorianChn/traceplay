import type { ShapeFieldSpec, ShapeType } from '../types.js';

/**
 * Convert a JSON Schema (draft-04..-07 subset) or an OpenAI function/tool
 * `parameters` schema into an `answer.shape` assertion's `required` + `fields`.
 *
 * Supported keywords: `type`, `properties`, `required`, `items`, `enum`,
 * `pattern`, `const`, `minimum`/`maximum` (ignored — no numeric-range field in
 * answer.shape), `minLength`/`maxLength` (ignored). Nested objects recurse with
 * `$.a.b.c` paths; array item types become `$.path[*]`.
 *
 * Unknown keywords are silently skipped — the converter is best-effort and the
 * generated assertion is a starting point, not a lossless translation.
 */

export interface ShapeConversion {
  required: string[];
  fields: Record<string, ShapeFieldSpec>;
}

const TYPE_MAP: Record<string, ShapeType> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  array: 'array',
  object: 'object',
  null: 'null',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function convertProperty(
  path: string,
  schema: Record<string, unknown>,
  out: ShapeConversion,
): void {
  // const → equals
  if ('const' in schema) {
    out.fields[path] = { equals: schema.const };
    return;
  }

  // enum → enum expectation
  if (Array.isArray(schema.enum)) {
    out.fields[path] = { enum: schema.enum };
    // still apply type if present
    if (typeof schema.type === 'string' && TYPE_MAP[schema.type]) {
      (out.fields[path] as { type?: ShapeType }).type = TYPE_MAP[schema.type];
    }
    return;
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined;

  // pattern → matches (only meaningful for strings)
  if (typeof schema.pattern === 'string') {
    out.fields[path] = { matches: schema.pattern };
    if (type && TYPE_MAP[type]) {
      (out.fields[path] as { type?: ShapeType }).type = TYPE_MAP[type];
    }
    return;
  }

  // Nested object → recurse properties
  if (type === 'object' || isPlainObject(schema.properties)) {
    if (type && TYPE_MAP[type]) {
      out.fields[path] = TYPE_MAP[type];
    }
    if (isPlainObject(schema.properties)) {
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (isPlainObject(subSchema)) {
          const subPath = `${path}.${key}`;
          if (required.includes(key)) out.required.push(subPath);
          convertProperty(subPath, subSchema, out);
        }
      }
    }
    return;
  }

  // Array with item schema → $.path[*]
  if (type === 'array' && isPlainObject(schema.items)) {
    out.fields[path] = 'array';
    const itemPath = `${path}[*]`;
    convertProperty(itemPath, schema.items, out);
    return;
  }

  // Primitive type
  if (type && TYPE_MAP[type]) {
    out.fields[path] = TYPE_MAP[type];
    return;
  }

  // No recognizable constraint — skip (don't emit an empty field).
}

/**
 * Convert a schema object. Accepts either a raw JSON Schema or an OpenAI
 * function definition `{ name, parameters: {...} }` (the `parameters` subtree
 * is used).
 */
export function convertJsonSchema(input: unknown): ShapeConversion {
  const schema = isPlainObject(input) && isPlainObject(input.parameters)
    ? (input.parameters as Record<string, unknown>)
    : isPlainObject(input)
      ? input
      : {};

  const out: ShapeConversion = { required: [], fields: {} };
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

  if (isPlainObject(schema.properties)) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (!isPlainObject(subSchema)) continue;
      const path = `$.${key}`;
      if (required.includes(key)) out.required.push(path);
      convertProperty(path, subSchema, out);
    }
  } else if (typeof schema.type === 'string' && TYPE_MAP[schema.type]) {
    // Top-level primitive schema (e.g. {"type":"string"})
    out.fields['$'] = TYPE_MAP[schema.type];
  }

  return out;
}

/**
 * Render a conversion as a YAML snippet for an `answer.shape` assertion.
 * `step` and `json` are emitted when provided.
 */
export function renderShapeYaml(conversion: ShapeConversion, opts?: { step?: number; json?: boolean }): string {
  const lines: string[] = ['- kind: answer.shape'];
  if (typeof opts?.step === 'number') lines.push(`  step: ${opts.step}`);
  if (opts?.json === false) lines.push('  json: false');
  if (conversion.required.length > 0) {
    lines.push('  required:');
    for (const r of conversion.required) lines.push(`    - "${r}"`);
  }
  const fieldEntries = Object.entries(conversion.fields);
  if (fieldEntries.length > 0) {
    lines.push('  fields:');
    for (const [path, spec] of fieldEntries) {
      if (typeof spec === 'string') {
        lines.push(`    "${path}": ${spec}`);
      } else {
        lines.push(`    "${path}":`);
        for (const [k, v] of Object.entries(spec)) {
          if (Array.isArray(v)) {
            lines.push(`      ${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
          } else {
            lines.push(`      ${k}: ${JSON.stringify(v)}`);
          }
        }
      }
    }
  }
  return lines.join('\n');
}
