import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { runSkill, readSkill } from './runner.js';
import type { Assertion } from '../types.js';

export interface SkillTestInput {
  name: string;
  userMessage: string;
  assertions?: Assertion[];
  mockResponse?: string;
}

export interface GenerateSuiteOptions {
  skillPath: string;
  inputs: SkillTestInput[];
  outDir: string;
}

/**
 * Generate a complete test suite (cassettes + suite.yaml) for a skill,
 * given a list of test inputs. Each input produces one cassette and one
 * test case. Default assertions check that the answer contains the first
 * 20 chars of the user message.
 */
export async function generateSkillSuite(options: GenerateSuiteOptions): Promise<string> {
  const skill = await readSkill(options.skillPath);
  const cassettesDir = join(options.outDir, 'cassettes');
  await fs.mkdir(cassettesDir, { recursive: true });

  const cases = [];
  for (const input of options.inputs) {
    const cassettePath = join(cassettesDir, `${input.name}.jsonl`);
    await runSkill({
      skillPath: options.skillPath,
      userMessage: input.userMessage,
      outPath: cassettePath,
      mockResponse: input.mockResponse,
    });

    const containsText = input.userMessage.trim();
    const assertions: Assertion[] = input.assertions ?? (containsText.length > 0
      ? [
          { kind: 'answer.contains', text: containsText.slice(0, Math.min(20, containsText.length)) },
          { kind: 'budget.maxTokens', value: 500 },
        ]
      : [
          // Empty/whitespace input: a content assertion would be vacuous
          // (any string contains ""), so only enforce the resource budget.
          { kind: 'budget.maxTokens', value: 500 },
        ]);

    cases.push({
      name: input.name,
      cassette: `./cassettes/${input.name}.jsonl`,
      assertions,
    });
  }

  const suite = { suite: `skill: ${skill.name}`, cases };
  const suitePath = join(options.outDir, 'suite.yaml');
  await fs.writeFile(suitePath, stringify(suite), 'utf8');
  return suitePath;
}
