// Claude via the official Anthropic SDK.
//
// Model-specific rules honoured here (claude-opus-5-5 and the 5.x family):
//  - `thinking` is NOT sent: thinking is always on (adaptive) and
//    `{type: "disabled"}` is a 400. Cost/latency is steered with output_config.effort.
//  - `tool_choice` stays `auto`: forced `any`/`tool` is a 400.
//  - Thinking blocks must be passed back unchanged on tool-result turns, so the
//    raw assistant content is carried in `message.raw` and replayed verbatim.
//  - A classifier decline arrives as HTTP 200 + stop_reason "refusal": surfaced
//    to the caller instead of being read as an empty answer.
//  - Server-side `fallbacks: "default"` (beta) re-runs a declined request on the
//    recommended model; skipped for models that don't support it.

import Anthropic from '@anthropic-ai/sdk';
import { NlpProviderError } from '../providerError.js';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const supportsFallbacks = (model) => /^claude-(opus-5|fable|sonnet-5-5)/.test(model);

/** internal messages → Anthropic MessageParam[] */
export function toAnthropicMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    if (m.role === 'assistant') {
      if (m.raw) return { role: 'assistant', content: m.raw };
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      return { role: 'assistant', content: blocks.length ? blocks : m.content };
    }
    // role 'tool': all results for the preceding assistant turn go in ONE user message
    return {
      role: 'user',
      content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
    };
  });
}

/** Anthropic response → provider-neutral result */
export function fromAnthropicResponse(res) {
  if (res.stop_reason === 'refusal') return { refused: true, text: '', toolCalls: [], raw: res.content, stopReason: 'refusal', usage: res.usage };
  let text = ''; const toolCalls = [];
  for (const block of res.content ?? []) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
  }
  return { refused: false, text: text.trim(), toolCalls, raw: res.content, stopReason: res.stop_reason, usage: res.usage };
}

function mapError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new NlpProviderError('auth', 'Claude API key rejected', err.status);
  if (err instanceof Anthropic.RateLimitError) return new NlpProviderError('rate_limited', 'Claude API rate limit', 429);
  if (err instanceof Anthropic.BadRequestError) return new NlpProviderError('bad_request', `Claude API rejected the request: ${err.message}`.slice(0, 300), 400);
  if (err instanceof Anthropic.APIConnectionError) return new NlpProviderError('network', 'could not reach the Claude API');
  if (err instanceof Anthropic.APIError) return new NlpProviderError('upstream', `Claude API error ${err.status ?? ''}`.trim(), err.status);
  return new NlpProviderError('unknown', 'unexpected provider error');
}

export function createAnthropicProvider(cfg, { client } = {}) {
  const n = cfg.nlp;
  const sdk = client ?? new Anthropic({ apiKey: n.anthropicKey, maxRetries: 1, timeout: 45_000 });
  const useFallbacks = n.anthropicFallbacks !== 'off' && supportsFallbacks(n.anthropicModel);

  return {
    name: 'anthropic',
    model: n.anthropicModel,
    multiTurn: true,
    /**
     * @param {{system: string, messages: object[], tools: object[], maxTokens: number, signal?: AbortSignal}} req
     */
    async complete({ system, messages, tools, maxTokens, signal }) {
      const params = {
        model: n.anthropicModel,
        max_tokens: maxTokens,
        // Stable prefix first (system, then tools), so prompt caching can apply.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        tool_choice: { type: 'auto' },
        messages: toAnthropicMessages(messages),
        ...(n.anthropicEffort && n.anthropicEffort !== 'off' ? { output_config: { effort: n.anthropicEffort } } : {}),
      };
      try {
        const res = useFallbacks
          ? await sdk.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal })
          : await sdk.messages.create(params, { signal });
        return fromAnthropicResponse(res);
      } catch (err) {
        throw mapError(err);
      }
    },
  };
}
