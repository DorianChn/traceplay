import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface InitArgs {
  dir?: string;
}

const SUITE_TEMPLATE = `suite: my-agent
cases:
  - name: example case
    cassette: ./cassettes/example.jsonl
    assertions:
      - { kind: answer.contains, text: "expected output" }
      - { kind: budget.maxTokens, value: 2000 }
`;

const GITIGNORE_APPEND = `
# traceplay
*.cassette.jsonl
cassettes/local/
.traceplay/
`;

export async function runInit(args: InitArgs): Promise<number> {
  const dir = args.dir ?? '.';
  const cassettesDir = join(dir, 'cassettes');

  await fs.mkdir(cassettesDir, { recursive: true });
  await fs.writeFile(join(cassettesDir, '.gitkeep'), '', 'utf8');
  await fs.writeFile(join(dir, 'suite.yaml'), SUITE_TEMPLATE, 'utf8');

  const gitignorePath = join(dir, '.gitignore');
  try {
    const existing = await fs.readFile(gitignorePath, 'utf8');
    if (!existing.includes('traceplay')) {
      await fs.appendFile(gitignorePath, GITIGNORE_APPEND, 'utf8');
    }
  } catch {
    await fs.writeFile(gitignorePath, GITIGNORE_APPEND.trim() + '\n', 'utf8');
  }

  console.log(`[traceplay] initialized project in ${dir}`);
  console.log('  suite.yaml        — edit your test cases here');
  console.log('  cassettes/        — recorded trajectories go here');
  console.log('');
  console.log('Next steps:');
  console.log('  1. traceplay record --out cassettes/example.jsonl');
  console.log('  2. traceplay test suite.yaml');
  return 0;
}
