import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { collectSubjects } from '../src/git.js';

const dirs: string[] = [];
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
async function repository() {
  const cwd = await mkdtemp(join(tmpdir(), 'if-ai-git-'));
  dirs.push(cwd);
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'core.autocrlf', 'false');
  await writeFile(join(cwd, 'existing.txt'), 'old text\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'base');
  return { cwd, base: git(cwd, 'rev-parse', 'HEAD') };
}
function commit(cwd: string) {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-m', 'change');
  return git(cwd, 'rev-parse', 'HEAD');
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('reads PR body without needing a Git checkout', async () => {
  expect(
    await collectSubjects(
      'pr-body',
      { body: 'Expected behavior and tests', base: '', head: '' },
      '/missing',
    ),
  ).toEqual([{ name: 'PR body', content: 'Expected behavior and tests' }]);
  await expect(
    collectSubjects('pr-body', { body: ' ', base: '', head: '' }, '/missing'),
  ).rejects.toThrow('empty');
});

it('includes every file, deleted content, and literal special-character paths', async () => {
  const { cwd, base } = await repository();
  await unlink(join(cwd, 'existing.txt'));
  await writeFile(join(cwd, '[literal] name.txt'), 'new behavior\n');
  const head = commit(cwd);
  const subjects = await collectSubjects('per-file', { base, head, body: '' }, cwd);
  expect(subjects.map((s) => s.name)).toEqual(['[literal] name.txt', 'existing.txt']);
  expect(subjects[0]?.content).toContain('+new behavior');
  expect(subjects[0]?.content).not.toContain('-old text');
  expect(subjects[1]?.content).toContain('-old text');
  const combined = await collectSubjects('diff', { base, head, body: '' }, cwd);
  expect(combined[0]?.content).toContain('+new behavior');
  expect(combined[0]?.content).toContain('-old text');
});

it('uses merge-base and event head, ignoring newer base and working tree changes', async () => {
  const { cwd, base } = await repository();
  git(cwd, 'checkout', '-b', 'feature');
  await writeFile(join(cwd, 'feature.txt'), 'feature\n');
  const head = commit(cwd);
  git(cwd, 'checkout', 'main');
  await writeFile(join(cwd, 'base-only.txt'), 'unrelated base work\n');
  const newerBase = commit(cwd);
  await writeFile(join(cwd, 'existing.txt'), 'uncommitted noise\n');
  const result = await collectSubjects('diff', { base: newerBase, head, body: '' }, cwd);
  expect(result[0]?.content).toContain('feature');
  expect(result[0]?.content).not.toContain('unrelated');
  expect(result[0]?.content).not.toContain('uncommitted');
  expect(newerBase).not.toBe(base);
});

it('represents renames as a complete deletion plus addition', async () => {
  const { cwd, base } = await repository();
  await rename(join(cwd, 'existing.txt'), join(cwd, 'renamed.txt'));
  const result = await collectSubjects('per-file', { base, head: commit(cwd), body: '' }, cwd);
  expect(result.map((r) => r.name)).toEqual(['existing.txt', 'renamed.txt']);
  expect(result[0]?.content).toContain('-old text');
  expect(result[1]?.content).toContain('+old text');
});

it('identifies binary files and LFS pointers instead of judging incomplete content', async () => {
  const { cwd, base } = await repository();
  await writeFile(join(cwd, 'image.bin'), Buffer.from([0, 1, 2, 0]));
  await writeFile(
    join(cwd, 'large.dat'),
    'version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 100\n',
  );
  await writeFile(join(cwd, 'valid.txt'), 'valid\n');
  const head = commit(cwd);
  const result = await collectSubjects('per-file', { base, head, body: '' }, cwd);
  expect(result.find((s) => s.name === 'image.bin')?.error).toContain('Binary');
  expect(result.find((s) => s.name === 'large.dat')?.error).toContain('LFS');
  expect(result.find((s) => s.name === 'valid.txt')?.content).toContain('+valid');
  const combined = await collectSubjects('diff', { base, head, body: '' }, cwd);
  expect(combined).toHaveLength(2);
  expect(combined.every((s) => s.error)).toBe(true);
});

it('rejects empty comparisons and unavailable commit history', async () => {
  const { cwd, base } = await repository();
  await expect(collectSubjects('diff', { base, head: base, body: '' }, cwd)).rejects.toThrow(
    'no changed files',
  );
  await expect(
    collectSubjects('diff', { base, head: '0'.repeat(40), body: '' }, cwd),
  ).rejects.toThrow('complete Git diff');
});

it('does not let Git ignore settings hide submodule changes', async () => {
  const { cwd, base } = await repository();
  git(cwd, 'config', 'diff.ignoreSubmodules', 'all');
  git(cwd, 'update-index', '--add', '--cacheinfo', `160000,${base},vendor`);
  git(cwd, 'commit', '-m', 'add gitlink');
  const head = git(cwd, 'rev-parse', 'HEAD');
  const result = await collectSubjects('per-file', { base, head, body: '' }, cwd);
  expect(result).toEqual([
    { name: 'vendor', error: 'Submodule contents cannot be evaluated as a text diff.' },
  ]);
});

it('rejects modified LFS pointers whose unchanged header is a context line', async () => {
  const { cwd } = await repository();
  const pointer = (oid: string) =>
    `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 100\n`;
  await writeFile(join(cwd, 'asset.dat'), pointer('a'.repeat(64)));
  const base = commit(cwd);
  await writeFile(join(cwd, 'asset.dat'), pointer('b'.repeat(64)));
  const head = commit(cwd);
  const result = await collectSubjects('per-file', { base, head, body: '' }, cwd);
  expect(result[0]?.error).toContain('LFS');
});

it.each(['file-to-directory', 'directory-to-file'])(
  'isolates each patch during a %s replacement',
  async (direction) => {
    const { cwd } = await repository();
    const name = '[literal] item';
    if (direction === 'file-to-directory') {
      await writeFile(join(cwd, name), 'old parent content\n');
    } else {
      await mkdir(join(cwd, name));
      await writeFile(join(cwd, name, 'child.txt'), 'old child content\n');
    }
    const base = commit(cwd);
    if (direction === 'file-to-directory') {
      await unlink(join(cwd, name));
      await mkdir(join(cwd, name));
      await writeFile(join(cwd, name, 'child.txt'), 'new child content\n');
    } else {
      await unlink(join(cwd, name, 'child.txt'));
      await rm(join(cwd, name), { recursive: true });
      await writeFile(join(cwd, name), 'new parent content\n');
    }
    const head = commit(cwd);
    const subjects = await collectSubjects('per-file', { base, head, body: '' }, cwd);
    expect(subjects.map((subject) => subject.name)).toEqual([name, `${name}/child.txt`]);
    expect(subjects[0]?.content).toContain('parent content');
    expect(subjects[0]?.content).not.toContain('child content');
    expect(subjects[1]?.content).toContain('child content');
    expect(subjects[1]?.content).not.toContain('parent content');
    const combined = await collectSubjects('diff', { base, head, body: '' }, cwd);
    expect(combined[0]?.content?.match(/^diff --git /gm)).toHaveLength(2);
  },
);
