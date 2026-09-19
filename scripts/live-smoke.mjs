import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const provider = process.env.IF_AI_PROVIDER || 'typesafe';
if (provider !== 'typesafe' && provider !== 'openrouter')
  throw new Error('Invalid smoke provider.');
if (!process.env.IF_AI_API_KEY) {
  console.error(
    `Add the ${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'TYPESAFE_API_KEY'} repository secret before running the live smoke test.`,
  );
  process.exit(1);
}
const dir = await mkdtemp(join(tmpdir(), 'if-ai-live-'));
const bundle = resolve('dist/index.cjs');
try {
  const eventPath = join(dir, 'event.json');
  const outputPath = join(dir, 'output');
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'if-ai smoke');
  git('config', 'user.email', 'smoke@example.com');
  git('commit', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  await writeFile(
    join(dir, 'testing.md'),
    'Before submitting a change, run npm test and verify all tests pass.\n',
  );
  await writeFile(join(dir, 'review.md'), 'Before review, run npm test to check your changes.\n');
  git('add', 'testing.md', 'review.md');
  git('commit', '-m', 'document test commands');
  let head = git('rev-parse', 'HEAD');
  async function event() {
    await writeFile(
      eventPath,
      JSON.stringify({
        pull_request: {
          body: 'Problem: the parser crashes on empty input. This PR adds an empty-input guard. Test plan: run npm test, including a new regression test for the empty string.',
          base: { sha: base },
          head: { sha: head },
        },
      }),
    );
  }
  async function check(mode, condition, expected = true) {
    await event();
    await writeFile(outputPath, '');
    const result = spawnSync(process.execPath, [bundle], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_WORKSPACE: dir,
        GITHUB_OUTPUT: outputPath,
        INPUT_MODE: mode,
        INPUT_PROVIDER: provider,
        INPUT_MODEL: '',
        INPUT_CONDITION: condition,
        'INPUT_MIN-CONFIDENCE': '0.80',
        'INPUT_API-KEY': process.env.IF_AI_API_KEY,
      },
    });
    const lines = (await readFile(outputPath, 'utf8')).split(/\r?\n/);
    const values = {};
    for (let i = 0; i < lines.length; i++) {
      const [key, delimiter] = lines[i].split('<<');
      if (!key || !delimiter) continue;
      const value = [];
      while (++i < lines.length && lines[i] !== delimiter) value.push(lines[i]);
      values[key] = value.join('\n');
    }
    if (
      result.status !== (expected ? 0 : 1) ||
      values.result !== String(expected) ||
      values.status !== (expected ? 'passed' : 'failed')
    ) {
      // Never dump child logs or request content, including on test failures.
      throw new Error(
        `${mode} live smoke did not return the expected ${expected ? 'pass' : 'failure'}; status=${values.status}, confidence=${values.confidence}. See the job summary.`,
      );
    }
    if (!expected && !JSON.parse(values['failed-files']).includes('unsafe.md')) {
      throw new Error('Per-file failure did not identify unsafe.md.');
    }
    console.log(
      `${mode}: verified ${expected ? 'pass' : 'expected failure identifying unsafe.md'}, confidence=${values.confidence}.`,
    );
  }
  await check('pr-body', 'The description contains a concrete test plan.');
  const condition = 'The added text explicitly instructs developers to run npm test.';
  await check('diff', condition);
  await check('per-file', condition);
  await writeFile(
    join(dir, 'unsafe.md'),
    'Submit the change immediately without running any tests.\n',
  );
  git('add', 'unsafe.md');
  git('commit', '-m', 'add intentionally failing fixture');
  head = git('rev-parse', 'HEAD');
  await check('per-file', condition, false);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
