import { LANGUAGES } from '../../shared/languages.js';
import { h, replaceChildren } from './dom.js';

/** Brand, language picker, About button. */
export function mountTopbar({ root, i18n, onLanguage, onAbout }) {
  const t = (k, p) => i18n.t(k, p);

  function render() {
    const current = i18n.getLanguage();
    const select = h('select', { id: 'lang-select', 'aria-label': t('panel.language'), onchange: (e) => onLanguage(e.target.value) },
      LANGUAGES.map((l) => h('option', { value: l.code, lang: l.code, selected: l.code === current },
        l.status === 'reviewed' ? l.name : `${l.name} · ${t('lang.draft')}`)));
    const info = i18n.info();
    replaceChildren(root,
      h('div', { class: 'brand' },
        h('img', { src: '/favicon.svg', alt: '', width: 22, height: 22 }),
        h('div', {}, h('div', { class: 'brand-name' }, t('app.name')), h('div', { class: 'brand-tag' }, t('app.tagline')))),
      h('div', { class: 'topbar-actions' },
        info?.status !== 'reviewed' ? h('span', { class: 'draft-badge', title: t('lang.draft.hint') }, t('lang.draft')) : null,
        select,
        h('button', { type: 'button', class: 'btn', onclick: onAbout }, t('panel.about'))));
  }
  render();
  i18n.onChange(render);
}
