import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (!process.env.TYPESAFE_API_KEY) {
  console.error('Add the TYPESAFE_API_KEY repository secret before running the live smoke test.');
  process.exit(1);
}
const dir = await mkdtemp(join(tmpdir(), 'if-ai-live-'));
try {
  const eventPath = join(dir, 'event.json');
  await writeFile(eventPath, JSON.stringify({ pull_request: {
    body: 'Problem: the parser crashes on empty input. This PR adds an empty-input guard. Test plan: run npm test, including a new regression test for the empty string.',
    base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) },
  } }));
  const result = spawnSync(process.execPath, [resolve('dist/index.cjs')], {
    stdio: 'inherit',
    env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath,
      INPUT_MODE: 'pr-body', INPUT_CONDITION: 'The description contains a concrete test plan.',
      'INPUT_MIN-CONFIDENCE': '0.80', 'INPUT_API-KEY': process.env.TYPESAFE_API_KEY },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
