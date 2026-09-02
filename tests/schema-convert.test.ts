import { describe, expect, it } from 'vitest';
import { convertJsonSchema, renderShapeYaml } from '../src/assert/schema.js';

describe('convertJsonSchema — JSON Schema → answer.shape', () => {
  it('converts primitive types at top-level properties', () => {
    const r = convertJsonSchema({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' }, active: { type: 'boolean' } },
    });
    expect(r.fields['$.name']).toBe('string');
    expect(r.fields['$.age']).toBe('integer');
    expect(r.fields['$.active']).toBe('boolean');
    expect(r.required).toEqual([]);
  });

  it('marks required paths', () => {
    const r = convertJsonSchema({
      type: 'object',
      properties: { id: { type: 'string' }, opt: { type: 'string' } },
      required: ['id'],
    });
    expect(r.required).toEqual(['$.id']);
  });

  it('converts enum to enum expectation', () => {
    const r = convertJsonSchema({
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'closed'] } },
    });
    expect(r.fields['$.status']).toEqual({ type: 'string', enum: ['open', 'closed'] });
  });

  it('converts pattern to matches', () => {
    const r = convertJsonSchema({
      type: 'object',
      properties: { code: { type: 'string', pattern: '^[A-Z]{3}$' } },
    });
    expect(r.fields['$.code']).toEqual({ type: 'string', matches: '^[A-Z]{3}$' });
  });

  it('converts const to equals', () => {
    const r = convertJsonSchema({
      type: 'object',
      properties: { version: { const: 2 } },
    });
    expect(r.fields['$.version']).toEqual({ equals: 2 });
  });

  it('recurses into nested objects', () => {
    const r = convertJsonSchema({
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          properties: { zone: { type: 'string' }, count: { type: 'integer' } },
          required: ['zone'],
        },
      },
    });
    expect(r.fields['$.meta']).toBe('object');
    expect(r.fields['$.meta.zone']).toBe('string');
    expect(r.fields['$.meta.count']).toBe('integer');
    expect(r.required).toContain('$.meta.zone');
  });

  it('converts array items to wildcard path', () => {
    const r = convertJsonSchema({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    });
    expect(r.fields['$.tags']).toBe('array');
    expect(r.fields['$.tags[*]']).toBe('string');
  });

  it('accepts an OpenAI function schema and uses parameters', () => {
    const r = convertJsonSchema({
      name: 'get_weather',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    });
    expect(r.fields['$.city']).toBe('string');
    expect(r.required).toEqual(['$.city']);
  });

  it('handles a top-level primitive schema', () => {
    const r = convertJsonSchema({ type: 'string' });
    expect(r.fields['$']).toBe('string');
  });

  it('ignores unknown keywords without crashing', () => {
    const r = convertJsonSchema({
      type: 'object',
      properties: { x: { type: 'string', minLength: 1, maxLength: 10, description: 'ignored' } },
    });
    expect(r.fields['$.x']).toBe('string');
  });

  it('returns empty for a non-object input', () => {
    const r = convertJsonSchema('not a schema');
    expect(r.required).toEqual([]);
    expect(r.fields).toEqual({});
  });
});

describe('renderShapeYaml', () => {
  it('renders required and fields as YAML', () => {
    const yaml = renderShapeYaml(
      { required: ['$.id'], fields: { '$.id': 'string', '$.status': { type: 'string', enum: ['a', 'b'] } } },
      { step: 2 },
    );
    expect(yaml).toContain('kind: answer.shape');
    expect(yaml).toContain('step: 2');
    expect(yaml).toContain('"$.id"');
    expect(yaml).toContain('enum: ["a", "b"]');
  });

  it('omits step and json when not provided', () => {
    const yaml = renderShapeYaml({ required: [], fields: { '$.x': 'number' } });
    expect(yaml).not.toContain('step:');
    expect(yaml).not.toContain('json:');
  });
});
