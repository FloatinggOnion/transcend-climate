import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../config.js';
import { ALL_TOOLS } from '../../shared/actions.js';
import { createAnthropicProvider, toAnthropicMessages, fromAnthropicResponse } from './providers/anthropic.js';
import { createOpenAiStyleProvider, toOpenAiMessages, fromOpenAiResponse, createOperatorTransport } from './providers/openaiStyle.js';
import { createProvider } from './providers/index.js';
import { NlpProviderError } from './providerError.js';

const cfgFor = (env = {}) => loadConfig({ ANTHROPIC_API_KEY: 'k', ...env });
const req = { system: 'SYS', messages: [{ role: 'user', content: 'hi' }], tools: ALL_TOOLS, maxTokens: 2048 };

/** Fake SDK recording the exact request body for both the GA and beta surfaces. */
function fakeSdk(response, { throws } = {}) {
  const seen = [];
  const handler = (surface) => async (params, opts) => { seen.push({ surface, params, opts }); if (throws) throw throws; return response; };
  return { seen, messages: { create: handler('ga') }, beta: { messages: { create: handler('beta') } } };
}
const okResponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }], usage: { input_tokens: 1, output_tokens: 1 } };

test('Anthropic request shape for claude-opus-5-5', async () => {
  const sdk = fakeSdk(okResponse);
  const p = createAnthropicProvider(cfgFor(), { client: sdk });
  const res = await p.complete(req);
  assert.equal(res.text, 'Done.');
  const { surface, params } = sdk.seen[0];
  assert.equal(params.model, 'claude-opus-5-5', 'default model');
  assert.equal(surface, 'beta', 'fallbacks need the beta surface');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.ok(!('thinking' in params), 'thinking must not be sent: it cannot be disabled on Opus 5.5 and defaults to adaptive');
  assert.ok(!('temperature' in params) && !('top_p' in params) && !('top_k' in params), 'sampling params are removed on this model');
  assert.deepEqual(params.tool_choice, { type: 'auto' }, 'forced tool_choice is a 400 on Opus 5.5');
  assert.deepEqual(params.output_config, { effort: 'low' });
  assert.equal(params.max_tokens, 2048);
  assert.equal(params.system[0].cache_control.type, 'ephemeral');
  assert.equal(params.tools.length, ALL_TOOLS.length);
  assert.ok(params.tools.every((t) => t.name && t.description && t.input_schema.type === 'object'));
  assert.ok(!params.tools.some((t) => 'strict' in t), 'no strict flag: we validate server-side');
  assert.ok(!params.messages.some((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content === ''), 'no assistant prefill');
});

test('Anthropic: fallbacks only for models that support them; effort can be turned off', async () => {
  const haiku = fakeSdk(okResponse);
  await createAnthropicProvider(cfgFor({ ANTHROPIC_MODEL: 'claude-haiku-5-5' }), { client: haiku }).complete(req);
  assert.equal(haiku.seen[0].surface, 'ga');
  assert.ok(!('fallbacks' in haiku.seen[0].params) && !('betas' in haiku.seen[0].params), 'Haiku 5.5 has no server-side fallback');

  const off = fakeSdk(okResponse);
  await createAnthropicProvider(cfgFor({ ANTHROPIC_FALLBACKS: 'off', ANTHROPIC_EFFORT: 'off' }), { client: off }).complete(req);
  assert.equal(off.seen[0].surface, 'ga');
  assert.ok(!('output_config' in off.seen[0].params));

  const sonnet = fakeSdk(okResponse);
  await createAnthropicProvider(cfgFor({ ANTHROPIC_MODEL: 'claude-sonnet-5-5' }), { client: sonnet }).complete(req);
  assert.equal(sonnet.seen[0].params.fallbacks, 'default');
});

test('Anthropic: tool_use blocks → tool calls; raw content is preserved for faithful replay', () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text: 'On it. ' },
    { type: 'tool_use', id: 'tu_1', name: 'set_layers', input: { layers: ['lst'], mode: 'add' } },
    { type: 'tool_use', id: 'tu_2', name: 'fly_to', input: { place: 'Kano' } },
  ];
  const r = fromAnthropicResponse({ stop_reason: 'tool_use', content });
  assert.equal(r.text, 'On it.');
  assert.deepEqual(r.toolCalls.map((c) => c.id), ['tu_1', 'tu_2']);
  assert.strictEqual(r.raw, content);

  const msgs = toAnthropicMessages([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: r.text, toolCalls: r.toolCalls, raw: r.raw },
    { role: 'tool', results: [{ id: 'tu_1', content: 'done' }, { id: 'tu_2', content: 'Error: nope', isError: true }] },
  ]);
  assert.strictEqual(msgs[1].content, content, 'assistant turn is replayed verbatim, thinking block included');
  assert.equal(msgs[2].role, 'user');
  assert.deepEqual(msgs[2].content.map((b) => [b.type, b.tool_use_id, !!b.is_error]), [['tool_result', 'tu_1', false], ['tool_result', 'tu_2', true]], 'all results in ONE user message');
});

