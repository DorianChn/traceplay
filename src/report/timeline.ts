import type {
  LLMRequestEvent,
  LLMResponseEvent,
  TimelineItem,
  ToolCallEvent,
  ToolResultEvent,
  TraceEvent,
  UserMessageEvent,
  AgentErrorEvent,
} from '../types.js';

const PREVIEW = 96;

function clip(text: string, max = PREVIEW): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}

function asText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(asText).join(' ');
  const obj = value as Record<string, unknown>;
  if (typeof obj.text === 'string') return obj.text;
  return JSON.stringify(value);
}

/** Last user-role message carried by a chat-completions request. */
function requestIntent(event: LLMRequestEvent): string {
  for (let i = event.messages.length - 1; i >= 0; i--) {
    const msg = event.messages[i] as Record<string, unknown> | undefined;
    if (msg && msg.role === 'user') return clip(asText(msg.content));
  }
  return `${event.model} request`;
}

function responsePreview(event: LLMResponseEvent): string {
  return clip(asText(event.output));
}

/** Compress a full trace into the compact items rendered by the HTML report. */
export function buildTimeline(events: TraceEvent[]): TimelineItem[] {
  const requestTurnById = new Map<string, number>();
  return events.map((event): TimelineItem => {
    switch (event.type) {
      case 'user.message':
        return { seq: event.seq, type: event.type, label: clip((event as UserMessageEvent).content) };
      case 'llm.request': {
        const req = event as LLMRequestEvent;
        if (req.id) requestTurnById.set(req.id, req.turn ?? requestTurnById.size);
        return { seq: event.seq, type: event.type, label: requestIntent(req), turn: req.turn };
      }
      case 'llm.response': {
        const res = event as LLMResponseEvent;
        const tokens = res.usage ? res.usage.promptTokens + res.usage.completionTokens : undefined;
        return {
          seq: event.seq,
          type: event.type,
          label: responsePreview(res),
          status: res.status,
          tokens,
          turn: requestTurnById.get(res.requestId),
        };
      }
      case 'tool.call': {
        const call = event as ToolCallEvent;
        return { seq: event.seq, type: event.type, label: `${call.name}(${clip(JSON.stringify(call.arguments), 48)})` };
      }
      case 'tool.result': {
        const result = event as ToolResultEvent;
        return {
          seq: event.seq,
          type: event.type,
          label: clip(asText(result.output)),
          isError: result.isError === true,
        };
      }
      case 'agent.error':
        return { seq: event.seq, type: event.type, label: clip((event as AgentErrorEvent).message), isError: true };
      default: {
        const fallback = event as unknown as { seq: number; type: TimelineItem['type'] };
        return { seq: fallback.seq, type: fallback.type, label: fallback.type };
      }
    }
  });
}
