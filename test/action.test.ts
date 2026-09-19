import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface RunOptions {
  mockResponse?: string;
  threshold?: string;
  mode?: string;
  brokenSummary?: boolean;
  provider?: string;
}

async function run(
  body: string,
  {
    mockResponse = '',
    threshold = '0.85',
    mode = 'pr-body',
    brokenSummary = false,
    provider = '',
  }: RunOptions = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'if-ai-action-'));
  dirs.push(dir);
  const event = join(dir, 'event.json');
  const output = join(dir, 'output');
  const summary = join(dir, 'summary');
  let base = 'a'.repeat(40);
  let head = 'b'.repeat(40);
  if (mode !== 'pr-body') {
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    git('commit', '--allow-empty', '-m', 'base');
    base = git('rev-parse', 'HEAD');
    await writeFile(join(dir, 'good.txt'), 'The condition is met.');
    await writeFile(join(dir, 'Entire PR diff'), 'FAIL_CONDITION');
    git('add', 'good.txt', 'Entire PR diff');
    git('commit', '-m', 'head');
    head = git('rev-parse', 'HEAD');
  }
  await writeFile(
    event,
    JSON.stringify({ pull_request: { body, base: { sha: base }, head: { sha: head } } }),
  );
  await writeFile(output, '');
  await writeFile(summary, '');
  const result = await new Promise<{ code: number; log: string }>((resolveResult) => {
    execFile(
      process.execPath,
      [
        '--import',
        pathToFileURL(resolve('test/fixtures/mock-fetch.mjs')).href,
        resolve('dist/index.cjs'),
      ],
      {
        cwd: dir,
        windowsHide: true,
        env: {
          ...process.env,
          GITHUB_EVENT_PATH: event,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_OUTPUT: output,
          GITHUB_WORKSPACE: dir,
          GITHUB_STEP_SUMMARY: brokenSummary ? join(dir, 'missing', 'summary') : summary,
          INPUT_CONDITION: 'The content meets our policy.',
          'INPUT_MIN-CONFIDENCE': threshold,
          INPUT_MODE: mode,
          INPUT_PROVIDER: provider,
          INPUT_MODEL: '',
          'INPUT_API-KEY': 'secret-value',
          IF_AI_TEST_RESPONSE: mockResponse,
        },
      },
      (error, stdout, stderr) =>
        resolveResult({ code: error ? Number(error.code) || 1 : 0, log: stdout + stderr }),
    );
  });
  const values: Record<string, string> = {};
  const lines = (await readFile(output, 'utf8')).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const [key, delimiter] = lines[i]!.split('<<');
    if (!key || !delimiter) continue;
    const value: string[] = [];
    while (++i < lines.length && lines[i] !== delimiter) value.push(lines[i]!);
    values[key] = value.join('\n');
  }
  return { ...result, values, summary: await readFile(summary, 'utf8') };
}

it('runs the shipped bundle and writes real GitHub outputs and a summary', async () => {
  const result = await run('Policy is met.');
  expect(result.code).toBe(0);
  expect(result.values).toMatchObject({ result: 'true', confidence: '0.95', status: 'passed' });
  expect(result.summary).toContain('if-ai: passed');
  expect(result.log).toContain('typesafe/jev-1.13 via openrouter');
});

it('keeps direct TypeSafe access available through an explicit provider', async () => {
  const result = await run('Policy is met.', { provider: 'typesafe' });
  expect(result.code).toBe(0);
  expect(result.log).toContain('jev-1.13.0 via typesafe');
});

it.each([
  ['FAIL_CONDITION', '', 'failed'],
  ['Policy is met.', 'uncertain', 'failed'],
  ['PRIVATE_SOURCE', 'error', 'error'],
])('fails the actual process for %s / %s', async (body, mock, status) => {
  const result = await run(body, { mockResponse: mock });
  expect(result.code).toBe(1);
  expect(result.values).toMatchObject({ result: 'false', status });
  expect(result.log).not.toContain('PRIVATE_SOURCE');
  // The masking command itself contains the key; no error message may echo it.
  expect(
    result.log
      .split('\n')
      .filter((line) => line.startsWith('::error'))
      .join('\n'),
  ).not.toContain('secret-value');
});

it('fails with initialized outputs when a required confidence is missing', async () => {
  const result = await run('Policy is met.', { threshold: '' });
  expect(result.code).toBe(1);
  expect(result.values).toMatchObject({ result: 'false', confidence: '0', status: 'error' });
});

it('reports the failing file through the actual per-file bundle', async () => {
  const result = await run('', { mode: 'per-file' });
  expect(result.code).toBe(1);
  expect(JSON.parse(result.values['failed-files']!)).toEqual(['Entire PR diff']);
  expect(JSON.parse(result.values.results!)).toEqual([
    { name: 'Entire PR diff', status: 'condition-false', confidence: 0.95 },
    { name: 'good.txt', status: 'passed', confidence: 0.95 },
  ]);
});

it('resets passing outputs if summary reporting fails', async () => {
  const result = await run('Policy is met.', { brokenSummary: true });
  expect(result.code).toBe(1);
  expect(result.values).toMatchObject({ result: 'false', confidence: '0', status: 'error' });
});

it.each([
  ['Policy is met.', '', 'passed'],
  ['FAIL_CONDITION', '', 'failed'],
  ['Policy is met.', 'uncertain', 'failed'],
  ['PRIVATE_SOURCE', 'error', 'error'],
])('uses OpenRouter through the shipped bundle for %s / %s', async (body, mockResponse, status) => {
  const result = await run(body, { provider: 'openrouter', mockResponse });
  expect(result.code).toBe(status === 'passed' ? 0 : 1);
  expect(result.values.status).toBe(status);
  expect(result.log).not.toContain('PRIVATE_SOURCE');
});
