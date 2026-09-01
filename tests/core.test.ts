import { describe, expect, it } from 'vitest';
import { canonicalize, requestHash } from '../src/core/hash.js';
import { redactHeaders, redactBody } from '../src/core/redact.js';
import { jsonPath } from '../src/core/jsonpath.js';

describe('core/hash', () => {
  it('hashes identical canonical requests the same despite key order', () => {
    const a = { model: 'x', messages: [{ role: 'user', content: 'hi' }], stream: false };
    const b = { stream: true, messages: [{ content: 'hi', role: 'user' }], model: 'x' };
    expect(requestHash(a)).toBe(requestHash(b));
  });

  it('produces different hashes for different messages', () => {
    const a = { model: 'x', messages: [{ role: 'user', content: 'hi' }] };
    const b = { model: 'x', messages: [{ role: 'user', content: 'bye' }] };
    expect(requestHash(a)).not.toBe(requestHash(b));
  });

  it('canonicalize strips volatile fields', () => {
    const canon = canonicalize({ id: 'x', timestamp: 123, model: 'y' });
    expect(canon).not.toContain('"id"');
    expect(canon).toContain('"model"');
  });
});

describe('core/redact', () => {
  it('redacts authorization and api-key headers', () => {
    const out = redactHeaders({ authorization: 'Bearer secret', 'content-type': 'application/json', 'x-api-key': 'abc' });
    expect(out.authorization).toBe('[REDACTED]');
    expect(out['x-api-key']).toBe('[REDACTED]');
    expect(out['content-type']).toBe('application/json');
  });

  it('redacts nested secret fields in body', () => {
    const out = redactBody({ api_key: 'secret', nested: { password: 'pw', keep: 'yes' } });
    expect((out as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect(((out as Record<string, unknown>).nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect(((out as Record<string, unknown>).nested as Record<string, unknown>).keep).toBe('yes');
  });
});

describe('core/jsonpath', () => {
  const obj = { a: { b: [{ c: 1 }, { c: 2 }] }, d: 'x' };

  it('resolves simple property paths', () => {
    expect(jsonPath(obj, '$.d')).toEqual(['x']);
    expect(jsonPath(obj, '$.a.b')).toEqual([[{ c: 1 }, { c: 2 }]]);
  });

  it('resolves array index', () => {
    expect(jsonPath(obj, '$.a.b[0].c')).toEqual([1]);
    expect(jsonPath(obj, '$.a.b[1].c')).toEqual([2]);
  });

  it('resolves wildcard', () => {
    expect(jsonPath(obj, '$.a.b[*].c')).toEqual([1, 2]);
  });

  it('returns empty for missing paths', () => {
    expect(jsonPath(obj, '$.a.x.y')).toEqual([]);
    expect(jsonPath(obj, '$.a.b[5]')).toEqual([]);
  });
});
