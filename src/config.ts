export type Mode = 'pr-body' | 'diff' | 'per-file';
export type Provider = 'typesafe' | 'openrouter';
export interface Config {
  condition: string;
  minConfidence: number;
  mode: Mode;
  apiKey: string;
  provider: Provider;
  model: string;
  paths: string[];
  maxFiles: number;
  timeoutMs: number;
  retries: number;
  maxRequestBytes: number;
  maxFileBytes: number;
}

// Budgets this Action invented, so every one is yours to change. None of them
// describe a provider constraint: the provider decides what it can evaluate and
// says so, and that answer is reported rather than guessed at in advance.
export const DEFAULTS = {
  maxFiles: 200,
  timeoutSeconds: 30,
  retries: 1,
  maxRequestBytes: 2_000_000,
  maxFileBytes: 2_000_000,
} as const;

// Only errors deliberately written by us may reach CI logs.
export class ActionError extends Error {}

// AbortSignal.timeout collapses a delay above 2^31 ms to a 1 ms timer and
// throws above 2^32, so an unbounded timeout-seconds would time out instantly
// or crash. Cap it where the timer stays honest.
const MAX_TIMEOUT_SECONDS = 2_147_483;

function positiveInteger(
  raw: string,
  name: string,
  fallback: number,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const text = raw.trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) throw new ActionError(`${name} must be a whole number.`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new ActionError(`${name} must be ${minimum} or greater.`);
  if (value > maximum) throw new ActionError(`${name} must be ${maximum} or fewer.`);
  return value;
}

export function readConfig(input: (name: string) => string): Config {
  const condition = input('condition').trim();
  if (!condition) throw new ActionError('condition is required.');
  const threshold = input('min-confidence').trim();
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(threshold)) {
    throw new ActionError(
      'min-confidence is required and must be a number from 0 to 1, such as 0.85.',
    );
  }
  const mode = input('mode').trim() || 'diff';
  if (mode !== 'pr-body' && mode !== 'diff' && mode !== 'per-file') {
    throw new ActionError('mode must be pr-body, diff, or per-file.');
  }
  const provider = input('provider').trim() || 'openrouter';
  if (provider !== 'typesafe' && provider !== 'openrouter')
    throw new ActionError('provider must be typesafe or openrouter.');
  const apiKey = input('api-key').trim();
  if (!apiKey)
    throw new ActionError(
      'api-key is required. Supply an Actions secret for the selected provider. Fork PRs do not receive repository secrets.',
    );
  const model =
    input('model').trim() || (provider === 'openrouter' ? 'typesafe/jev-1.13' : 'jev-1.13.0');
  // Providers own their model naming, and the grammar moves: a fifth of
  // OpenRouter's catalog carries a `:free` or `:batch` suffix that an earlier
  // allowlist here rejected. Reject only what could harm the request itself,
  // and let the provider decide whether a name exists.
  if (!model || /[\s\u0000-\u001f\u007f]/.test(model))
    throw new ActionError('model must not be empty or contain whitespace or control characters.');
  // Git pathspecs, one per line. Passed after `--`, so a leading dash is a
  // pathspec and never an option.
  const paths = input('paths')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const timeoutSeconds = positiveInteger(
    input('timeout-seconds'),
    'timeout-seconds',
    DEFAULTS.timeoutSeconds,
    1,
    MAX_TIMEOUT_SECONDS,
  );
  return {
    condition,
    minConfidence: Number(threshold),
    mode,
    apiKey,
    provider,
    model,
    paths,
    maxFiles: positiveInteger(input('max-files'), 'max-files', DEFAULTS.maxFiles),
    timeoutMs: timeoutSeconds * 1_000,
    // Zero is meaningful here: it turns off the retry and its second paid call.
    retries: positiveInteger(input('retries'), 'retries', DEFAULTS.retries, 0),
    maxRequestBytes: positiveInteger(
      input('max-request-bytes'),
      'max-request-bytes',
      DEFAULTS.maxRequestBytes,
    ),
    maxFileBytes: positiveInteger(input('max-file-bytes'), 'max-file-bytes', DEFAULTS.maxFileBytes),
  };
}

export interface PullRequest {
  body: string;
  base: string;
  head: string;
}

export function readPullRequest(eventName: string | undefined, payload: unknown): PullRequest {
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
    throw new ActionError('if-ai requires a pull_request or pull_request_target event.');
  }
  const pr = record(record(payload)?.pull_request);
  const base = record(pr?.base)?.sha;
  const head = record(pr?.head)?.sha;
  if (
    typeof base !== 'string' ||
    typeof head !== 'string' ||
    !/^[a-f0-9]{40}$/.test(base) ||
    !/^[a-f0-9]{40}$/.test(head)
  ) {
    throw new ActionError('The event must contain exact PR base and head commit SHAs.');
  }
  if (pr?.body != null && typeof pr.body !== 'string')
    throw new ActionError('Invalid PR body in event.');
  return { base, head, body: typeof pr?.body === 'string' ? pr.body : '' };
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function safeError(error: unknown): string {
  return error instanceof ActionError
    ? error.message
    : 'Unexpected error. Check the Action configuration and runner; request contents are not logged.';
}
