import http from 'node:http';

/**
 * Recording proxy (M1).
 *
 * Sits between an agent and its LLM provider. The agent points BASE_URL at
 * http://localhost:<port>; every request is normalized into a TraceEvent,
 * appended to the cassette, and forwarded upstream.
 *
 * This file is the M0 skeleton: the server boots and returns 501 with a
 * clear message, so `traceplay record` is runnable end-to-end on Day 1.
 * The actual forwarding + event persistence is implemented in M1 (Day 2-3).
 */

export interface RecorderOptions {
  port: number;
  upstream: string;
  cassettePath: string;
  redact: boolean;
}

export interface RecorderHandle {
  port: number;
  close(): Promise<void>;
}

export function startRecorder(options: RecorderOptions): Promise<RecorderHandle> {
  const server = http.createServer((_req, res) => {
    // M1 request lifecycle (implemented Day 2-3):
    //   1. buffer request body + headers (redact Authorization when options.redact)
    //   2. persist normalized llm.request event (requestHash via replay/matcher)
    //   3. forward to options.upstream with node:https, preserving method/path
    //   4. pipe upstream response back to client while buffering a copy
    //   5. on 'end', persist llm.response with status + usage + latencyMs
    res.statusCode = 501;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('traceplay recorder: M1 not implemented yet. See ROADMAP.md\n');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      resolve({
        port: options.port,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
