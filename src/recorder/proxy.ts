import http from 'node:http';
import { gunzipSync, inflateSync } from 'node:zlib';
import { writeHeader, appendEvent } from '../cassette/store.js';
import {
  normalizeRequest,
  normalizeResponse,
  normalizeStreamResponse,
  resetCounter,
  nextId,
} from '../cassette/normalize.js';
import { isStreamingContentType } from '../cassette/stream.js';
import { redactHeaders, redactBody } from '../core/redact.js';
import { forwardRaw } from './forward.js';
import type { CassetteMeta } from '../types.js';

export interface RecorderOptions {
  port: number;
  upstream: string;
  cassettePath: string;
  redact: boolean;
  project?: string;
  /** When true (default), expose /__traceplay/tool.call|result reporting endpoints. */
  recordTools?: boolean;
  /**
   * Bind address. Defaults to loopback 127.0.0.1 so other machines (and DNS-
   * rebinding pages) cannot reach the recorder; pass 0.0.0.0 deliberately to
   * expose it (R12).
   */
  host?: string;
  /**
   * Shared secret for the /__traceplay/* management endpoints. When set, tool
   * reporting requires `Authorization: Bearer <token>` (R12). LLM proxy traffic
   * is not gated so agents keep working without extra configuration.
   */
  token?: string;
}

export interface RecorderHandle {
  port: number;
  /** Host/interface the recorder is bound to (127.0.0.1 by default, R12). */
  host: string;
  close(): Promise<void>;
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
}

/** Constant-time-ish check of the management token (R12), via Bearer or header. */
function managementRequestAuthorized(req: http.IncomingMessage, expected: string): boolean {
  const auth = req.headers['authorization'];
  const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const custom = req.headers['x-traceplay-token'];
  const provided = (bearer || (typeof custom === 'string' ? custom : '')).trim();
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch += provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function setResponseHeaders(
  res: http.ServerResponse,
  headers: Record<string, string>,
  streaming: boolean,
): void {
  // NOTE: statusCode must be set by the caller before this runs; it is never
  // overridden here so non-200 upstream responses are recorded faithfully.
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'content-length' || lower === 'transfer-encoding' || lower === 'connection') continue;
    res.setHeader(key, value);
  }
  if (streaming) {
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
  }
}

/**
 * Recording proxy.
 *
 * Sits between an agent and its LLM provider. Every request is normalized
 * into a TraceEvent, appended to the cassette, then forwarded upstream.
 *
 * Non-streaming responses are buffered and persisted as an llm.response
 * event. Streaming (SSE) responses are piped through to the client in real
 * time while their content is captured and normalized for the cassette.
 */
