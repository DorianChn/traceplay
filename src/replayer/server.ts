import http from 'node:http';
import { readCassette } from '../cassette/store.js';
import { matchRequest } from './matcher.js';
import { serializeSSE } from '../cassette/stream.js';
import type { Cassette, LLMResponseEvent } from '../types.js';

export interface ReplayerOptions {
  port: number;
  cassettePath: string;
  /** Enable fuzzy matching when the exact request hash misses. */
  fuzzy?: boolean;
  /** Similarity threshold (0..1) for fuzzy matches. Default 0.6. */
  fuzzyThreshold?: number;
}

export interface ReplayerHandle {
  port: number;
  close(): Promise<void>;
}

/**
 * Offline replay server.
 *
 * Loads a cassette once at startup. Every incoming request is hashed and
 * matched against recorded llm.request events (exactly, or by similarity
 * when `fuzzy` is enabled). On a hit, the corresponding llm.response is
 * returned — raw body + status + headers, or the recorded SSE stream when
 * the response was recorded as streaming. No network, no tokens, fully
 * deterministic. On a miss, returns 404 with a hint to re-record.
 */
export async function startReplayer(options: ReplayerOptions): Promise<ReplayerHandle> {
  const cassette: Cassette = await readCassette(options.cassettePath);

  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      await new Promise<void>((resolve) => req.on('end', resolve));
      const rawBody = Buffer.concat(chunks).toString('utf8');

      let body: unknown = rawBody;
      try {
        body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
      } catch {
        // non-JSON body — keep raw for hash (will likely miss, which is correct)
      }

      const match = matchRequest(body, cassette.events, {
        fuzzy: options.fuzzy,
        threshold: options.fuzzyThreshold,
      });
      if (!match.found) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'no cassette match',
            message:
              'No recorded response matches this request. Re-run with `traceplay record` to capture it, or check that the request body is identical to the recorded one.' +
              (options.fuzzy ? ` (closest similarity: ${(match.score ?? 0).toFixed(2)})` : ' Try --fuzzy for approximate matching.'),
            path: req.url,
          }),
        );
        return;
      }

      const responseEvent = cassette.events[match.responseIndex] as LLMResponseEvent;
      res.statusCode = responseEvent.status;

      let hasContentType = false;
      if (responseEvent.headers) {
        for (const [key, value] of Object.entries(responseEvent.headers)) {
          const lower = key.toLowerCase();
          if (lower === 'content-length' || lower === 'transfer-encoding' || lower === 'connection' || lower === 'content-encoding') continue;
          if (lower === 'content-type') hasContentType = true;
          res.setHeader(key, value);
        }
      }

      if (responseEvent.stream) {
        // Serve the recorded stream back as SSE.
        const content =
          (responseEvent.output as { content?: string } | undefined)?.content ?? '';
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        const model = (cassette.events[match.requestIndex] as { model?: string }).model ?? 'traceplay-replay';
        res.end(serializeSSE(content, { model, usage: responseEvent.usage }));
        return;
      }

      if (!hasContentType) {
        res.setHeader('content-type', 'application/json');
      }
      res.end(responseEvent.rawBody ?? JSON.stringify(responseEvent.output));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(`traceplay replayer error: ${(err as Error).message}\n`);
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
