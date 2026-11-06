import { ApiError, apiPost } from '../api.js';
import { currentView } from '../engine/viewer.js';
import { formatReply, noticeKey } from '../nlp/replies.js';
import { createVoice, voiceSupported } from '../nlp/voice.js';
import { h, replaceChildren } from './dom.js';

/** Chat/command panel: type or speak a request; the server turns it into validated map actions. */
export function mountChat({ root, store, controller, i18n, viewer, config }) {
  const t = (k, p) => i18n.t(k, p);
  /** @type {Array<{role: 'user'|'assistant', text?: string, res?: object, error?: string}>} */
  const messages = [];
  let pending = false;
  let listening = false;
  let open = !matchMedia('(max-width: 800px)').matches;
  let input; let log; let micBtn;

  const render_text = (m) => (m.role === 'user' ? m.text : m.error ? t(m.error) : formatReply(m.res, { i18n, gazetteer: controller.gazetteer }));

  function context() {
    const s = store.get();
    const v = currentView(viewer);
    const country = controller.gazetteer.countryAt(v.lat, v.lon);
    return {
      lang: i18n.getLanguage(),
      date: s.date,
      layers: s.layers,
      view: { lat: v.lat, lon: v.lon, altKm: v.altKm, country: country?.iso3 ?? country?.country ?? null },
      emissions: s.layers.includes('emissions') ? s.emissions : null,
    };
  }

  async function send(text) {
    text = text.trim();
    if (!text || pending) return;
    messages.push({ role: 'user', text });
    pending = true; renderLog(); setBusy();
    // Short history (rendered text) so follow-ups like "now show it for last week" make sense.
    const history = messages.slice(-7, -1).filter((m) => m.role === 'user' || !m.error).map((m) => ({ role: m.role, content: render_text(m).slice(0, config.limits.nlpMaxChars) }));
    try {
      const res = await apiPost('/api/nlp/chat', { messages: [...history, { role: 'user', content: text }], context: context() }, { timeoutMs: 100_000 });
      messages.push({ role: 'assistant', res });
      await controller.applyActions(res.actions);
      const nk = noticeKey(res);
      if (nk && res.mode !== 'offline') messages.push({ role: 'assistant', res: { replyKey: nk } });
    } catch (err) {
      const key = err instanceof ApiError ? (err.status === 429 ? 'chat.rate_limited' : err.kind === 'network' || err.kind === 'timeout' ? 'error.network' : 'chat.error') : 'chat.error';
      messages.push({ role: 'assistant', error: key });
    } finally {
      pending = false; renderLog(); setBusy();
    }
  }

  function setBusy() {
    if (!input) return;
    input.disabled = pending;
    root.classList.toggle('busy', pending);
    if (!pending) input.focus({ preventScroll: true });
  }

  function renderLog() {
    if (!log) return;
    const items = messages.map((m) => h('li', { class: `msg ${m.role}` }, h('span', { class: 'who' }, m.role === 'user' ? t('chat.you') : t('chat.assistant')), h('span', { class: 'text' }, render_text(m))));
    if (pending) items.push(h('li', { class: 'msg assistant pending' }, h('span', { class: 'who' }, t('chat.assistant')), h('span', { class: 'text' }, t('chat.thinking'))));
    if (!messages.length) {
      items.push(h('li', { class: 'examples' }, [1, 2, 3, 4].map((n) => h('button', { type: 'button', class: 'chip-btn', onclick: () => send(t(`chat.example.${n}`)) }, t(`chat.example.${n}`)))));
    }
    replaceChildren(log, ...items);
    log.scrollTop = log.scrollHeight;
  }

  const voice = createVoice({
    getLang: () => i18n.getLanguage(),
    onText: (text) => { input.value = text; send(text); input.value = ''; },
    onState: (s) => { listening = s === 'listening'; paintMic(); },
    onError: (kind) => { messages.push({ role: 'assistant', error: kind === 'denied' ? 'chat.mic.denied' : 'chat.mic.error' }); renderLog(); },
  });

  function paintMic() {
    if (!micBtn) return;
    micBtn.setAttribute('aria-pressed', String(listening));
    micBtn.classList.toggle('listening', listening);
    const label = !voiceSupported() ? t('chat.mic.unsupported') : listening ? t('chat.mic.stop') : t('chat.mic.start');
    micBtn.setAttribute('aria-label', label);
    micBtn.title = voiceSupported() ? `${label}. ${t('chat.mic.privacy')}` : label;
  }

  function build() {
    input = h('input', {
      type: 'text', id: 'chat-input', autocomplete: 'off', enterkeyhint: 'send', maxlength: config.limits.nlpMaxChars,
      placeholder: t('chat.placeholder'), 'aria-label': t('chat.title'),
    });
    micBtn = h('button', {
      type: 'button', class: 'btn icon mic', disabled: !voiceSupported(),
      onclick: () => (listening ? voice.stop() : voice.start()),
    }, '🎙');
    log = h('ol', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    const form = h('form', { class: 'chat-form', onsubmit: (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(v); } },
      input, micBtn, h('button', { type: 'submit', class: 'btn primary' }, t('chat.send')));
    const toggle = h('button', { type: 'button', class: 'chat-toggle btn', 'aria-expanded': String(open), 'aria-controls': 'chat-body', onclick: () => { open = !open; root.classList.toggle('collapsed', !open); toggle.setAttribute('aria-expanded', String(open)); } }, t('chat.show'));
    const mode = config.features.nlp.mode === 'offline' ? t('chat.mode.offline') : null;
    replaceChildren(root,
      toggle,
      h('div', { class: 'chat-body', id: 'chat-body' },
        h('div', { class: 'chat-head' }, h('h2', {}, t('chat.title')),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('chat.clear'), title: t('chat.clear'), onclick: () => { messages.length = 0; renderLog(); } }, '⟲')),
        mode ? h('p', { class: 'meta note' }, mode) : null,
        log, form,
        h('p', { class: 'meta' }, t('chat.mic.privacy'))));
    root.classList.toggle('collapsed', !open);
    paintMic(); renderLog();
  }

  build();
  i18n.onChange(build);
}
