import { describe, expect, it, vi } from 'vitest';
import { ActionError, readConfig, readPullRequest, type Config } from '../src/config.js';
import { checkSubjects } from '../src/check.js';
import { evaluate, parseDecision, requestBody } from '../src/jev.js';
import { summary } from '../src/report.js';

const baseConfig: Config = {
  condition: 'The change is documented.',
  minConfidence: 0.85,
  mode: 'diff',
  apiKey: 'secret-value',
  provider: 'typesafe',
  model: 'jev-1.13.0',
};
const response = (choice = 'true', confidence = 0.9) => ({
  answers: {
    condition: {
      type: 'choice',
      choice,
      confidence,
      probabilities: choice === 'true' ? { true: 0.95, false: 0.05 } : { true: 0.05, false: 0.95 },
    },
  },
});

describe('inputs', () => {
  const inputs: Record<string, string> = {
    condition: 'No breaking changes.',
    'min-confidence': '0.85',
    'api-key': 'key',
  };
  it('requires an explicit condition and confidence', () => {
    for (const missing of ['condition', 'min-confidence', 'api-key']) {
      expect(() => readConfig((n) => (n === missing ? '' : inputs[n] || ''))).toThrow(ActionError);
    }
    expect(readConfig((n) => inputs[n] || '')).toMatchObject({ minConfidence: 0.85, mode: 'diff' });
  });
  it.each(['NaN', 'Infinity', '-1', '1.1', '85', '0x1', ' '])(
    'rejects invalid confidence %s',
    (value) => {
      expect(() => readConfig((n) => (n === 'min-confidence' ? value : inputs[n] || ''))).toThrow(
        ActionError,
      );
    },
  );
  it('validates event SHAs before invoking Git', () => {
    expect(() => readPullRequest('push', {})).toThrow();
    expect(() =>
      readPullRequest('pull_request', { pull_request: { base: { sha: '--help' } } }),
    ).toThrow();
  });
  it('selects provider-specific defaults and preserves explicit model identifiers', () => {
    const read = (extra: Record<string, string>) =>
      readConfig((n) => ({ ...inputs, ...extra })[n] || '');
    expect(read({})).toMatchObject({ provider: 'openrouter', model: 'typesafe/jev-1.13' });
    expect(read({ provider: 'typesafe' })).toMatchObject({
      provider: 'typesafe',
      model: 'jev-1.13.0',
    });
    expect(read({ provider: 'openrouter' })).toMatchObject({
      provider: 'openrouter',
      model: 'typesafe/jev-1.13',
    });
    expect(read({ provider: 'openrouter', model: '~typesafe/jev-latest' }).model).toBe(
      '~typesafe/jev-latest',
    );
    expect(() => read({ provider: 'other' })).toThrow('provider must be');
    expect(() => read({ model: 'model\nInjected' })).toThrow('Invalid model');
  });
});

