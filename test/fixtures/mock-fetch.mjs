// Test-only preload. The shipped Action never imports this file.
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  if (process.env.IF_AI_TEST_RESPONSE === 'error')
    return new Response('PRIVATE_SOURCE secret-value', { status: 401 });
  const confidence = process.env.IF_AI_TEST_RESPONSE === 'uncertain' ? 0.5 : 0.95;
  const choice = request.state.includes('FAIL_CONDITION') ? 'false' : 'true';
  return Response.json({
    answers: {
      condition: {
        type: 'choice',
        choice,
        confidence,
        probabilities:
          choice === 'true' ? { true: 0.99, false: 0.01 } : { true: 0.01, false: 0.99 },
      },
    },
  });
};
