import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

export interface JudgeResult {
  status: 'ok' | 'todo';
  passed?: boolean;
  reason?: string;
  message?: string;
}

export interface JudgeOptions {
  model?: string;
  apiBase?: string;
  apiKey?: string;
  cacheDir?: string;
}

const DEFAULT_CACHE_DIR = '.traceplay/judge-cache';

/**
 * LLM-as-judge with on-disk caching.
 *
 * answer.judge assertions call an OpenAI-compatible /chat/completions
 * endpoint to evaluate the answer against a rubric. Results are cached to
 * .traceplay/judge-cache/<hash>.json so repeated test runs are free and
 * deterministic. If no API key is configured (env TRACEPLAY_JUDGE_API_KEY
 * or options.apiKey), the assertion is marked `todo` instead of failing.
 */
export async function judgeAnswer(answer: string, rubric: string, options: JudgeOptions = {}): Promise<JudgeResult> {
  const apiKey = options.apiKey ?? process.env.TRACEPLAY_JUDGE_API_KEY;
  if (!apiKey) {
    return {
      status: 'todo',
      message: 'no judge API key (set TRACEPLAY_JUDGE_API_KEY) — assertion skipped',
    };
  }

  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const cacheKey = createHash('sha256')
    .update(JSON.stringify({ answer, rubric, model: options.model ?? 'gpt-4o-mini' }))
    .digest('hex');
  const cachePath = join(cacheDir, `${cacheKey}.json`);

  try {
    const cached = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(cached) as { passed: boolean; reason: string };
    return { status: 'ok', passed: parsed.passed, reason: parsed.reason };
  } catch {
    // cache miss — proceed to call
  }

  const model = options.model ?? 'gpt-4o-mini';
  const apiBase = options.apiBase ?? 'https://api.openai.com/v1';
  const systemPrompt =
    'You are a strict test judge. Given an answer and a rubric, decide if the answer satisfies the rubric. Respond ONLY with valid JSON: {"passed": true|false, "reason": "short explanation"}.';
  const userPrompt = `Rubric: ${rubric}\n\nAnswer: ${answer}`;

  try {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    });

    const raw = await postJson(apiBase, '/chat/completions', apiKey, body);
    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    const content = parsed.choices?.[0]?.message?.content ?? '{}';
    const judge = JSON.parse(content) as { passed: boolean; reason: string };

    await fs.mkdir(dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(judge), 'utf8');

    return { status: 'ok', passed: judge.passed === true, reason: judge.reason ?? '' };
  } catch (err) {
    return { status: 'todo', message: `judge call failed: ${(err as Error).message} — assertion skipped` };
  }
}

function postJson(apiBase: string, path: string, apiKey: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, apiBase);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