test('Anthropic: refusal stop_reason is surfaced, not read as an empty answer', async () => {
  const p = createAnthropicProvider(cfgFor(), { client: fakeSdk({ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'cyber' } }) });
  const r = await p.complete(req);
  assert.equal(r.refused, true);
  assert.deepEqual(r.toolCalls, []);
});

test('Anthropic: SDK errors map to coarse provider errors without leaking details', async () => {
  const cases = [[Anthropic.AuthenticationError, 'auth'], [Anthropic.RateLimitError, 'rate_limited'], [Anthropic.BadRequestError, 'bad_request'], [Anthropic.APIConnectionError, 'network'], [Anthropic.InternalServerError, 'upstream']];
  for (const [Klass, code] of cases) {
    const err = Object.assign(Object.create(Klass.prototype), { status: 500, message: 'sk-ant-SECRET detail' });
    const p = createAnthropicProvider(cfgFor(), { client: fakeSdk(null, { throws: err }) });
    await assert.rejects(p.complete(req), (e) => e instanceof NlpProviderError && e.code === code && (code === 'bad_request' || !e.message.includes('SECRET')));
  }
  const weird = createAnthropicProvider(cfgFor(), { client: fakeSdk(null, { throws: new Error('boom') }) });
  await assert.rejects(weird.complete(req), (e) => e.code === 'unknown' && !e.message.includes('boom'));
});

// ───────────── OpenAI-style ─────────────
test('OpenAI-style: message conversion, tool calls, and broken-JSON arguments', () => {
  const msgs = toOpenAiMessages('SYS', [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'fly_to', input: { place: 'Kano' } }] },
    { role: 'tool', results: [{ id: 'c1', content: 'done' }] },
  ]);
  assert.deepEqual(msgs.map((m) => m.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(msgs[2].tool_calls[0].function.arguments, '{"place":"Kano"}');
  assert.equal(msgs[3].tool_call_id, 'c1');

  const parsed = fromOpenAiResponse({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
    { id: 'a', type: 'function', function: { name: 'fly_to', arguments: '{"place":"Lagos"}' } },
    { id: 'b', type: 'function', function: { name: 'set_layers', arguments: '{oops' } },
  ] } }] });
  assert.deepEqual(parsed.toolCalls[0].input, { place: 'Lagos' });
  assert.equal(parsed.toolCalls[1].input.__invalid, true, 'unparseable arguments are flagged so validation rejects them');
  assert.equal(fromOpenAiResponse({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }).refused, true);
  assert.throws(() => fromOpenAiResponse({ choices: [] }), NlpProviderError);
});

test('OpenAI-style request: token parameter name, auth header, endpoint; status mapping', async () => {
  const seen = [];
  const mk = (status, tokenParam) => createOpenAiStyleProvider({
    name: 'openai', baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-test', model: 'm1', tokenParam,
    request: async (url, init) => { seen.push({ url, init }); return { status, ok: status < 300, json: () => ({ choices: [{ finish_reason: 'stop', message: { content: 'hello' } }] }) }; },
  });
  assert.equal((await mk(200, 'max_completion_tokens').complete(req)).text, 'hello');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(seen[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(seen[0].init.headers.authorization, 'Bearer sk-test');
  assert.equal(body.max_completion_tokens, 2048);
  assert.ok(!('max_tokens' in body));
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.tools[0].type, 'function');
  await mk(200, 'max_tokens').complete(req);
  assert.equal(JSON.parse(seen[1].init.body).max_tokens, 2048);
  for (const [status, code] of [[401, 'auth'], [429, 'rate_limited'], [400, 'bad_request'], [503, 'upstream']]) {
    await assert.rejects(mk(status, 'max_tokens').complete(req), (e) => e.code === code, String(status));
  }
});

test('operator transport is pinned to the configured origin and never follows redirects', async () => {
  const t = createOperatorTransport('http://localhost:11434/v1');
  await assert.rejects(t('http://evil.example/v1/chat/completions', { method: 'POST' }), (e) => e instanceof NlpProviderError);
  await assert.rejects(t('http://localhost:11434/other', { method: 'POST', timeoutMs: 200 }), (e) => ['network', 'timeout'].includes(e.code), 'unreachable endpoint surfaces as a transport error');
});

test('provider factory wires each backend; offline when nothing is configured', () => {
  const sf = async () => { throw new Error('unused'); };
  assert.equal(createProvider(loadConfig({}), { safeFetch: sf }).provider, null);
  assert.equal(createProvider(loadConfig({ ANTHROPIC_API_KEY: 'k' }), { safeFetch: sf }).provider.name, 'anthropic');
  assert.equal(createProvider(loadConfig({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm' }), { safeFetch: sf }).provider.name, 'openai');
  assert.equal(createProvider(loadConfig({ NLP_BASE_URL: 'http://localhost:11434/v1', NLP_MODEL: 'llama' }), { safeFetch: sf }).provider.name, 'compatible');
});
