import { join } from 'node:path';
import { readSkill } from '../skills/runner.js';
import { generateSkillSuite } from '../skills/adapter.js';
import { generateEdgeCases, defaultBaseFromSkill } from '../generate/edgecases.js';

export interface GenerateArgs {
  skill: string;
  out: string;
  base?: string;
}

/**
 * `traceplay generate --skill <SKILL.md> --out <dir> [--base <prompt>]`
 *
 * Generates an edge-case test suite for an Agent Skill: it derives a set of
 * boundary inputs (empty, special chars, extreme length, off-topic, …) from
 * the skill description, runs each through the mock agent, and writes
 * cassettes + suite.yaml you can `traceplay test` right away.
 */
export async function runGenerate(args: GenerateArgs): Promise<number> {
  const skill = await readSkill(args.skill);
  const base = args.base ?? defaultBaseFromSkill(skill.name);
  const edgeCases = generateEdgeCases(base, skill.description);

  const inputs = edgeCases.map((c) => ({
    name: c.name,
    userMessage: c.message,
  }));

  const suitePath = await generateSkillSuite({
    skillPath: args.skill,
    inputs,
    outDir: args.out,
  });

  const cassettesDir = join(args.out, 'cassettes');
  console.log(`[traceplay] generated ${edgeCases.length} edge-case cassettes in ${cassettesDir}`);
  console.log(`[traceplay] suite: ${suitePath}`);
  console.log('');
  console.log('Next step:');
  console.log(`  traceplay test ${suitePath}`);
  return 0;
}
