import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ActionError, type Mode, type PullRequest } from './config.js';
import type { Subject } from './check.js';

const exec = promisify(execFile);
const MAX_FILES = 200;
const flags = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-renames',
  '--ignore-submodules=none',
];

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', ['--no-literal-pathspecs', ...args], {
      cwd,
      encoding: 'buffer',
      maxBuffer: 2_000_000,
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    return new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  } catch {
    throw new ActionError(
      'Cannot read the complete Git diff. Use actions/checkout with fetch-depth: 0 and ensure both event commits exist. Git output must be UTF-8 and below 2 MB per command.',
    );
  }
}

export async function collectSubjects(
  mode: Mode,
  pr: PullRequest,
  cwd: string,
): Promise<Subject[]> {
  if (mode === 'pr-body') {
    if (!pr.body.trim())
      throw new ActionError('The PR body is empty. Add a description before running this check.');
    return [{ name: 'PR body', content: pr.body }];
  }
  const shallow = (await git(cwd, ['rev-parse', '--is-shallow-repository'])).trim();
  if (shallow !== 'false')
    throw new ActionError('A full-history checkout is required. Set fetch-depth: 0.');
  const mergeBase = (await git(cwd, ['merge-base', pr.base, pr.head])).trim();
  if (!/^[a-f0-9]{40}$/.test(mergeBase))
    throw new ActionError('Cannot determine the PR merge base.');
  const raw = await git(cwd, ['diff', ...flags, '--raw', '-z', mergeBase, pr.head, '--']);
  const fields = raw.split('\0');
  if (fields.pop() !== '') throw new ActionError('Invalid Git change list.');
  if (fields.length === 0) throw new ActionError('The PR has no changed files to evaluate.');
  if (fields.length % 2 !== 0 || fields.length / 2 > MAX_FILES) {
    throw new ActionError(
      'The PR exceeds the 200-file limit or Git returned an invalid change list. Split the PR; nothing was truncated.',
    );
  }
  const subjects: Subject[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const meta = fields[i]!;
    const name = fields[i + 1]!;
    if (!/^:\d{6} \d{6} [a-f0-9]+ [a-f0-9]+ [AMDT]$/.test(meta) || !name) {
      throw new ActionError('Git returned an unsupported change record.');
    }
    try {
      if (/^:(?:160000 |\d{6} 160000 )/.test(meta))
        throw new ActionError('Submodule contents cannot be evaluated as a text diff.');
      // A literal path still matches descendants. Exclude them when a file becomes
      // a directory (or the reverse), so each subject contains exactly one path.
      const pathspec = [`:(top,literal)${name}`, `:(top,exclude,literal)${name}/`];
      const stat = await git(cwd, [
        'diff',
        ...flags,
        '--numstat',
        '-z',
        mergeBase,
        pr.head,
        '--',
        ...pathspec,
      ]);
      if (stat.startsWith('-\t-\t'))
        throw new ActionError('Binary content cannot be evaluated as a text diff.');
      const patch = await git(cwd, [
        'diff',
        ...flags,
        '--unified=3',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        mergeBase,
        pr.head,
        '--',
        ...pathspec,
      ]);
      if (patch.includes('\0')) throw new ActionError('Non-text content cannot be evaluated.');
      if (/^[ +\-]version https:\/\/git-lfs.github.com\/spec\/v1\r?$/m.test(patch)) {
        throw new ActionError('Git LFS pointers do not contain the changed file contents.');
      }
      if (!patch.trim()) throw new ActionError('Git did not return a patch for this changed file.');
      subjects.push({ name, content: patch });
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      subjects.push({ name, error: error.message });
    }
  }
  if (mode === 'per-file') return subjects;
  const errors = subjects.filter((s) => s.error);
  // Preserve file-specific diagnostics even when the entire-diff evaluation cannot run.
  if (errors.length) return errors;
  return [{ name: 'Entire PR diff', content: subjects.map((s) => s.content).join('') }];
}
