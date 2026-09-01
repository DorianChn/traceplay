import http from 'node:http';
import { writeHeader, appendEvent } from '../cassette/store.js';
import { normalizeRequest, normalizeResponse, resetCounter } from '../cassette/normalize.js';
import { redactHeaders } from '../core/redact.js';
import { forwardRequest } from './forward.js';
import type { CassetteMeta } from '../types.js';

export interface RecorderOptions {
  port: number;
  upstream: string;
  cassettePath: string;
  redact: boolean;
  project?: string;
}

export interface RecorderHandle {
  port: number;
  close(): Promise<void>;
}

/**
 * Recording proxy.
 *
 * Sits between an agent and its LLM provider. Every request is normalized
 * into a TraceEvent, appended to the cassette, then forwarded upstream.
 * The response is buffered (while being piped back to the client) and
 * persisted as an llm.response event with raw body + redacted headers.
 */
export async function startRecorder(options: RecorderOptions): Promise<RecorderHandle> {
  resetCounter();
  let seq = 0;
  let headerWritten = false;

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

      const reqHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') reqHeaders[key] = value;
        else if (Array.isArray(value)) reqHeaders[key] = value.join(', ');
      }

      const normalized = normalizeRequest(req.url || '/', rawBody, seq++);

      if (normalized) {
        if (!headerWritten) {
          await writeHeader(options.cassettePath, meta);
          headerWritten = true;
        }
        await appendEvent(options.cassettePath, normalized.event);
      }

      const startedAt = Date.now();
      const upstream = await forwardRequest(
        options.upstream,
        req.method || 'GET',
        req.url || '/',
        reqHeaders,
        rawBody,
      );
      const latencyMs = Date.now() - startedAt;

      if (normalized) {
        const responseNorm = normalizeResponse(
          normalized.event.id,
          upstream.status,
          upstream.body,
          normalized.event.provider,
          seq++,
          latencyMs,
        );
        responseNorm.event.headers = options.redact
          ? redactHeaders(upstream.headers)
          : upstream.headers;
        await appendEvent(options.cassettePath, responseNorm.event);
      }

      res.statusCode = upstream.status;
      for (const [key, value] of Object.entries(upstream.headers)) {
        const lower = key.toLowerCase();
        if (lower === 'content-length' || lower === 'transfer-encoding' || lower === 'connection') continue;
        res.setHeader(key, value);
      }
      res.end(upstream.body);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(`traceplay recorder error: ${(err as Error).message}\n`);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      resolve({
        port: options.port,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
