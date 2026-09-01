import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface RawUpstream {
  status: number;
  headers: Record<string, string>;
  res: IncomingMessage;
}

function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.join(', ');
  }
  return out;
}

function openRequest(
  upstreamBase: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): { req: http.ClientRequest; onResponse: (fn: (res: IncomingMessage) => void) => void } {
  const url = new URL(path, upstreamBase);
  const lib = url.protocol === 'https:' ? https : http;

  const reqHeaders: Record<string, string> = { ...headers };
  delete reqHeaders.host;
  delete reqHeaders['content-length'];
  if (body.length > 0) {
    reqHeaders['content-length'] = Buffer.byteLength(body).toString();
  }

  let responseHandler: ((res: IncomingMessage) => void) | null = null;
  const req = lib.request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: reqHeaders,
    },
    (res) => {
      if (responseHandler) responseHandler(res);
    },
  );
  req.on('error', () => undefined); // surfaced via promise rejection below
  if (body.length > 0) req.write(body);
  req.end();

  return {
    req,
    onResponse(fn) {
      responseHandler = fn;
    },
  };
}

/**
 * Forward an HTTP request to the upstream LLM provider, buffering the
 * response body. Use for non-streaming responses.
 * Supports both http:// and https:// upstreams.
 */
export function forwardRequest(
  upstreamBase: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<ForwardResult> {
  return new Promise((resolve, reject) => {
    const opened = openRequest(upstreamBase, method, path, headers, body);
    opened.req.on('error', reject);
    opened.onResponse((res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 502,
          headers: flattenHeaders(res.headers),
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
  });
}

/**
 * Open an upstream request and return the raw response stream without
 * buffering it. Used by the recorder to support streaming (SSE) responses
 * — the recorder pipes chunks to the client while capturing them.
 */
export function forwardRaw(
  upstreamBase: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<RawUpstream> {
  return new Promise((resolve, reject) => {
    const opened = openRequest(upstreamBase, method, path, headers, body);
    opened.req.on('error', reject);
    opened.onResponse((res) => {
      resolve({ status: res.statusCode || 502, headers: flattenHeaders(res.headers), res });
    });
  });
}
