import { promises as fs } from 'node:fs';
import { writeCassette } from '../cassette/store.js';
import { requestHash } from '../core/hash.js';
import type { CassetteMeta, TraceEvent } from '../types.js';

export interface SkillInfo {
  name: string;
  description: string;
  body: string;
}

export interface SkillRunOptions {
  skillPath: string;
  userMessage: string;
  outPath: string;
  mockResponse?: string;
  project?: string;
}

/**
 * Read and parse a SKILL.md file (YAML frontmatter + Markdown body).
 */
export async function readSkill(skillPath: string): Promise<SkillInfo> {
  const raw = await fs.readFile(skillPath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  let name = 'unknown-skill';
  let description = '';
  let body = raw;

  if (match) {
    const frontmatter = match[1];
    body = match[2];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();
    if (descMatch) description = descMatch[1].trim();
  }

  return { name, description, body };
}

/**
 * Run a skill in a minimal mock agent and produce a cassette.
 *
 * The mock agent uses the skill body as a system prompt and returns a
 * configurable mock response. This produces deterministic traces for
 * developing and testing assertion pipelines. For real skill testing,
 * record with `traceplay record` against your actual agent runtime.
 */
export async function runSkill(options: SkillRunOptions): Promise<string> {
  const skill = await readSkill(options.skillPath);
  const now = new Date().toISOString();

  const requestBody = {
    model: 'traceplay-mock',
    messages: [
      { role: 'system', content: skill.body },
      { role: 'user', content: options.userMessage },
    ],
  };

  const mockResponse =
    options.mockResponse ?? `[traceplay mock response for skill "${skill.name}"]\n\n${options.userMessage}`;

  const responseBody = {
    choices: [{ message: { role: 'assistant', content: mockResponse } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };

  const events: TraceEvent[] = [
    { id: 'u1', seq: 0, at: now, type: 'user.message', content: options.userMessage },
    {
      id: 'r1',
      seq: 1,
      at: now,
      type: 'llm.request',
      provider: 'other',
      model: 'traceplay-mock',
      messages: requestBody.messages,
      requestHash: requestHash(requestBody),
    },
    {
      id: 's1',
      seq: 2,
      at: now,
      type: 'llm.response',
      requestId: 'r1',
      status: 200,
      output: responseBody,
      rawBody: JSON.stringify(responseBody),
      usage: { promptTokens: 100, completionTokens: 50 },
    },
  ];

  const meta: CassetteMeta = {
    recordedAt: now,
    redacted: true,
    project: options.project ?? `skill:${skill.name}`,
  };

  await writeCassette(options.outPath, meta, events);
  return options.outPath;
}
