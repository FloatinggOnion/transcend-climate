// OpenAI Chat Completions–style providers: OpenAI itself and any compatible
// endpoint (Ollama, vLLM, LM Studio, Together, Groq, …). Plain fetch — no SDK —
// to keep the dependency tree small.

import { NlpProviderError } from '../providerError.js';

const MAX_RESPONSE_BYTES = 2_000_000;

/** internal messages → Chat Completions messages */
export function toOpenAiMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) msg.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } }));
      out.push(msg);
    } else {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
  }
  return out;
}

export function fromOpenAiResponse(json) {
  const choice = json?.choices?.[0];
  const msg = choice?.message;
  if (!msg) throw new NlpProviderError('upstream', 'provider returned no choices');
  const toolCalls = (msg.tool_calls ?? []).filter((c) => c?.type === 'function' && c.function?.name).map((c, i) => {
    let input = {};
    try { input = JSON.parse(c.function.arguments || '{}'); } catch { input = { __invalid: true }; } // models sometimes emit broken JSON; validation will reject it
    return { id: c.id || `call_${i}`, name: c.function.name, input: input && typeof input === 'object' ? input : {} };
  });
  const refused = choice.finish_reason === 'content_filter' || (!!msg.refusal && !toolCalls.length);
  return { refused, text: String(msg.content ?? '').trim(), toolCalls, raw: null, stopReason: choice.finish_reason, usage: json.usage };
}

/**
 * @param {object} o
 * @param {'openai'|'compatible'} o.name
 * @param {string} o.baseUrl e.g. https://api.openai.com/v1
 * @param {string} o.apiKey
 * @param {string} o.model
 * @param {'max_completion_tokens'|'max_tokens'} o.tokenParam
 * @param {(url: string, init: object) => Promise<{status: number, ok: boolean, json: () => any}>} o.request transport
 */
export function createOpenAiStyleProvider({ name, baseUrl, apiKey, model, tokenParam, request }) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    name, model, multiTurn: true,
    async complete({ system, messages, tools, maxTokens }) {
      const body = {
        model,
        messages: toOpenAiMessages(system, messages),
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        tool_choice: 'auto',
        [tokenParam]: maxTokens,
      };
      let res;
      try {
        res = await request(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify(body),
          timeoutMs: 60_000,
        });
      } catch (err) {
        if (err instanceof NlpProviderError) throw err;
        throw new NlpProviderError(err?.code === 'timeout' ? 'timeout' : 'network', `could not reach the ${name} endpoint`);
      }
      if (res.status === 401 || res.status === 403) throw new NlpProviderError('auth', `${name} credentials rejected`, res.status);
      if (res.status === 429) throw new NlpProviderError('rate_limited', `${name} rate limit`, 429);
      if (!res.ok) throw new NlpProviderError(res.status === 400 ? 'bad_request' : 'upstream', `${name} returned HTTP ${res.status}`, res.status);
      return fromOpenAiResponse(res.json());
    },
  };
}

/**
 * Transport for an OPERATOR-configured endpoint (NLP_BASE_URL). Unlike
 * safeFetch it does not use the global host allow-list — the operator chose
 * this URL — but it is pinned to that one origin, never follows redirects, and
 * is time- and size-bounded.
 */
export function createOperatorTransport(baseUrl, { maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const origin = new URL(baseUrl).origin;
  return async function request(url, init) {
    const u = new URL(url);
    if (u.origin !== origin) throw new NlpProviderError('bad_request', 'request outside the configured NLP_BASE_URL origin');
    let res;
    try {
      res = await fetch(u, { method: init.method, headers: init.headers, body: init.body, redirect: 'error', signal: AbortSignal.timeout(init.timeoutMs ?? 60_000) });
    } catch (err) {
      const e = new Error('transport failure'); e.code = err?.name === 'TimeoutError' ? 'timeout' : 'network'; throw e;
    }
    const chunks = []; let total = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        total += chunk.byteLength;
        if (total > maxBytes) { const e = new Error('response too large'); e.code = 'network'; throw e; }
        chunks.push(chunk);
      }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return { status: res.status, ok: res.ok, json: () => { try { return JSON.parse(text); } catch { throw new NlpProviderError('upstream', 'provider returned invalid JSON'); } } };
  };
}