describe.each(['typesafe', 'openrouter'] as const)('Jev via %s', (provider) => {
  const config: Config = {
    ...baseConfig,
    provider,
    model: provider === 'openrouter' ? 'typesafe/jev-1.13' : baseConfig.model,
  };
  it('uses the documented Choice contract, not a made-up Noul confidence', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response()));
    expect(await evaluate(config, 'complete diff', fetcher)).toEqual({
      value: true,
      confidence: 0.9,
    });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      provider === 'openrouter'
        ? 'https://openrouter.ai/api/alpha/decisions'
        : 'https://api.typesafe.ai/v1/systemone',
    );
    expect(options?.redirect).toBe('error');
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer secret-value' });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: config.model,
      state: 'complete diff',
      questions: { condition: { type: 'choice' } },
    });
  });
  it('rejects oversized input rather than truncating it', () => {
    expect(() => requestBody(config, 'x'.repeat(28_000))).toThrow('Nothing was truncated');
  });
  it.each([
    null,
    {},
    { answers: { condition: { type: 'noul', noul: 0.9 } } },
    response('maybe'),
    response('true', 2),
  ])('rejects malformed decisions', (value) => {
    expect(() => parseDecision(value)).toThrow(ActionError);
  });
  it.each([401, 402, 403, 422, 429, 500, 529])('sanitizes HTTP %s errors', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('secret-value and private code', { status }));
    await expect(evaluate(config, 'private code', fetcher)).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('names the selected provider when credits are exhausted', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private billing details', { status: 402 }));
    await expect(evaluate(config, 'diff', fetcher)).rejects.toThrow(
      `Check your ${provider === 'openrouter' ? 'OpenRouter' : 'TypeSafe'} credits and spending limit.`,
    );
  });
  it('handles malformed JSON and network errors without leaking content', async () => {
    await expect(
      evaluate(
        config,
        'diff',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('private response')),
      ),
    ).rejects.toThrow('malformed JSON');
    await expect(
      evaluate(config, 'diff', vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-value'))),
    ).rejects.toThrow('Could not reach Jev');
  });
  it('aborts a stalled request at the deadline', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('private transport detail')),
          );
          controller.abort();
        });
      });
      await expect(evaluate(config, 'diff', fetcher)).rejects.toThrow('timed out after 30 seconds');
      expect(timeout).toHaveBeenCalledWith(30_000);
    } finally {
      timeout.mockRestore();
    }
  });
  it('bounds success response size', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(64_001)));
    await expect(evaluate(config, 'diff', fetcher)).rejects.toThrow('oversized response');
  });
  it('rejects inconsistent winning options and probability distributions', () => {
    const wrongWinner = response();
    wrongWinner.answers.condition.choice = 'false';
    expect(() => parseDecision(wrongWinner)).toThrow();
    const wrongSum = response();
    wrongSum.answers.condition.probabilities.false = 0.5;
    expect(() => parseDecision(wrongSum)).toThrow();
  });
});

describe('all-file gate', () => {
  it('passes at the exact threshold and uses the lowest confidence', async () => {
    const result = await checkSubjects(
      [
        { name: 'a', content: 'a' },
        { name: 'b', content: 'b' },
      ],
      0.85,
      async (content) => ({ value: true, confidence: content === 'a' ? 0.85 : 0.95 }),
    );
    expect(result).toMatchObject({ result: true, confidence: 0.85, status: 'passed' });
  });
  it('names every false, uncertain, and errored file while finishing other files', async () => {
    const result = await checkSubjects(
      ['good', 'false', 'uncertain', 'error'].map((name) => ({ name, content: name })),
      0.85,
      async (name) => {
        if (name === 'error') throw new ActionError('Unavailable.');
        return { value: name !== 'false', confidence: name === 'uncertain' ? 0.84 : 0.95 };
      },
    );
    expect(result).toMatchObject({ result: false, confidence: 0, status: 'error' });
    expect(result.subjects.map((r) => r.status)).toEqual([
      'passed',
      'condition-false',
      'low-confidence',
      'error',
    ]);
  });
  it('never passes empty input', async () => {
    expect(
      (await checkSubjects([], 0.85, async () => ({ value: true, confidence: 1 }))).result,
    ).toBe(false);
  });
  it('bounds concurrency and preserves input order', async () => {
    let active = 0;
    let peak = 0;
    const names = Array.from({ length: 12 }, (_, i) => String(i));
    const result = await checkSubjects(
      names.map((name) => ({ name, content: name })),
      0.85,
      async () => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { value: true, confidence: 1 };
      },
    );
    expect(peak).toBe(4);
    expect(result.subjects.map((r) => r.name)).toEqual(names);
  });
  it('escapes file names in the summary', async () => {
    const result = await checkSubjects(
      [{ name: '<script>alert(1)</script>', error: 'No patch.' }],
      0.9,
      async () => ({ value: true, confidence: 1 }),
    );
    expect(summary(result, 'per-file', 0.9)).toContain('&lt;script&gt;');
    expect(summary(result, 'per-file', 0.9)).not.toContain('<script>');
  });
});
