// Framework-free i18n engine. `load(code)` returns a catalog object (the Vite
// entry wires import.meta.glob; tests wire fs), so this file runs anywhere.
//
// - Lookup order: active language → English → the key itself (so a missing
//   translation degrades to readable English, never to a blank).
// - {placeholders} are interpolated; values are inserted as TEXT. Callers must
//   render results with textContent, never innerHTML.
// - Numbers/dates use Intl with Latin digits so scientific values read the
//   same in every language (Arabic locales otherwise default to Arabic-Indic digits).

import { DEFAULT_LANGUAGE, LANGUAGES, getLanguage } from '../../shared/languages.js';

const PLACEHOLDER = /\{(\w+)\}/g;

export function createI18n({ load, onWarn = () => {} }) {
  /** @type {Map<string, Record<string,string>>} */
  const catalogs = new Map();
  const listeners = new Set();
  let lang = DEFAULT_LANGUAGE;
  let nf = new Intl.NumberFormat(DEFAULT_LANGUAGE, { numberingSystem: 'latn' });

  async function ensure(code) {
    if (catalogs.has(code)) return catalogs.get(code);
    const cat = await load(code);
    catalogs.set(code, cat);
    return cat;
  }

  const lookup = (key) => catalogs.get(lang)?.[key] ?? catalogs.get(DEFAULT_LANGUAGE)?.[key] ?? null;

  function t(key, params = {}) {
    const raw = lookup(key);
    if (raw === null) { onWarn(`missing i18n key: ${key}`); return key; }
    return raw.replace(PLACEHOLDER, (m, name) => (name in params && params[name] !== undefined && params[name] !== null ? String(params[name]) : m));
  }

  async function setLanguage(code) {
    const target = getLanguage(code) ? code : DEFAULT_LANGUAGE;
    await ensure(DEFAULT_LANGUAGE);
    await ensure(target);
    lang = target;
    nf = safeNumberFormat(target);
    for (const fn of listeners) fn(lang);
    return lang;
  }

  return {
    t, setLanguage,
    getLanguage: () => lang,
    info: () => getLanguage(lang),
    languages: () => LANGUAGES,
    has: (key) => lookup(key) !== null,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Localized number, Latin digits. */
    number(n, opts) { return opts ? new Intl.NumberFormat(lang, { numberingSystem: 'latn', ...opts }).format(n) : nf.format(n); },
    signed(n, digits = 1) { return new Intl.NumberFormat(lang, { numberingSystem: 'latn', signDisplay: 'exceptZero', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n); },
    /** "September 2026" style month label from "YYYY-MM". */
    month(ym) {
      const [y, m] = ym.split('-').map(Number);
      return safeDateFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
    },
    /** Localized date from "YYYY-MM-DD". */
    date(iso) {
      return safeDateFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
    },
    list(items) {
      try { return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items); } catch { return items.join(', '); }
    },
    /** Test/diagnostic access to a loaded catalog. */
    _catalog: (code) => catalogs.get(code),
  };
}

function safeNumberFormat(code) {
  try { return new Intl.NumberFormat(code, { numberingSystem: 'latn' }); } catch { return new Intl.NumberFormat('en', { numberingSystem: 'latn' }); }
}
function safeDateFormat(code, opts) {
  try { return new Intl.DateTimeFormat(code, { numberingSystem: 'latn', ...opts }); } catch { return new Intl.DateTimeFormat('en', { numberingSystem: 'latn', ...opts }); }
}

/** Placeholder names used in a template string, for parity checks. */
export function placeholdersOf(s) { return [...String(s).matchAll(PLACEHOLDER)].map((m) => m[1]).sort(); }
