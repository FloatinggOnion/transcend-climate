import { EMISSION_SECTORS, GROUPS, LAYERS, PM25_BANDS, SECTOR_COLORS } from '../../shared/catalog.js';
import { REGIONS } from '../app.js';
import { h, replaceChildren } from './dom.js';

const MAP_CHOICES = [
  { id: 'blue-marble', key: 'map.bluemarble' },
  { id: 'true-color', key: 'map.truecolor' },
  { id: 'bing-aerial', key: 'map.bing', needs: 'cesiumIon' },
  { id: 'photoreal', key: 'map.photoreal', needs: 'googleMaps' },
];

/** Left panel: go-to regions, map options, and the layer list. */
export function mountPanel({ root, store, layers, controller, i18n, config }) {
  const t = (k, p) => i18n.t(k, p);
  const rows = new Map();
  let body;

  function legendFor(spec) {
    if (spec.id === 'forestloss') return h('p', { class: 'swatch-row' }, h('span', { class: 'swatch', style: 'background:#ff0000' }), t('layer.forestloss.desc'));
    if (spec.id === 'emissions') {
      return h('ul', { class: 'swatch-list' }, ['power', 'fossil-fuel-operations', 'manufacturing', 'mineral-extraction', 'waste'].map((s) =>
        h('li', {}, h('span', { class: 'swatch', style: `background:${SECTOR_COLORS[s]}` }), t(`sector.${s}`))));
    }
    if (spec.id === 'airquality') {
      return h('ul', { class: 'swatch-list' }, PM25_BANDS.map((b) => h('li', {}, h('span', { class: 'swatch', style: `background:${b.color}` }), t(`airquality.${b.id}`))));
    }
    const url = layers.legendUrl(spec.id);
    return url ? h('img', { class: 'legend-img', src: url, alt: t('layer.legend', { layer: t(`layer.${spec.id}`) }), loading: 'lazy', referrerpolicy: 'no-referrer' }) : null;
  }

  function countryOptions(current) {
    const lang = i18n.getLanguage();
    const list = controller.gazetteer.countries().filter((c) => c.continent === 'Africa')
      .map((c) => ({ iso: c.iso3, label: c.names?.[lang] || c.name }))
      .sort((a, b) => a.label.localeCompare(b.label, lang));
    return list.map((c) => h('option', { value: c.iso, selected: c.iso === current }, c.label));
  }

  function buildRow(spec) {
    const id = spec.id;
    const inputId = `layer-${id}`;
    const toggle = h('input', {
      type: 'checkbox', role: 'switch', id: inputId, 'aria-describedby': `${inputId}-desc`,
      onchange: (e) => {
        const on = e.target.checked; const cur = store.get().layers;
        store.set({ layers: on ? [...cur, id] : cur.filter((x) => x !== id) });
      },
    });
    const chip = h('span', { class: 'chip', id: `${inputId}-chip` });
    const detail = h('div', { class: 'layer-detail', hidden: true });
    const li = h('li', { class: 'layer', 'data-layer': id },
      h('div', { class: 'layer-head' },
        h('label', { class: 'layer-label', for: inputId }, h('span', { class: 'icon', 'aria-hidden': 'true' }, spec.icon), h('span', { class: 'layer-name' }, t(`layer.${id}`))),
        chip, toggle),
      h('p', { class: 'layer-desc', id: `${inputId}-desc` }, t(`layer.${id}.desc`)),
      detail);
    rows.set(id, { spec, li, toggle, chip, detail, key: null });
    return li;
  }

  /** Rebuild just the detail area when something it shows has changed. */
  function updateRow(row, state) {
    const { spec, li, toggle, chip, detail } = row;
    const on = state.layers.includes(spec.id);
    const status = layers.status(spec.id);
    toggle.checked = on;
    li.classList.toggle('on', on);
    chip.textContent = on ? t(`status.${status.state}`) : '';
    chip.className = `chip chip-${on ? status.state : 'off'}`;
    chip.hidden = !on;
    if (on && status.state === 'needs_key') chip.title = t('status.needs_key.hint');
    detail.hidden = !on;
    if (!on) { row.key = null; replaceChildren(detail); return; }

    // Rebuild the detail block only when its inputs change (so a dragged slider keeps focus).
    const info = status.info ?? {};
    // Opacity is deliberately NOT part of the key: rebuilding mid-drag would steal the slider's focus.
    const key = JSON.stringify([i18n.getLanguage(), status.state, info, layers.legendUrl(spec.id), state.emissions]);
    if (key === row.key) return;
    row.key = key;

    const parts = [];
    if (spec.kind !== 'points') {
      const value = Math.round((state.opacity[spec.id] ?? spec.opacity ?? 0.8) * 100);
      parts.push(h('label', { class: 'field inline' }, t('layer.opacity'),
        h('input', { type: 'range', min: 20, max: 100, value, 'aria-valuetext': `${value}%`, oninput: (e) => store.set({ opacity: { ...store.get().opacity, [spec.id]: Number(e.target.value) / 100 } }) })));
    }
    if (info.date) parts.push(h('p', { class: 'meta' }, info.clamped ? t('layer.latest_used', { date: i18n.date(info.date) }) : t('layer.showing', { date: i18n.date(info.date) })));
    if (spec.unit) parts.push(h('p', { class: 'meta' }, t('layer.unit', { unit: spec.unit })));
    if (spec.id === 'emissions') {
      parts.push(h('div', { class: 'field-row' },
        h('label', { class: 'field' }, t('emissions.country'),
          h('select', { onchange: (e) => store.set({ emissions: { ...store.get().emissions, country: e.target.value } }) }, countryOptions(state.emissions.country))),
        h('label', { class: 'field' }, t('emissions.sector'),
          h('select', { onchange: (e) => store.set({ emissions: { ...store.get().emissions, sector: e.target.value } }) },
            h('option', { value: 'all', selected: state.emissions.sector === 'all' }, t('emissions.all')),
            EMISSION_SECTORS.filter((s) => SECTOR_COLORS[s]).map((s) => h('option', { value: s, selected: state.emissions.sector === s }, t(`sector.${s}`)))))));
      if (info.count !== undefined && status.state !== 'loading') parts.push(h('p', { class: 'meta' }, t('emissions.total', { total: i18n.number(info.total / 1e6, { maximumFractionDigits: 1 }), count: info.count, year: info.year })));
      if (status.state === 'loading') parts.push(h('p', { class: 'meta' }, t('emissions.loading')));
      parts.push(h('p', { class: 'meta note' }, t('emissions.estimate')));
    }
    if (spec.id === 'airquality') {
      if (status.state === 'needs_key') parts.push(h('p', { class: 'meta note' }, t('status.needs_key.hint')));
      else if (info.count !== undefined) parts.push(h('p', { class: 'meta' }, t('layer.count', { count: info.count })));
    }
    parts.push(legendFor(spec));
    replaceChildren(detail, ...parts);
  }

  function updateAll(state = store.get()) {
    for (const row of rows.values()) updateRow(row, state);
    for (const [id, btn] of mapButtons) { const active = state.basemap === id; btn.setAttribute('aria-pressed', String(active)); btn.classList.toggle('active', active); }
    if (refToggle) refToggle.checked = state.reference;
    if (saverToggle) saverToggle.checked = state.dataSaver;
  }

  const mapButtons = new Map();
  let refToggle; let saverToggle;

  function build() {
    rows.clear(); mapButtons.clear();
    const regionButtons = REGIONS.map((r) => h('button', { type: 'button', class: 'chip-btn', onclick: () => controller.flyToRegion(r) }, t(`region.${r.id}`)));

    const mapChoices = MAP_CHOICES.filter((m) => !m.needs || config.features[m.needs]).map((m) => {
      const b = h('button', { type: 'button', class: 'seg', 'aria-pressed': 'false', onclick: () => store.set({ basemap: m.id }) }, t(m.key));
      mapButtons.set(m.id, b);
      return b;
    });
    refToggle = h('input', { type: 'checkbox', id: 'ref-toggle', onchange: (e) => store.set({ reference: e.target.checked }) });
    saverToggle = h('input', { type: 'checkbox', id: 'saver-toggle', 'aria-describedby': 'saver-hint', onchange: (e) => store.set({ dataSaver: e.target.checked }) });

    const groups = GROUPS.map((g) => {
      const specs = LAYERS.filter((l) => l.group === g);
      if (!specs.length) return null;
      return h('section', { class: 'group', 'aria-labelledby': `group-${g}` },
        h('h3', { id: `group-${g}` }, t(`group.${g}`)),
        h('ul', { class: 'layer-list' }, specs.map(buildRow)));
    });

    replaceChildren(body,
      h('section', { 'aria-labelledby': 'goto-h' }, h('h2', { id: 'goto-h' }, t('panel.goto')), h('div', { class: 'chip-grid' }, regionButtons)),
      h('section', { 'aria-labelledby': 'map-h' }, h('h2', { id: 'map-h' }, t('panel.map')),
        h('div', { class: 'seg-group', role: 'group', 'aria-label': t('panel.map') }, mapChoices),
        h('label', { class: 'check', for: 'ref-toggle' }, refToggle, t('map.borders')),
        h('label', { class: 'check', for: 'saver-toggle' }, saverToggle, t('panel.datasaver')),
        h('p', { class: 'meta', id: 'saver-hint' }, t('panel.datasaver.hint'))),
      h('section', { 'aria-labelledby': 'layers-h' }, h('h2', { id: 'layers-h' }, t('panel.layers')), groups));
    updateAll();
  }

  // Shell
  const collapse = h('button', {
    type: 'button', class: 'icon-btn', 'aria-expanded': 'true', 'aria-controls': 'panel-body',
    onclick: () => {
      const open = root.classList.toggle('collapsed') === false;
      collapse.setAttribute('aria-expanded', String(open));
      collapse.setAttribute('aria-label', t(open ? 'panel.hide' : 'panel.show'));
      collapse.textContent = open ? '‹' : '›';
    },
  }, '‹');
  body = h('div', { class: 'panel-body', id: 'panel-body' });
  replaceChildren(root, h('div', { class: 'panel-head' }, h('span', { class: 'panel-title' }, t('panel.layers')), collapse), body);
  const retitle = () => { root.querySelector('.panel-title').textContent = t('panel.layers'); collapse.setAttribute('aria-label', t(root.classList.contains('collapsed') ? 'panel.show' : 'panel.hide')); };
  retitle();

  build();
  // On phones start with the panel folded away so the globe is visible first.
  if (matchMedia('(max-width: 800px)').matches) collapse.click();
  store.subscribe((s) => updateAll(s));
  layers.onChange(() => updateAll());
  i18n.onChange(() => { build(); retitle(); });
}
