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

  it('exposes v0.4 additions', () => {
    expect(typeof traceplay.registerAssertion).toBe('function');
    expect(typeof traceplay.generateEdgeCases).toBe('function');
    expect(typeof traceplay.runMatrix).toBe('function');
    expect(typeof traceplay.computeCoverage).toBe('function');
    expect(typeof traceplay.evaluateSuite).toBe('function');
  });

  it('exposes skills adapter', () => {
    expect(typeof traceplay.readSkill).toBe('function');
    expect(typeof traceplay.runSkill).toBe('function');
    expect(typeof traceplay.generateSkillSuite).toBe('function');
  });

  it('exposes v0.5 additions', () => {
    expect(typeof traceplay.semanticRequestHash).toBe('function');
    expect(typeof traceplay.semanticCanonicalize).toBe('function');
    expect(typeof traceplay.structuredSimilarity).toBe('function');
    expect(typeof traceplay.bigramDice).toBe('function');
    expect(traceplay.DEFAULT_STRUCTURED_THRESHOLD).toBeGreaterThan(0);
    expect(traceplay.DEFAULT_AMBIGUITY_GAP).toBeGreaterThan(0);
  });

  it('exposes v0.6 additions', () => {
    expect(typeof traceplay.createReplaySession).toBe('function');
    expect(typeof traceplay.linkResponse).toBe('function');
    expect(typeof traceplay.runMutationTesting).toBe('function');
    expect(typeof traceplay.listMutators).toBe('function');
  });

  it('exposes v0.7 additions', () => {
    expect(typeof traceplay.checkAnswerShape).toBe('function');
    expect(typeof traceplay.checkFlowUsesResult).toBe('function');
    expect(typeof traceplay.formatHtml).toBe('function');
    expect(typeof traceplay.buildTimeline).toBe('function');
    expect(typeof traceplay.renderString).toBe('function');
    expect(typeof traceplay.renderValue).toBe('function');
    expect(typeof traceplay.compileUserRegex).toBe('function');
  });

  it('exposes v0.8 additions', () => {
    expect(typeof traceplay.rebaseCassettes).toBe('function');
    expect(typeof traceplay.convertJsonSchema).toBe('function');
    expect(typeof traceplay.renderShapeYaml).toBe('function');
    expect(typeof traceplay.diagnoseCassette).toBe('function');
    expect(typeof traceplay.doctorExitCode).toBe('function');
  });

  it('exposes version', () => {
    expect(traceplay.VERSION).toBe('0.8.0');
  });

  it('works end-to-end in-memory', () => {
    const hash = traceplay.requestHash({ messages: [{ role: 'user', content: 'hi' }] });
    expect(hash).toHaveLength(64);
    const redacted = traceplay.redactHeaders({ authorization: 'Bearer x' });
    expect(redacted.authorization).toBe('[REDACTED]');
  });
});
