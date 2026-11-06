// Supported interface languages. `status: 'draft'` means the translation was
// machine-drafted and has NOT been reviewed by a native speaker; the UI says so.
// Promote a language to 'reviewed' only after a native speaker signs it off.

export const LANGUAGES = Object.freeze([
  { code: 'en', name: 'English', dir: 'ltr', status: 'reviewed' },
  { code: 'fr', name: 'Français', dir: 'ltr', status: 'draft' },
  { code: 'ha', name: 'Hausa', dir: 'ltr', status: 'draft' },
  { code: 'yo', name: 'Yorùbá', dir: 'ltr', status: 'draft' },
  { code: 'ig', name: 'Igbo', dir: 'ltr', status: 'draft' },
  { code: 'sw', name: 'Kiswahili', dir: 'ltr', status: 'draft' },
  { code: 'ar', name: 'العربية', dir: 'rtl', status: 'draft' },
  { code: 'pt', name: 'Português', dir: 'ltr', status: 'draft' },
]);

export const LANGUAGE_CODES = Object.freeze(LANGUAGES.map((l) => l.code));
export const DEFAULT_LANGUAGE = 'en';

export function getLanguage(code) { return LANGUAGES.find((l) => l.code === code) || null; }

/** Pick the best supported language for a browser's preference list (e.g. navigator.languages). */
export function pickLanguage(preferred = []) {
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (LANGUAGE_CODES.includes(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}
