# Jev API research for if-ai

Checked 2026-09-18. Primary sources only in the findings below. No authenticated inference requests were made; examples are documented contracts, not successful live tests. No applicable AGENTS.md was found in the workspace or its ancestor directories.

## Product and integration

Jev is TypeSafe AI's model for evaluating typed questions against shared state. The three primitives are Choice, Score, and Noul. Questions share context but are evaluated independently. For an MVP, one atomic condition per action invocation fits the documented design. [Introduction](https://docs.typesafe.ai/introduction)

Get an API key from the [TypeSafe console](https://console.typesafe.ai/). The official quickstart points there for credentials; this research did not verify account approval, billing setup, or free credits. [Quickstart](https://docs.typesafe.ai/introduction/quickstart)

The direct HTTP contract is:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

```json
{
  "model": "jev-1.13.0",
  "state": "The pull request updates installation instructions in README.md.",
  "questions": {
    "condition": {
      "type": "noul",
      "instructions": "Does this change only documentation?"
    }
  }
}
```

An illustrative response shape:

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "condition": { "type": "noul", "noul": 0.92 }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

`state` accepts a string, object, or array. Answers use the same question keys; keys themselves do not influence inference. This is a dedicated evaluation API, not a chat-completions request. Documented errors include 401 (credentials), 422 (invalid request), 429 (rate limit), and 529 (overload). TypeSafe recommends exponential backoff for 429/529. [HTTP reference](https://docs.typesafe.ai/api)

## Critical boolean/confidence decision

Noul returns P(yes), a number from zero to one, **without a separate confidence field**. Near zero means a strong no; near one means a strong yes; near 0.5 means ambiguity. Optional `criteria` contains descriptions under `true` and `false`. Application code converts probability into a boolean. [Noul](https://docs.typesafe.ai/primitives/noul)

Choice and Score return native `confidence`, computed from their probability distributions. The confidence documentation does not specify the exact formula. It recommends tuning thresholds against the application and consequences of error. Probability and provider confidence must not be documented as interchangeable. [Confidence](https://docs.typesafe.ai/confidence)

Two viable MVP designs, requiring a product decision:

- **Noul:** natural yes/no primitive; expose `probability`, derive `result`, and explicitly define an application-level confidence if that output name is required. For example, `abs(2*p - 1)` measures distance from ambiguity, while `max(p, 1-p)` is the selected outcome's probability at a 0.5 decision threshold. Neither is an official Noul confidence field. With a different decision threshold, selected-outcome probability requires using the actual selected result.
- **Two-option Choice:** ask the condition with `true` and `false` option descriptions, map the returned string to a boolean, and expose native provider confidence. This follows the requested boolean-plus-confidence promise more literally, while using a different primitive.

These are design proposals, not claims that one gives better accuracy. Do not silently label P(true) as confidence: a strongly negative result would appear misleadingly uncertain.

## Model, pricing, and limits

Current stable model: `jev-1.13.0`; `jev-latest` and `jev-preview` both currently resolve to it. Pinning a version avoids silent behavior changes behind an alias. The response reports the answering model. Listed price is $0.042 per million input tokens, with free output tokens. Listed limits are 250,000 tokens/second and 1,200 requests/minute, explicitly subject to change. Context budgets are 64k total and 32k for state plus the longest question. Thus a single-question action should respect the latter constraint. Input is text only. TypeSafe says it does not train on customer requests or responses; enterprise ZDR is separate, so this does not establish zero retention for ordinary accounts. [Models](https://docs.typesafe.ai/models)

## TypeScript SDK and operational behavior

The official package is `@typesafe-ai/sdk`, requires Node 20+, and ships ESM, CommonJS, and TypeScript types. Calls use `TypeSafeClient.systemOne`; helpers infer answer types. [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)

Defaults: API key from `TYPESAFE_API_KEY`, base URL `https://api.typesafe.ai`, model `jev-latest`, 10-second timeout **per attempt**, with no overall retry budget. A custom fetch can support testing. Debug logs include request/response bodies even though credential headers are redacted; avoid debug body logging in CI. [Client configuration](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig)

The SDK retries twice after the first attempt, including network/timeouts and HTTP 408, 429, 500–599. Backoff starts at 500 ms, doubles up to 5 seconds, and includes jitter. It honors `Retry-After` and `retry-after-ms` up to 60 seconds by default. Setting `maxRetries: 0` disables retries. [Retry policy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy)

For the action, choose one retry layer and an explicit overall deadline. A tiny raw-fetch adapter is feasible; the SDK saves retry/error plumbing. Either needs response validation, sanitized error messages, and tests of malformed success responses and exhausted retries. These are implementation recommendations.

## Other official access paths

Vercel AI Gateway supports Jev through AI SDK 7's experimental evaluation API as `typesafe-ai/jev`. Its Boolean primitive returns a probability using gateway terminology. This is a separate contract from the direct Noul API. Supporting both would broaden MVP scope; start with one. [Vercel announcement](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway)

## Unresolved before implementation/launch

1. Which credential path does the maintainer actually have: direct TypeSafe or a gateway?
2. Should `confidence` mean native Choice confidence or a documented Noul-derived measure?
3. Is a low-confidence answer an output for workflow logic, a false gate, or an action failure?
4. Which context is explicitly supplied, and is PR diff collection necessary for the first release?
5. No live response, current account quota, latency measurement, or calibration has been verified. Add a maintainer-run smoke test before describing the integration as live-tested.

Search results included numerous independent Jev-branded sites. They were useful discovery leads but were not used as authority for this contract.