export async function startRecorder(options: RecorderOptions): Promise<RecorderHandle> {
  resetCounter();
  let seq = 0;
  let headerWritten = false;
  // Multi-step trajectory state (R4): request turn number + causal parent edge.
  let requestTurn = 0;
  let lastRequestId: string | undefined;
  // R12: track reported tool.call ids so an orphan tool.result can be rejected.
  const seenToolCallIds = new Set<string>();
  const managementToken = options.token ?? process.env.TRACEPLAY_TOKEN;
  const bindHost = options.host ?? process.env.TRACEPLAY_HOST ?? '127.0.0.1';

  const meta: CassetteMeta = {
    recordedAt: new Date().toISOString(),
    redacted: options.redact,
    providerBaseUrl: options.upstream,
    project: options.project,
  };

  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      await new Promise<void>((resolve) => req.on('end', resolve));
      const rawBody = Buffer.concat(chunks).toString('utf8');

      // Tool reporting endpoints: agents post tool activity here so tool calls
      // and results live in the same cassette as the LLM calls.
      if (options.recordTools !== false && req.url && req.url.startsWith('/__traceplay/tool.')) {
        // R12: optional shared-secret gate on management endpoints.
        if (managementToken && !managementRequestAuthorized(req, managementToken)) {
          sendJson(res, 401, { error: 'invalid or missing traceplay management token' });
          return;
        }
        let payload: Record<string, unknown> = {};
        try {
          payload = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
        } catch {
          payload = {};
        }
        if (!headerWritten) {
          await writeHeader(options.cassettePath, meta);
          headerWritten = true;
        }
        if (req.url === '/__traceplay/tool.call') {
          // Register the call id (generate one if the agent did not supply it)
          // so a later tool.result can be linked back (R12).
          const callId =
            typeof payload.callId === 'string' && payload.callId.length > 0
              ? payload.callId
              : nextId('call');
          seenToolCallIds.add(callId);
          await appendEvent(options.cassettePath, {
            id: nextId('tool'),
            seq: seq++,
            at: new Date().toISOString(),
            type: 'tool.call',
            name: typeof payload.name === 'string' ? payload.name : 'unknown',
            callId,
            arguments: redactBody(payload.arguments ?? {}),
          });
          sendJson(res, 200, { ok: true, callId });
        } else if (req.url === '/__traceplay/tool.result') {
          const callId = typeof payload.callId === 'string' ? payload.callId : '';
          if (!callId || !seenToolCallIds.has(callId)) {
            // An orphan result (no matching tool.call) would corrupt the trace.
            sendJson(res, 400, {
              error: 'tool.result has no matching tool.call for callId',
              callId: callId || null,
            });
            return;
          }
          await appendEvent(options.cassettePath, {
            id: nextId('toolres'),
            seq: seq++,
            at: new Date().toISOString(),
            type: 'tool.result',
            callId,
            output: redactBody(payload.output ?? ''),
            isError: payload.isError === true,
          });
          sendJson(res, 200, { ok: true });
        } else {
          sendJson(res, 404, { error: 'unknown tool endpoint' });
        }
        return;
      }

      const reqHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') reqHeaders[key] = value;
        else if (Array.isArray(value)) reqHeaders[key] = value.join(', ');
      }

      const turn = requestTurn;
      const normalized = normalizeRequest(req.url || '/', rawBody, seq++, {
        turn,
        parentId: lastRequestId,
      });

      if (normalized) {
        // Advance the multi-step trajectory: chain this request to the next one.
        requestTurn += 1;
        lastRequestId = normalized.event.id;
        if (!headerWritten) {
          await writeHeader(options.cassettePath, meta);
          headerWritten = true;
        }
        await appendEvent(options.cassettePath, normalized.event);
      }

      const startedAt = Date.now();
      const upstream = await forwardRaw(
        options.upstream,
        req.method || 'GET',
        req.url || '/',
        reqHeaders,
        rawBody,
      );
      const latencyMs = Date.now() - startedAt;
      const streaming = isStreamingContentType(upstream.headers['content-type']);

      res.statusCode = upstream.status;
      setResponseHeaders(res, upstream.headers, streaming);

      if (streaming) {
        // Pipe SSE to the client while capturing content for the cassette.
        if (!normalized) {
          upstream.res.pipe(res);
          return;
        }
        let sseText = '';
        upstream.res.on('data', (chunk: Buffer) => {
          res.write(chunk);
          sseText += chunk.toString('utf8');
        });
        upstream.res.on('end', async () => {
          res.end();
          const responseNorm = normalizeStreamResponse(
            normalized.event.id,
            upstream.status,
            sseText,
            normalized.event.provider,
            seq++,
            latencyMs,
          );
          responseNorm.event.headers = options.redact
            ? redactHeaders(upstream.headers)
            : upstream.headers;
          await appendEvent(options.cassettePath, responseNorm.event).catch(() => undefined);
        });
        upstream.res.on('error', (err: Error) => res.destroy(err));
        return;
      }

      // Non-streaming: buffer (decompress if needed), persist, then reply.
      const bodyChunks: Buffer[] = [];
      upstream.res.on('data', (c: Buffer) => bodyChunks.push(c));
      await new Promise<void>((resolve) => upstream.res.on('end', resolve));
      const enc = (upstream.headers['content-encoding'] || '').toLowerCase();
      let upstreamBuffer = Buffer.concat(bodyChunks);
      if (enc === 'gzip') {
        try {
          upstreamBuffer = gunzipSync(upstreamBuffer);
        } catch {
          // keep raw bytes if decompression fails
        }
      } else if (enc === 'deflate') {
        try {
          upstreamBuffer = inflateSync(upstreamBuffer);
        } catch {
          // keep raw bytes if decompression fails
        }
      }
      const upstreamBody = upstreamBuffer.toString('utf8');

      if (normalized) {
        // The stored body is decompressed plain text; drop encoding headers
        // so replay does not tell clients to decompress already-plain data.
        const storedHeaders = { ...upstream.headers };
        delete storedHeaders['content-encoding'];
        delete storedHeaders['content-length'];
        const responseNorm = normalizeResponse(
          normalized.event.id,
          upstream.status,
          upstreamBody,
          normalized.event.provider,
          seq++,
          latencyMs,
        );
        responseNorm.event.headers = options.redact
          ? redactHeaders(storedHeaders)
          : storedHeaders;
        await appendEvent(options.cassettePath, responseNorm.event);
      }

      res.end(upstreamBody);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(`traceplay recorder error: ${(err as Error).message}\n`);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, bindHost, () => {
      resolve({
        port: options.port,
        host: bindHost,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
