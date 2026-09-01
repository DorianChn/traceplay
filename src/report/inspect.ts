import type { Cassette, LLMRequestEvent, LLMResponseEvent, TraceEvent } from '../types.js';

function shortContent(e: TraceEvent): string {
  switch (e.type) {
    case 'user.message':
      return JSON.stringify(e.content.length > 60 ? `${e.content.slice(0, 60)}…` : e.content);
    case 'llm.request': {
      const model = (e as LLMRequestEvent).model;
      const stream = (e as LLMRequestEvent).stream ? ' · stream' : '';
      return `${(e as LLMRequestEvent).provider} · ${model}${stream}`;
    }
    case 'llm.response': {
      const r = e as LLMResponseEvent;
      const usage = r.usage
        ? ` · ${r.usage.promptTokens + r.usage.completionTokens} tok (${r.usage.promptTokens} in / ${r.usage.completionTokens} out)`
        : '';
      const latency = r.latencyMs !== undefined ? ` · ${r.latencyMs}ms` : '';
      const stream = r.stream ? ' · stream' : '';
      return `${r.status}${usage}${latency}${stream}`;
    }
    case 'tool.call':
      return `${(e as Extract<TraceEvent, { type: 'tool.call' }>).name}(${JSON.stringify((e as Extract<TraceEvent, { type: 'tool.call' }>).arguments ?? '')})`;
    case 'tool.result': {
      const out = (e as Extract<TraceEvent, { type: 'tool.result' }>).output;
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      return text.length > 60 ? `${text.slice(0, 60)}…` : text;
    }
    case 'agent.error':
      return (e as Extract<TraceEvent, { type: 'agent.error' }>).message;
    default:
      return '';
  }
}

/**
 * Human-readable cassette inspection report: event timeline + token stats.
 */
export function formatInspect(cassette: Cassette, source?: string): string {
  const lines: string[] = [];
  lines.push(`cassette:  ${source ?? '<in-memory>'}`);
  lines.push(`recorded:  ${cassette.meta.recordedAt}`);
  lines.push(
    `metadata:  redacted=${cassette.meta.redacted}${cassette.meta.project ? `, project=${cassette.meta.project}` : ''}${cassette.meta.providerBaseUrl ? `, upstream=${cassette.meta.providerBaseUrl}` : ''}`,
  );
  lines.push('');

  const toolCalls = cassette.events.filter((e) => e.type === 'tool.call').length;
  const errors = cassette.events.filter((e) => e.type === 'agent.error').length;
  const requests = cassette.events.filter((e) => e.type === 'llm.request');
  const responses = cassette.events.filter((e) => e.type === 'llm.response');
  const totalTokens = responses.reduce(
    (sum, e) => sum + ((e as LLMResponseEvent).usage ? ((e as LLMResponseEvent).usage!.promptTokens + (e as LLMResponseEvent).usage!.completionTokens) : 0),
    0,
  );
  const promptTokens = responses.reduce(
    (sum, e) => sum + ((e as LLMResponseEvent).usage?.promptTokens ?? 0),
    0,
  );
  const completionTokens = responses.reduce(
    (sum, e) => sum + ((e as LLMResponseEvent).usage?.completionTokens ?? 0),
    0,
  );

  lines.push(`Timeline (${cassette.events.length} events):`);
  for (const e of cassette.events) {
    lines.push(`  [${String(e.seq).padStart(2, ' ')}] ${e.type.padEnd(14)} ${shortContent(e)}`);
  }
  lines.push('');
  lines.push('Summary:');
  lines.push(`  LLM calls:  ${requests.length}`);
  lines.push(`  Tools:      ${toolCalls} called · ${errors} errors`);
  lines.push(`  Tokens:     ${totalTokens} total (${promptTokens} prompt + ${completionTokens} completion)`);

  return lines.join('\n');
}
