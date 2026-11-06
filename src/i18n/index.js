// Browser wiring: each locale is its own lazily-loaded chunk, so a user pays
// only for the languages they actually use (matters on metered mobile data).
import { createI18n } from './core.js';

const loaders = import.meta.glob('./locales/*.json', { import: 'default' });

export const i18n = createI18n({
  async load(code) {
    const loader = loaders[`./locales/${code}.json`];
    if (!loader) throw new Error(`no locale file for "${code}"`);
    return loader();
  },
  onWarn: (m) => { if (import.meta.env.DEV) console.warn('[i18n]', m); },
});

export const t = (...args) => i18n.t(...args);
