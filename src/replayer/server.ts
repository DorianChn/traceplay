import http from 'node:http';
import { readCassette } from '../cassette/store.js';
import { matchRequest, createReplaySession, type ReplaySession } from './matcher.js';
import { serializeSSE } from '../cassette/stream.js';
import type { Cassette, LLMResponseEvent } from '../types.js';

export interface ReplayerOptions {
  port: number;
  cassettePath: string;
  /** Enable L2/L3 fuzzy matching when the exact/semantic hash misses. */
  fuzzy?: boolean;
  /** L3 token-set Jaccard threshold (0..1). Default 0.6. */
  fuzzyThreshold?: number;
  /** L2 structured-similarity threshold (0..1). Default 0.55. */
  structuredThreshold?: number;
  /** Required best-vs-runner-up gap to accept a probabilistic match. Default 0.1. */
  ambiguityGap?: number;
  /**
   * Walk the recorded trajectory in order (R4). Default true: the k-th live
   * request only matches recorded step k or later, so repeated identical
   * prompts replay in sequence. Set false for the v0.5 global-scan behavior.
   */
  stateful?: boolean;
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
  const matchOptions = {
    fuzzy: options.fuzzy,
    threshold: options.fuzzyThreshold,
    structuredThreshold: options.structuredThreshold,
    ambiguityGap: options.ambiguityGap,
  };
  // R4: a stateful session walks the trajectory in order; the stateless path
  // (v0.5 global scan) remains available for one-shot / out-of-order clients.
  const session: ReplaySession | null =
    options.stateful === false ? null : createReplaySession(cassette.events, matchOptions);

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

      const match = session
        ? session.match(body)
        : matchRequest(body, cassette.events, matchOptions);

      if (match.ambiguous) {
        // Two recorded responses are almost equally likely — guessing would
        // replay the wrong answer and make the test pass for the wrong reason.
        res.statusCode = 409;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'ambiguous cassette match',
            statusCode: 409,
            strategy: match.strategy,
            score: match.score,
            runnerUpScore: match.runnerUpScore,
            message:
              match.diagnostic ??
              'Two recorded requests match almost equally. Re-record with a more specific cassette or lower --ambiguity-gap deliberately.',
            path: req.url,
          }),
        );
        return;
      }

      if (!match.found) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'no cassette match',
            statusCode: 404,
            strategy: match.strategy,
            score: match.score,
            message:
              (match.diagnostic ??
                'No recorded response matches this request. Re-run with `traceplay record` to capture it.') +
              (options.fuzzy ? '' : ' Try --fuzzy for L2/L3 approximate matching.'),
            path: req.url,
          }),
        );
        return;
      }

      const responseEvent = cassette.events[match.responseIndex] as LLMResponseEvent;
      res.statusCode = responseEvent.status;
      // Surface which layer matched (and its score) for observability/debugging.
      res.setHeader('x-traceplay-match', match.strategy);
      if (typeof match.score === 'number' && match.strategy !== 'exact' && match.strategy !== 'semantic') {
        res.setHeader('x-traceplay-score', match.score.toFixed(3));
      }

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
