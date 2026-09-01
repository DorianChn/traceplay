import { describe, expect, it } from 'vitest';
import { normalizeRequest } from '../src/cassette/normalize.js';
import { matchRequest } from '../src/replayer/matcher.js';
import type { LLMResponseEvent } from '../src/types.js';

const AT = '2026-09-01T00:00:00.000Z';

function responseFor(requestId: string): LLMResponseEvent {
  return {
    id: 's1',
    seq: 1,
    at: AT,
    type: 'llm.response',
    requestId,
    status: 200,
    output: { choices: [{ message: { content: 'ok' } }] },
  };
}

describe('record-time redaction (cassettes never store raw secrets)', () => {
  const body = {
    model: 'gpt-x',
    api_key: 'sk-LIVE-SECRET-123',
    messages: [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hi', metadata: { token: 'tok-secret-value' } },
    ],
  };

  it('redacts secret fields from the persisted event but keeps rawBody for forwarding', () => {
    const normalized = normalizeRequest('/v1/chat/completions', JSON.stringify(body), 0);
    expect(normalized).not.toBeNull();
    const { event, rawBody } = normalized!;

    // The original bytes are still forwarded to the upstream provider untouched.
    expect(rawBody).toContain('sk-LIVE-SECRET-123');
    expect(rawBody).toContain('tok-secret-value');

    // But what gets appended to the cassette must contain no raw secret.
    const persisted = JSON.stringify(event);
    expect(persisted).not.toContain('sk-LIVE-SECRET-123');
    expect(persisted).not.toContain('tok-secret-value');
    expect(persisted).toContain('[REDACTED]');
  });

  it('still L0-matches a live incoming request that carries the same secret', () => {
    // Recorder stores a redacted event; the replayer redacts the live incoming
    // body the same way before hashing, so exact match still works end to end.
    const { event } = normalizeRequest('/v1/chat/completions', JSON.stringify(body), 0)!;
    const outcome = matchRequest(body, [event, responseFor(event.id)]);
    expect(outcome.found).toBe(true);
    expect(outcome.strategy).toBe('exact');
  });

  it('does not let a different secret value inflate or break matching', () => {
    const { event } = normalizeRequest('/v1/chat/completions', JSON.stringify(body), 0)!;
    const incoming = { ...body, api_key: 'sk-A-DIFFERENT-SECRET' };
    // Secrets are redacted on both sides, so differing credentials do NOT cause
    // a miss (they are not part of the semantic request).
    const outcome = matchRequest(incoming, [event, responseFor(event.id)]);
    expect(outcome.found).toBe(true);
    expect(outcome.strategy).toBe('exact');
  });
});
