import { readJsonBody } from '../http.js';

// POST /api/nlp/chat  { messages: [{role, content}], context: {lang, date, layers, view, emissions} }
//   → { mode, provider, reply|null, replyKey|null, replyParams, actions[], notice|null }
export function registerNlpRoutes({ router, ctx }) {
  router.add('POST', '/api/nlp/chat', async ({ req }) => {
    const body = await readJsonBody(req, { maxBytes: 32 * 1024 });
    const result = await ctx.chat.handle(body);
    return { body: result, headers: { 'cache-control': 'no-store' } };
  }, { limiter: ctx.limiters.nlp });
}
