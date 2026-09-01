import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Forward an HTTP request to the upstream LLM provider.
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
    const url = new URL(path, upstreamBase);
    const lib = url.protocol === 'https:' ? https : http;

    const reqHeaders: Record<string, string> = { ...headers };
    delete reqHeaders.host;
    delete reqHeaders['content-length'];
    if (body.length > 0) {
      reqHeaders['content-length'] = Buffer.byteLength(body).toString();
    }

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') responseHeaders[key] = value;
            else if (Array.isArray(value)) responseHeaders[key] = value.join(', ');
          }
          resolve({ status: res.statusCode || 502, headers: responseHeaders, body: responseBody });
        });
      },
    );
    req.on('error', reject);
    if (body.length > 0) req.write(body);
    req.end();
  });
}
