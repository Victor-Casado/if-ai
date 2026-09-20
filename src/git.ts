import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ActionError, type Mode, type PullRequest } from './config.js';
import type { Subject } from './check.js';

const exec = promisify(execFile);
// Node buffers a child process's stdout in memory, so these bound what the
// Action can read at all. max-file-bytes covers one file's patch, which is its
// own command: verified at the 2 MB default, one 1.9 MB file is read in full,
// one 2.1 MB file is not, and 2.7 MB over three files is fine.
//
// Change lists and commit metadata get their own ceiling. They grow with the
// number of changed paths rather than with any one file, so lowering
// max-file-bytes to bound a single patch must not make them unreadable.
const METADATA_OUTPUT_BYTES = 2_000_000;
const flags = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-renames',
  '--ignore-submodules=none',
];

async function git(
  cwd: string,
  args: string[],
  maxBytes: number,
  oversize: (limit: number) => string,
): Promise<string> {
  try {
    const { stdout } = await exec('git', ['--no-literal-pathspecs', ...args], {
      cwd,
      encoding: 'buffer',
      maxBuffer: maxBytes,
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    return new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  } catch (error) {
    // Too big to read and unable to read need different fixes, so say which.
    if ((error as { code?: string } | undefined)?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new ActionError(oversize(maxBytes));
    }
    throw new ActionError(
      'Cannot read the complete Git diff. Use actions/checkout with fetch-depth: 0 and ensure both event commits exist. Git output must be UTF-8.',
    );
  }
}

export interface Budget {
  paths: string[];
  maxFiles: number;
  maxFileBytes: number;
}

export async function collectSubjects(
  mode: Mode,
  pr: PullRequest,
  cwd: string,
  budget: Budget,
): Promise<Subject[]> {
  const { paths, maxFiles, maxFileBytes } = budget;
  // Raising max-file-bytes raises the metadata ceiling with it; lowering it
  // does not, because a change list is not a file.
  const metadata = (args: string[]) =>
    git(
      cwd,
      args,
      Math.max(METADATA_OUTPUT_BYTES, maxFileBytes),
      (limit) =>
        `This pull request's change list is larger than ${limit} bytes, which is more than the Action can read. Nothing was truncated. Scope the rule with paths, or split the change.`,
    );
  // Per-file mode is not a way out of the patch limit: it runs the same
  // per-file command and records the same error for the same file.
  const patch = (args: string[]) =>
    git(
      cwd,
      args,
      maxFileBytes,
      (limit) =>
        `One file's diff is larger than the ${limit}-byte max-file-bytes budget. Nothing was truncated. Raise max-file-bytes, exclude that file with paths, or split the change.`,
    );
  if (mode === 'pr-body') {
    if (!pr.body.trim())
      throw new ActionError('The PR body is empty. Add a description before running this check.');
    return [{ name: 'PR body', content: pr.body }];
  }
  const shallow = (await metadata(['rev-parse', '--is-shallow-repository'])).trim();
  if (shallow !== 'false')
    throw new ActionError('A full-history checkout is required. Set fetch-depth: 0.');
  const mergeBase = (await metadata(['merge-base', pr.base, pr.head])).trim();
  if (!/^[a-f0-9]{40}$/.test(mergeBase))
    throw new ActionError('Cannot determine the PR merge base.');
  const raw = await metadata(['diff', ...flags, '--raw', '-z', mergeBase, pr.head, '--', ...paths]);
  const fields = raw.split('\0');
  if (fields.pop() !== '') throw new ActionError('Invalid Git change list.');
  if (fields.length === 0) {
    // A filter that matches nothing means the rule does not apply to this PR,
    // which is an ordinary outcome. A PR with no changes at all is not, and a
    // filter must not disguise one as the other, so ask again without it.
    if (paths.length > 0) {
      const unfiltered = await metadata([
        'diff',
        ...flags,
        '--raw',
        '-z',
        mergeBase,
        pr.head,
        '--',
      ]);
      if (unfiltered !== '') return [];
    }
    throw new ActionError('The PR has no changed files to evaluate.');
  }
  if (fields.length % 2 !== 0 || fields.length / 2 > maxFiles) {
    throw new ActionError(
      `The PR exceeds the ${maxFiles}-file max-files budget, or Git returned an invalid change list. Raise max-files, scope the rule with paths, or split the PR; nothing was truncated.`,
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
      const stat = await metadata([
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
      const filePatch = await patch([
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
      if (filePatch.includes('\0')) throw new ActionError('Non-text content cannot be evaluated.');
      if (/^[ +\-]version https:\/\/git-lfs.github.com\/spec\/v1\r?$/m.test(filePatch)) {
        throw new ActionError('Git LFS pointers do not contain the changed file contents.');
      }
      if (!filePatch.trim())
        throw new ActionError('Git did not return a patch for this changed file.');
      subjects.push({ name, content: filePatch });
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
