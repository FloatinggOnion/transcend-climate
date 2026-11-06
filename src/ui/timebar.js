import { addDays, formatDate } from '../../shared/catalog.js';
import { h, replaceChildren } from './dom.js';

/** Bottom date control for time-dependent layers. `null` date means "newest available". */
export function mountTimebar({ root, store, layers, i18n }) {
  const t = (k, p) => i18n.t(k, p);
  const todayStr = () => formatDate(new Date());
  let dateInput;

  function bounds() {
    // Union of the ranges the server reports; falls back to the last decade if metadata is missing.
    let min = null; let max = null;
    for (const id of Object.keys(layers.meta)) {
      const r = layers.dateRange(id);
      if (r?.start && (!min || r.start < min)) min = r.start;
      if (r?.end && (!max || r.end > max)) max = r.end;
    }
    return { min: min ?? addDays(todayStr(), -3650), max: max ?? todayStr() };
  }

  function step(days) {
    const { min, max } = bounds();
    const base = store.get().date ?? max;
    const next = addDays(base, days);
    if (next < min || next > max) return;
    store.set({ date: next });
  }

  function render() {
    const { min, max } = bounds();
    const date = store.get().date;
    dateInput = h('input', {
      type: 'date', id: 'date-input', min, max, value: date ?? max,
      onchange: (e) => { if (e.target.value) store.set({ date: e.target.value }); },
    });
    replaceChildren(root,
      h('label', { for: 'date-input', class: 'timebar-label' }, t('time.date')),
      h('button', { type: 'button', class: 'btn icon', 'aria-label': t('time.prev'), title: t('time.prev'), onclick: () => step(-1) }, '‹'),
      dateInput,
      h('button', { type: 'button', class: 'btn icon', 'aria-label': t('time.next'), title: t('time.next'), onclick: () => step(1), disabled: (date ?? max) >= max }, '›'),
      h('button', { type: 'button', class: `btn ${date === null ? 'active' : ''}`, 'aria-pressed': String(date === null), onclick: () => store.set({ date: null }) }, t('time.latest')),
      h('p', { class: 'timebar-hint' }, t('time.hint')));
  }

  render();
  store.subscribe((s, p, changed) => { if (changed.includes('date')) render(); });
  layers.onChange((id) => { if (id === '*') render(); });
  i18n.onChange(render);
}
