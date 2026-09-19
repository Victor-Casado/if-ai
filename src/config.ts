export type Mode = 'pr-body' | 'diff' | 'per-file';
export interface Config {
  condition: string;
  minConfidence: number;
  mode: Mode;
  apiKey: string;
  model: string;
}

// Only errors deliberately written by us may reach CI logs.
export class ActionError extends Error {}

export function readConfig(input: (name: string) => string): Config {
  const condition = input('condition').trim();
  if (!condition) throw new ActionError('condition is required.');
  if (Buffer.byteLength(condition) > 4000)
    throw new ActionError('condition exceeds 4,000 UTF-8 bytes.');
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
  const apiKey = input('api-key').trim();
  if (!apiKey)
    throw new ActionError(
      'api-key is required. Add TYPESAFE_API_KEY as an Actions secret. Fork PRs do not receive repository secrets.',
    );
  const model = input('model').trim() || 'jev-1.13.0';
  if (!/^[a-zA-Z0-9/._-]{1,100}$/.test(model)) throw new ActionError('Invalid model identifier.');
  return { condition, minConfidence: Number(threshold), mode, apiKey, model };
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
