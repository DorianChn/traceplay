import { describe, expect, it } from 'vitest';
import * as traceplay from '../src/index.js';

describe('sdk (src/index.ts)', () => {
  it('exposes core helpers', () => {
    expect(typeof traceplay.requestHash).toBe('function');
    expect(typeof traceplay.canonicalize).toBe('function');
    expect(typeof traceplay.redactHeaders).toBe('function');
    expect(typeof traceplay.jsonPath).toBe('function');
  });

  it('exposes cassette / recorder / replayer / assert APIs', () => {
    expect(typeof traceplay.readCassette).toBe('function');
    expect(typeof traceplay.normalizeRequest).toBe('function');
    expect(typeof traceplay.matchRequest).toBe('function');
    expect(typeof traceplay.startRecorder).toBe('function');
    expect(typeof traceplay.startReplayer).toBe('function');
    expect(typeof traceplay.runAssertions).toBe('function');
    expect(typeof traceplay.runTest).toBe('function');
    expect(typeof traceplay.serializeSSE).toBe('function');
  });

  it('exposes v0.3 additions', () => {
    expect(typeof traceplay.startUI).toBe('function');
    expect(typeof traceplay.compareCassettes).toBe('function');
    expect(typeof traceplay.formatDiff).toBe('function');
  });

  it('exposes skills adapter', () => {
    expect(typeof traceplay.readSkill).toBe('function');
    expect(typeof traceplay.runSkill).toBe('function');
    expect(typeof traceplay.generateSkillSuite).toBe('function');
  });

  it('exposes version', () => {
    expect(traceplay.VERSION).toBe('0.3.0');
  });

  it('works end-to-end in-memory', () => {
    const hash = traceplay.requestHash({ messages: [{ role: 'user', content: 'hi' }] });
    expect(hash).toHaveLength(64);
    const redacted = traceplay.redactHeaders({ authorization: 'Bearer x' });
    expect(redacted.authorization).toBe('[REDACTED]');
  });
});
