import { apiGet } from '../api.js';
import { h, replaceChildren, svg } from './dom.js';
import { SOURCES } from './sources.js';

/** Floating info cards (click results, climate vs normal), the About dialog, and toasts. */
export function mountCards({ cardsRoot, toastsRoot, i18n, controller }) {
  const t = (k, p) => i18n.t(k, p);
  let active = null; // { render(): void } re-run on language change
  let reqSeq = 0;

  function close() { active = null; replaceChildren(cardsRoot); }

  function shell(titleText, ...content) {
    return h('div', { class: 'card', role: 'dialog', 'aria-label': titleText },
      h('div', { class: 'card-head' }, h('h2', {}, titleText), h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('card.close'), onclick: close }, '×')),
      ...content);
  }

  function show(render) { active = { render }; replaceChildren(cardsRoot, render()); }

  // ───── climate vs normal ─────
  function describeTemp(a) {
    if (Math.abs(a) < 0.2) return t('card.climate.normal_temp');
    return a > 0 ? t('card.climate.warmer', { value: i18n.number(Math.abs(a), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })
      : t('card.climate.cooler', { value: i18n.number(Math.abs(a), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) });
  }
  function describeRain(p) {
    if (p === null) return t('card.climate.dry_season');
    if (Math.abs(p) < 10) return t('card.climate.normal_rain');
    const v = `${i18n.number(Math.abs(p), { maximumFractionDigits: 0 })}%`;
    return p > 0 ? t('card.climate.wetter', { value: v }) : t('card.climate.drier', { value: v });
  }

  /** Diverging bar chart: warm (orange) above zero, cool (blue) below. Colour is never the only cue (sign + labels). */
  function chart(series) {
    const W = 300; const H = 90; const mid = H / 2; const bw = W / series.length;
    const max = Math.max(1, ...series.map((r) => Math.abs(r.tempAnomalyC)));
    const bars = series.map((r, i) => {
      const hgt = (Math.abs(r.tempAnomalyC) / max) * (mid - 6);
      const up = r.tempAnomalyC >= 0;
      return svg('rect', { x: i * bw + 2, y: up ? mid - hgt : mid, width: bw - 4, height: Math.max(1, hgt), rx: 2, fill: up ? '#f08a3c' : '#4f9bd6' },
        svg('title', {}, `${i18n.month(r.month)}: ${i18n.signed(r.tempAnomalyC)} °C`));
    });
    const labels = [0, series.length - 1].map((i) => svg('text', { x: i === 0 ? 2 : W - 2, y: H - 2, 'text-anchor': i === 0 ? 'start' : 'end', class: 'chart-label' }, i18n.month(series[i].month)));
    return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': t('card.climate.chart') },
      svg('line', { x1: 0, x2: W, y1: mid, y2: mid, stroke: 'currentColor', 'stroke-opacity': 0.4 }), ...bars, ...labels);
  }

  async function openClimate({ lat, lon, label }) {
    const seq = ++reqSeq;
    let state = { kind: 'loading' };
    const where = controller.describePlace(lat, lon);
    const heading = () => label || (where ? t('card.place.near', { place: where.place, country: where.country, km: where.km }) : t('card.place.coords', { lat: i18n.number(lat, { maximumFractionDigits: 2 }), lon: i18n.number(lon, { maximumFractionDigits: 2 }) }));
    const render = () => {
      let body;
      if (state.kind === 'loading') body = h('p', { class: 'meta' }, t('card.climate.loading'));
      else if (state.kind === 'error') body = h('p', { class: 'meta error' }, t('card.climate.error'));
      else {
        const l = state.data.latest;
        body = [
          h('p', { class: 'card-sub' }, `${t('card.climate.title')} · ${i18n.month(l.month)}`),
          h('dl', { class: 'facts' },
            h('dt', {}, t('card.climate.temp')), h('dd', {}, `${describeTemp(l.tempAnomalyC)} (${i18n.number(l.tempC, { maximumFractionDigits: 1 })} °C)`),
            h('dt', {}, t('card.climate.rain')), h('dd', {}, describeRain(l.precipAnomalyPct))),
          chart(state.data.series),
          h('p', { class: 'meta' }, t('card.climate.baseline', { baseline: state.data.baseline })),
          h('p', { class: 'meta' }, t('card.climate.source', { source: state.data.source })),
        ];
      }
      return shell(heading(), body);
    };
    show(render);
    try {
      const data = await apiGet(`/api/climate/summary?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`);
      if (seq !== reqSeq) return;
      state = data.latest ? { kind: 'ok', data } : { kind: 'error' };
    } catch { if (seq !== reqSeq) return; state = { kind: 'error' }; }
    show(render);
  }

  // ───── picked point features ─────
  function openFacility({ facility: f, year }) {
    show(() => shell(f.name,
      h('p', { class: 'card-sub' }, `${t(`sector.${f.sector}`)}${f.subsector ? ` · ${f.subsector}` : ''}`),
      h('p', { class: 'big' }, t('emissions.facility', { value: i18n.number(f.co2e / 1e6, { maximumFractionDigits: 2 }), year })),
      f.owners.length ? h('p', { class: 'meta' }, t('emissions.owners', { owners: f.owners.join(', ') })) : null,
      h('p', { class: 'meta note' }, t('emissions.estimate')),
      h('p', { class: 'meta' }, t('card.climate.source', { source: 'Climate TRACE (CC BY 4.0)' }))));
  }
  function openStation({ station: s }) {
    show(() => shell(s.name,
      h('p', { class: 'big', style: `color:${s.color}` }, t('airquality.pm25', { value: i18n.number(s.pm25, { maximumFractionDigits: 1 }) })),
      h('p', { class: 'card-sub' }, t(`airquality.${s.band}`)),
      s.time ? h('p', { class: 'meta' }, t('airquality.updated', { time: new Date(s.time).toLocaleString(i18n.getLanguage()) })) : null,
      h('p', { class: 'meta' }, t('card.climate.source', { source: 'OpenAQ' }))));
  }
  function openPoint(lat, lon) {
    const where = controller.describePlace(lat, lon);
    show(() => shell(where ? t('card.place.near', { place: where.place, country: where.country, km: where.km }) : t('card.place.coords', { lat: i18n.number(lat, { maximumFractionDigits: 2 }), lon: i18n.number(lon, { maximumFractionDigits: 2 }) }),
      h('button', { type: 'button', class: 'btn primary', onclick: () => openClimate({ lat, lon, label: where ? where.place : '' }) }, t('card.climate.button'))));
  }

  // ───── About dialog (native <dialog>: focus trap + Esc handled by the browser) ─────
  function openAbout() {
    const dlg = h('dialog', { class: 'about', 'aria-labelledby': 'about-title' });
    const draft = i18n.info()?.status !== 'reviewed';
    dlg.append(
      h('div', { class: 'about-body' },
        h('h2', { id: 'about-title' }, t('about.title')),
        h('p', {}, t('about.body')),
        draft ? h('p', { class: 'meta note' }, t('about.translation')) : null,
        h('h3', {}, t('about.sources')),
        h('ul', { class: 'sources' }, SOURCES.map((s) => h('li', {},
          h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.name), ` — ${s.what}. `, h('span', { class: 'meta' }, s.license)))),
        h('button', { type: 'button', class: 'btn primary', onclick: () => dlg.close() }, t('about.close'))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // ───── toasts ─────
  function toast(message, { ms = 5000 } = {}) {
    const el = h('div', { class: 'toast' }, message);
    toastsRoot.append(el);
    setTimeout(() => el.remove(), ms);
  }

  i18n.onChange(() => { if (active) replaceChildren(cardsRoot, active.render()); });

  return { openClimate, openFacility, openStation, openPoint, openAbout, toast, close };
}
