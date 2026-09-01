import http from 'node:http';
import https from 'node:https';
import { gunzipSync, inflateSync } from 'node:zlib';
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
          const raw = Buffer.concat(chunks);
          const enc = (res.headers['content-encoding'] || '').toLowerCase();
          let responseBuffer = raw;
          if (enc === 'gzip') {
            try {
              responseBuffer = gunzipSync(raw);
            } catch {
              // keep raw bytes if decompression fails
            }
          } else if (enc === 'deflate') {
            try {
              responseBuffer = inflateSync(raw);
            } catch {
              // keep raw bytes if decompression fails
            }
          }
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') responseHeaders[key] = value;
            else if (Array.isArray(value)) responseHeaders[key] = value.join(', ');
          }
          // Replay serves the decompressed plain text, so never keep the
          // encoding header or a stale content-length.
          if (enc) delete responseHeaders['content-encoding'];
          delete responseHeaders['content-length'];
          resolve({
            status: res.statusCode || 502,
            headers: responseHeaders,
            body: responseBuffer.toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (body.length > 0) req.write(body);
    req.end();
  });
}
