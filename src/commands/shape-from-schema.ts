import { promises as fs } from 'node:fs';
import { convertJsonSchema, renderShapeYaml } from '../assert/schema.js';

export interface ShapeFromSchemaArgs {
  schema: string;
  output?: string;
  step?: number;
  json?: boolean;
}

/**
 * `traceplay shape-from-schema <schema.json> [--output assertions.yaml]
 *  [--step N] [--json]`
 *
 * Convert a JSON Schema (or OpenAI function `parameters`) into an
 * `answer.shape` assertion snippet.
 */
export async function runShapeFromSchema(args: ShapeFromSchemaArgs): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(args.schema, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read schema "${args.schema}": ${(err as Error).message}`);
  }
  // Strip BOM
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  let schema: unknown;
  try {
    schema = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in schema "${args.schema}": ${(err as Error).message}`);
  }

  const conversion = convertJsonSchema(schema);

  if (args.json) {
    console.log(JSON.stringify(conversion, null, 2));
  } else {
    const yaml = renderShapeYaml(conversion, { step: args.step });
    if (args.output) {
      await fs.writeFile(args.output, yaml + '\n', 'utf8');
      console.log(`wrote answer.shape assertion → ${args.output}`);
      console.log(`  required: ${conversion.required.length}, fields: ${Object.keys(conversion.fields).length}`);
    } else {
      console.log(yaml);
    }
  }

  return 0;
}
