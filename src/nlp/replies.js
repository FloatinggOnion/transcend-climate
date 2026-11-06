// Turns an NLP response into display text in the user's language.
//
// The server returns either free text from an LLM (`reply`, already in the
// user's language) or a message KEY + params from the rule parser. Keys are
// localized here, with the same i18n catalogs as the rest of the UI, so rule
// replies work in all eight languages without any server-side translation.

export function formatReply(res, { i18n, gazetteer }) {
  if (typeof res?.reply === 'string' && res.reply) return res.reply;
  const key = res?.replyKey;
  if (!key || !i18n.has(key)) return i18n.t('chat.error');
  const p = { ...(res.replyParams ?? {}) };
  const lang = i18n.getLanguage();

  if (Array.isArray(p.layers)) p.layers = i18n.list(p.layers.map((id) => i18n.t(`layer.${id}`)));
  if (typeof p.date === 'string') p.date = i18n.date(p.date);
  if (key === 'nlp.emissions' && typeof p.country === 'string') {
    const c = gazetteer.country(p.country);
    p.country = c?.names?.[lang] || c?.name || p.country;
  }
  if (key === 'nlp.climate_result') {
    const rain = p.precipAnomalyPct;
    Object.assign(p, {
      month: typeof p.month === 'string' ? i18n.month(p.month) : '',
      tempAnomaly: i18n.signed(p.tempAnomalyC, 1),
      temp: i18n.number(p.tempC, { maximumFractionDigits: 1 }),
      rainAnomaly: rain === null || rain === undefined ? '—' : `${i18n.signed(rain, 0)}%`,
    });
  }
  return i18n.t(key, p);
}

/** Notices worth surfacing next to a reply (e.g. the LLM is down and only basic commands work). */
export function noticeKey(res) {
  return { llm_unavailable: 'nlp.llm_unavailable', budget_exhausted: 'nlp.budget_exhausted' }[res?.notice] ?? null;
}
