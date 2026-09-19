import * as core from '@actions/core';
import { readFile } from 'node:fs/promises';
import { ActionError, readConfig, readPullRequest, safeError } from './config.js';
import { collectSubjects } from './git.js';
import { evaluate } from './jev.js';
import { checkSubjects } from './check.js';
import { summary } from './report.js';

async function main(): Promise<void> {
  // Initialize failure outputs before any work, including validation.
  core.setOutput('result', 'false');
  core.setOutput('confidence', '0');
  core.setOutput('status', 'error');
  core.setOutput('failed-files', '[]');
  core.setOutput('results', '[]');
  const key = core.getInput('api-key');
  if (key) core.setSecret(key);
  const config = readConfig(name => core.getInput(name));
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new ActionError('GITHUB_EVENT_PATH is missing. Run this action in a pull request workflow.');
  let payload: unknown;
  try { payload = JSON.parse(await readFile(eventPath, 'utf8')); }
  catch { throw new ActionError('Could not read the pull request event.'); }
  const pr = readPullRequest(process.env.GITHUB_EVENT_NAME, payload);
  const subjects = await collectSubjects(config.mode, pr, process.env.GITHUB_WORKSPACE || process.cwd());
  core.info(`Evaluating ${subjects.length} subject(s) with ${config.model}; mode=${config.mode}.`);
  const result = await checkSubjects(subjects, config.minConfidence, content => evaluate(config, content));
  core.setOutput('result', String(result.result));
  core.setOutput('confidence', String(result.confidence));
  core.setOutput('status', result.status);
  core.setOutput('failed-files', JSON.stringify(config.mode === 'pr-body' ? [] : result.subjects
    .filter(s => s.status !== 'passed' && s.name !== 'Entire PR diff').map(s => s.name)));
  core.setOutput('results', JSON.stringify(result.subjects));
  if (process.env.GITHUB_STEP_SUMMARY) await core.summary.addRaw(summary(result, config.mode, config.minConfidence)).write();
  for (const subject of result.subjects.filter(s => s.status !== 'passed')) {
    // @actions/core escapes workflow command characters, including newlines in paths.
    core.error(`${subject.name}: ${subject.status}${subject.error ? '. ' + subject.error : ` (confidence ${subject.confidence}; required ${config.minConfidence}).`}`);
  }
  if (!result.result) core.setFailed('if-ai failed: every subject must satisfy the condition and minimum confidence. See the job summary.');
}

main().catch(error => {
  core.setOutput('result', 'false');
  core.setOutput('confidence', '0');
  core.setOutput('status', 'error');
  core.setFailed(safeError(error));
});
