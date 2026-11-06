import { resolveNlpProvider } from '../../config.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAiStyleProvider, createOperatorTransport } from './openaiStyle.js';

/**
 * Build the configured LLM provider, or null when running rule-parser only.
 * @param {ReturnType<import('../../config.js').loadConfig>} cfg
 * @param {{safeFetch: Function}} deps
 */
export function createProvider(cfg, { safeFetch }) {
  const { name, reason } = resolveNlpProvider(cfg);
  const n = cfg.nlp;
  if (name === 'anthropic') return { provider: createAnthropicProvider(cfg), name, reason };
  if (name === 'openai') {
    return {
      name, reason,
      provider: createOpenAiStyleProvider({
        name: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: n.openaiKey, model: n.openaiModel, tokenParam: 'max_completion_tokens',
        request: (url, init) => safeFetch(url, { method: init.method, headers: init.headers, body: init.body, timeoutMs: init.timeoutMs, maxBytes: 2_000_000 }),
      }),
    };
  }
  if (name === 'compatible') {
    return {
      name, reason,
      provider: createOpenAiStyleProvider({
        name: 'compatible', baseUrl: n.compatBaseUrl, apiKey: n.compatKey, model: n.compatModel, tokenParam: 'max_tokens',
        request: createOperatorTransport(n.compatBaseUrl),
      }),
    };
  }
  return { provider: null, name: 'offline', reason };
}
