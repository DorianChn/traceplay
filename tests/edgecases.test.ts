import { describe, expect, it } from 'vitest';
import { generateEdgeCases, defaultBaseFromSkill, SPECIAL_CHARS } from '../src/generate/edgecases.js';

describe('generate/edgecases', () => {
  it('produces a named set of boundary inputs', () => {
    const cases = generateEdgeCases('What is the weather in Xiamen?', 'returns weather info');
    const names = cases.map((c) => c.name);
    expect(names).toContain('base');
    expect(names).toContain('empty');
    expect(names).toContain('whitespace');
    expect(names).toContain('special-chars');
    expect(names).toContain('numeric-zero');
    expect(names).toContain('numeric-huge');
    expect(names).toContain('long-input');
    expect(names).toContain('unrelated');
    expect(names).toContain('domain-question');
  });

  it('base is first when non-empty', () => {
    const cases = generateEdgeCases('hello', '');
    expect(cases[0].name).toBe('base');
    expect(cases[0].message).toBe('hello');
  });

  it('long-input repeats the base', () => {
    const cases = generateEdgeCases('ab', '');
    const longCase = cases.find((c) => c.name === 'long-input')!;
    expect(longCase.message.length).toBeGreaterThan(60);
  });

  it('special chars include non-alphanumeric symbols', () => {
    expect(SPECIAL_CHARS).toContain('!');
    expect(SPECIAL_CHARS).toContain('@');
    expect(SPECIAL_CHARS).toContain('#');
  });

  it('default base derives from skill name', () => {
    expect(defaultBaseFromSkill('code-review')).toContain('code-review');
  });
});
