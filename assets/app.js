import { key, findManufacturer, similarManufacturers } from './names.js';
import { GLOBAL, COUNTRY_CODES } from './countries.js';

// To add a language: create i18n/<code>.json (copy en.json) and list it here.
const LANGUAGES = { en: 'English', 'pt-BR': 'Português', es: 'Español' };
const SPOOL_MATERIALS = ['plastic', 'cardboard', 'metal'];

const $ = (id) => document.getElementById(id);
// Two pages share this script: the calculator (index.html) and the catalogue (spools.html).
const onCalculator = !!document.getElementById('pick');
const onCatalog = !!document.getElementById('list');
const params = new URLSearchParams(location.search);

const state = {
  lang: 'en',
  strings: {},
  fallback: {},
  makers: [],
  makerById: new Map(),
  spools: [],
  selected: null,
  favorites: new Set(),
};

// ---------- small helpers ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.filter((c) => c != null && c !== false));
  return el;
}

function t(id, vars = {}) {
  const text = state.strings[id] ?? state.fallback[id] ?? id;
  return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

const num = (n, digits = 0) => new Intl.NumberFormat(state.lang, { maximumFractionDigits: digits }).format(n);
// Non-breaking space: the unit never wraps away from its number.
const grams = (n) => `${num(n, 1)}\u00a0g`;
const size = (g) => (g >= 1000 ? `${num(g / 1000, 2)} kg` : `${num(g)} g`);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function repository() {
  const meta = document.querySelector('meta[name="github-repo"]')?.content.trim();
  if (meta) return meta;
  const owner = location.hostname.match(/^([\w-]+)\.github\.io$/)?.[1];
  if (!owner) return null;
  const first = location.pathname.split('/').filter(Boolean)[0];
  return first && !first.includes('.') ? `${owner}/${first}` : `${owner}/${owner}.github.io`;
}

/** Country name in the reader's language; "Global" for spools sold everywhere. */
function countryName(code) {
  if (code === GLOBAL) return t('country.global');
  try {
    return new Intl.DisplayNames([state.lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
const byName = (a, b) => countryName(a).localeCompare(countryName(b), state.lang);

const makerName = (spool) => state.makerById.get(spool.manufacturer)?.name ?? spool.manufacturer;
/** What the spool is, in the reader's language: "Cardboard spool, 1 kg · Transparent". Built from the data, never typed. */
function spoolTitle(spool) {
  const base = [t(`title.${spool.spool_material ?? 'unknown'}`), spool.filament_g && size(spool.filament_g)].filter(Boolean).join(', ');
  return spool.variant ? `${base} · ${spool.variant}` : base;
}
/** Manufacturer plus title, with the filaments seen on it when that is all that tells it apart. */
function fullTitle(spool) {
  const hint = !spool.variant && spool.filaments.length ? ` (${spool.filaments.join(', ')})` : '';
  return `${makerName(spool)} — ${spoolTitle(spool)}${hint}`;
}

// ---------- favorites (kept in this browser only) ----------

const STAR = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z';
const SHIELD = ['M12 2.8l7.5 2.7v5.6c0 4.6-3.1 8.2-7.5 10.1-4.4-1.9-7.5-5.5-7.5-10.1V5.5z', 'M8.6 11.9l2.5 2.5 4.4-4.9'];
const INFO = ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5.5', 'M12 7.6v.01'];

function icon(...paths) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function loadFavorites() {
  try {
    state.favorites = new Set(JSON.parse(store.get('favorites') ?? '[]'));
  } catch {
    state.favorites = new Set();
  }
}

/** Star toggle for a spool. Without a spool it is a disabled placeholder that says what to do first. */
function starButton(spool) {
  const on = !!spool && state.favorites.has(spool.id);
  const label = spool ? t(on ? 'fav.remove' : 'fav.add', { name: fullTitle(spool) }) : t('fav.none');
  return h('button', {
    class: 'icon-btn star', type: 'button', 'data-fav': spool?.id, 'aria-pressed': String(on), disabled: !spool,
    'aria-label': label, title: label,
    onclick: () => spool && toggleFavorite(spool),
  }, icon(STAR));
}

/** Green shield for a verified spool, or nothing. Unverified spools carry no mark at all. */
function verifiedBadge(spool) {
  if (!spool.verified) return null;
  return h('span', { class: 'verified-badge', role: 'img', 'aria-label': t('row.verified'), title: t('row.verified') }, icon(...SHIELD));
}

/** Opens the spool card. Without a spool it is a disabled placeholder, like the star. */
function infoButton(spool) {
  const label = spool ? t('info.open', { name: fullTitle(spool) }) : t('info.none');
  return h('button', {
    class: 'icon-btn info', type: 'button', disabled: !spool, 'aria-label': label, title: label,
    onclick: () => spool && showSpool(spool),
  }, icon(...INFO));
}

function toggleFavorite(spool) {
  state.favorites.has(spool.id) ? state.favorites.delete(spool.id) : state.favorites.add(spool.id);
  store.set('favorites', JSON.stringify([...state.favorites]));
  for (const old of document.querySelectorAll(`[data-fav="${CSS.escape(spool.id)}"]`)) old.replaceWith(starButton(spool));
  renderFavorites();
}

function renderFavorites() {
  if (!onCalculator) return;
  const favorites = state.spools.filter((s) => state.favorites.has(s.id));
  $('fav-empty').hidden = favorites.length > 0;
  $('fav-list').replaceChildren(
    ...favorites.map((s) =>
      h('li', {},
        h('button', { class: 'fav', type: 'button', 'aria-pressed': String(s === state.selected), onclick: () => { selectSpool(s); $('reading').focus(); } },
          h('span', {}, fullTitle(s), verifiedBadge(s)), h('span', { class: 'w' }, grams(s.weight_g))))),
  );
}

// ---------- language ----------

async function setLanguage(code) {
  state.lang = LANGUAGES[code] ? code : 'en';
  state.strings = state.lang === 'en' ? state.fallback : await fetch(`i18n/${state.lang}.json`).then((r) => r.json());
  store.set('lang', state.lang);
  document.documentElement.lang = state.lang;
  document.title = t(onCatalog ? 'page.title.catalog' : 'page.title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  buildSelects();
  if (onCalculator && state.selected) $('pick').value = fullTitle(state.selected);
  renderFavorites();
  renderScale();
  renderList();
}

function pickLanguage() {
  const wanted = [params.get('lang'), store.get('lang'), ...navigator.languages];
  for (const w of wanted.filter(Boolean)) {
    const match = Object.keys(LANGUAGES).find((c) => c === w || c.split('-')[0] === w.split('-')[0]);
    if (match) return match;
  }
  return 'en';
}

// ---------- calculator ----------

function selectSpool(spool, { focus = false } = {}) {
  if (!onCalculator) {
    location.href = `./?spool=${encodeURIComponent(spool.id)}`;
    return;
  }
  state.selected = spool;
  $('pick').value = spool ? fullTitle(spool) : '';
  closePicker();
  renderFavorites();
  renderScale();
  if (spool) pulse();
  for (const el of document.querySelectorAll('.spool')) el.classList.toggle('selected', el.dataset.id === spool?.id);
  syncUrl();
  if (focus) {
    document.querySelector('.hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('reading').focus({ preventScroll: true });
  }
}

/** One expanding ring on the gauge as selection feedback; never more than three at once. */
function pulse() {
  const wrap = $('gauge-wrap');
  if (wrap.querySelectorAll('.pulse').length >= 3) return;
  const ring = h('span', { class: 'pulse', onanimationend: () => ring.remove() });
  wrap.append(ring);
}

function syncUrl() {
  const p = new URLSearchParams(location.search);
  state.selected ? p.set('spool', state.selected.id) : p.delete('spool');
  $('reading').value ? p.set('w', $('reading').value) : p.delete('w');
  history.replaceState(null, '', p.size ? `?${p}` : location.pathname);
}

function setGauge(fraction) {
  // Filament mass grows with the area of the ring, so the radius follows a square root.
  const core = 30, full = 90;
  const f = Math.min(1, Math.max(0, fraction));
  $('gauge-filament').setAttribute('r', Math.sqrt(core ** 2 + f * (full ** 2 - core ** 2)).toFixed(1));
}

function renderScale() {
  if (!onCalculator) return;
  const spool = state.selected;
  const reading = Number($('reading').value);
  const main = $('scale-main');
  main.classList.remove('quiet');
  $('scale-sub').textContent = '';
  $('pick-fav').replaceChildren(infoButton(spool), starButton(spool));

  if (!spool) {
    $('scale-spool').textContent = '';
    main.textContent = t('calc.hint.pick');
    main.classList.add('quiet');
    return setGauge(0);
  }
  $('scale-spool').replaceChildren(`${fullTitle(spool)} — ${t('calc.emptyweight', { w: grams(spool.weight_g) })}`, verifiedBadge(spool) ?? '');
  if (!reading) {
    main.textContent = t('calc.hint.weigh');
    main.classList.add('quiet');
    return setGauge(0);
  }
  const left = reading - spool.weight_g;
  if (left <= 0) {
    main.textContent = t('calc.result.empty');
    main.classList.add('quiet');
    $('scale-sub').textContent = t('calc.result.empty.detail', { w: grams(spool.weight_g) });
    return setGauge(0);
  }
  main.textContent = t('calc.result.left', { g: grams(left) });
  const lines = [];
  if (spool.filament_g) lines.push(t('calc.result.percent', { p: num(Math.min(100, (left / spool.filament_g) * 100)), size: size(spool.filament_g) }));
  if (spool.weight_min_g) {
    lines.push(t('calc.result.range', { min: grams(Math.max(0, reading - spool.weight_max_g)), max: grams(reading - spool.weight_min_g) }));
  }
  $('scale-sub').textContent = lines.join(' · ');
  setGauge(spool.filament_g ? left / spool.filament_g : 0.5);
}

// ---------- spool picker (combobox) ----------

let pickerItems = [];
let pickerIndex = -1;

function search(query) {
  const tokens = query.split(/\s+/).map(key).filter(Boolean);
  return state.spools.filter((s) => tokens.every((tok) => s.haystack.includes(tok)));
}

/** Second line of a search result: what tells two look-alike spools apart and is not already in the title. */
function pickDetail(spool) {
  const d = spool.dimensions;
  return [
    spool.country !== GLOBAL && countryName(spool.country),
    spool.variant && spool.filaments.join(', '),
    spool.year,
    d?.outer_mm && `⌀ ${num(d.outer_mm, 1)}${d.width_mm ? ` × ${num(d.width_mm, 1)}` : ''} mm`,
  ].filter(Boolean).join(' · ');
}

function openPicker() {
  const q = $('pick').value.trim();
  const list = $('pick-list');
  pickerItems = q ? search(q).slice(0, 30) : [];
  pickerIndex = pickerItems.length ? 0 : -1;
  list.replaceChildren(
    ...(pickerItems.length
      ? pickerItems.map((s, i) =>
          h('li', { role: 'option', id: `pick-${i}`, 'aria-selected': String(i === 0), onmousedown: (e) => { e.preventDefault(); selectSpool(s); $('reading').focus(); } },
            // The slot stays when there is no photo, so the names line up.
            h('span', { class: 'pick-thumb' }, s.image && h('img', { src: s.image, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() })),
            h('span', { class: 'pick-text' }, h('span', {}, fullTitle(s) || makerName(s), verifiedBadge(s)), pickDetail(s) && h('small', {}, pickDetail(s))),
            h('span', { class: 'w' }, grams(s.weight_g))))
      : [h('li', { class: 'none' }, t('calc.spool.none', { q }))]),
  );
  list.hidden = !q;
  $('missing-add').href = q ? `spools.html?q=${encodeURIComponent(q)}#add` : 'spools.html#add';
  $('pick').setAttribute('aria-expanded', String(!!q));
}

function closePicker() {
  $('pick-list').hidden = true;
  $('pick').setAttribute('aria-expanded', 'false');
  $('pick').removeAttribute('aria-activedescendant');
}

function movePicker(delta) {
  if (!pickerItems.length) return;
  pickerIndex = (pickerIndex + delta + pickerItems.length) % pickerItems.length;
  [...$('pick-list').children].forEach((li, i) => li.setAttribute('aria-selected', String(i === pickerIndex)));
  $('pick').setAttribute('aria-activedescendant', `pick-${pickerIndex}`);
  $(`pick-${pickerIndex}`).scrollIntoView({ block: 'nearest' });
}

// ---------- catalogue ----------

function option(value, label) {
  return h('option', { value }, label);
}

function buildSelects() {
  if (!onCatalog) return;
  const keep = (id, options) => {
    const el = $(id);
    const current = el.value;
    el.replaceChildren(...options);
    el.value = [...el.options].some((o) => o.value === current) ? current : '';
  };
  const sizes = [...new Set(state.spools.map((s) => s.filament_g).filter(Boolean))].sort((a, b) => a - b);
  const inData = [...new Set(state.spools.map((s) => s.country))].filter((c) => c !== GLOBAL).sort(byName);
  keep('f-country', [option('', t('filter.any')), option(GLOBAL, t('country.global')), ...inData.map((c) => option(c, countryName(c)))]);
  keep('c-country', [option(GLOBAL, t('country.global')), ...[...COUNTRY_CODES].sort(byName).map((c) => option(c, countryName(c)))]);
  if (!$('c-country').value) $('c-country').value = GLOBAL;
  keep('f-size', [option('', t('filter.any')), ...sizes.map((g) => option(g, size(g)))]);
  keep('f-body', [option('', t('filter.any')), ...SPOOL_MATERIALS.map((b) => option(b, t(`body.${b}`)))]);
  keep('c-body', [option('', t('body.choose')), ...SPOOL_MATERIALS.map((b) => option(b, t(`body.${b}`)))]);
}

function filtered() {
  const country = $('f-country').value;
  const filament = Number($('f-size').value);
  const body = $('f-body').value;
  const photo = $('f-photo').checked;
  const sort = $('f-sort').value;
  const rows = search($('q').value).filter(
    (s) =>
      // A country shows its own spools plus the ones sold everywhere.
      (!country || s.country === country || (country !== GLOBAL && s.country === GLOBAL)) &&
      (!filament || s.filament_g === filament) &&
      (!body || s.spool_material === body) &&
      (!photo || s.image),
  );
  if (sort === 'light') rows.sort((a, b) => a.weight_g - b.weight_g);
  else if (sort === 'heavy') rows.sort((a, b) => b.weight_g - a.weight_g);
  return { rows, grouped: sort === 'maker' };
}

/** "Weighed by ana", "Imported from emptyspool.github.io"… linked to the reference or the issue when there is one. */
function sourceLine(spool) {
  const src = spool.source;
  if (!src) return null;
  const text = t(`source.${src.type}`, { by: src.by });
  const repo = repository();
  const href = src.url ?? (src.issue && repo ? `https://github.com/${repo}/issues/${src.issue}` : null);
  return h('p', { class: 'spool-source' }, href ? h('a', { href, target: '_blank', rel: 'noopener' }, text) : text);
}

function dimensionLine(spool) {
  const d = spool.dimensions;
  if (!d) return null;
  const parts = ['outer_mm', 'width_mm', 'hole_mm'].filter((k) => d[k]).map((k) => t(`dim.${k}`, { v: num(d[k], 1) }));
  return h('p', {}, parts.join(' · '));
}

function spoolTags(spool) {
  const tags = [
    spool.country !== GLOBAL && h('span', { class: 'tag' }, countryName(spool.country)),
    ...spool.filaments.map((f) => h('span', { class: 'tag filament' }, f)),
    spool.year && h('span', { class: 'tag' }, String(spool.year)),
    spool.verified && h('span', { class: 'tag verified' }, icon(...SHIELD), t('row.verified')),
  ].filter(Boolean);
  return tags.length ? h('div', { class: 'tags' }, ...tags) : null;
}

function spoolRow(spool, showMaker) {
  return h('li', { class: `spool${spool === state.selected ? ' selected' : ''}`, 'data-id': spool.id },
    spool.image &&
      h('button', { class: 'spool-thumb', type: 'button', 'aria-label': t('row.photo', { name: fullTitle(spool) }), onclick: () => showSpool(spool) },
        // If the file is missing, drop the thumbnail instead of showing a broken image.
        h('img', { src: spool.image, alt: '', loading: 'lazy', onerror: (e) => e.target.closest('.spool-thumb').remove() })),
    h('div', { class: 'spool-info' },
      h('div', { class: 'spool-name' }, showMaker && h('span', { class: 'by' }, `${makerName(spool)} · `), spoolTitle(spool)),
      spoolTags(spool)),
    h('div', { class: 'spool-weight' }, grams(spool.weight_g),
      spool.weight_min_g && h('small', {}, `${num(spool.weight_min_g, 1)}–${num(spool.weight_max_g, 1)} g`)),
    h('div', { class: 'spool-actions' },
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => selectSpool(spool, { focus: true }) }, t('row.use')),
      starButton(spool)),
    h('details', { class: 'spool-notes' }, h('summary', {}, t('row.notes')), dimensionLine(spool), spool.comment && h('p', {}, spool.comment), sourceLine(spool)),
  );
}

function renderList() {
  if (!onCatalog || !state.spools.length) return;
  const { rows, grouped } = filtered();
  const total = state.spools.length;
  $('catalog-count').textContent =
    rows.length === total
      ? t('catalog.count', { n: num(total), m: num(state.makers.length) })
      : t('catalog.count.filtered', { n: num(rows.length), total: num(total) });

  const list = $('list');
  if (!rows.length) {
    list.replaceChildren(
      h('div', { class: 'empty' },
        h('p', {}, t('catalog.empty')),
        h('div', {},
          h('button', { class: 'btn', type: 'button', onclick: clearFilters }, t('filter.clear')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: openContribute }, t('contribute.open')))),
    );
    return;
  }
  if (!grouped) {
    list.replaceChildren(h('ul', { class: 'spools' }, ...rows.map((s) => spoolRow(s, true))));
    return;
  }
  const groups = new Map();
  for (const s of rows) groups.set(s.manufacturer, [...(groups.get(s.manufacturer) ?? []), s]);
  list.replaceChildren(
    ...state.makers.filter((m) => groups.has(m.id)).map((m) =>
      h('section', { class: 'maker' },
        h('h3', {}, m.name, m.aliases.length ? h('small', {}, t('maker.aka', { names: m.aliases.join(', ') })) : null),
        h('ul', { class: 'spools' }, ...groups.get(m.id).map((s) => spoolRow(s, false))))),
  );
}

function clearFilters() {
  $('filters').reset();
  renderList();
}

/** Popup card with everything known about one spool: photo, weight, tags, dimensions, notes and source. */
function showSpool(spool) {
  let dialog = $('spool-card');
  if (!dialog) {
    // Only the backdrop is the dialog itself: the padding belongs to the body inside it.
    dialog = h('dialog', { id: 'spool-card', class: 'spool-card', 'aria-labelledby': 'spool-card-title', onclick: (e) => e.target === dialog && dialog.close() });
    document.body.append(dialog);
  }
  dialog.replaceChildren(
    h('div', { class: `card-body${spool.image ? ' has-photo' : ''}` },
      h('div', { class: 'card-head' },
        h('div', {}, h('p', { class: 'label' }, makerName(spool)), h('h2', { id: 'spool-card-title' }, spoolTitle(spool))),
        h('form', { method: 'dialog' }, h('button', { class: 'btn btn-small' }, t('photo.close')))),
      spool.image &&
        h('img', {
          class: 'card-photo', src: spool.image, alt: t('row.photo.alt', { name: fullTitle(spool) }),
          onerror: (e) => { e.target.parentElement.classList.remove('has-photo'); e.target.remove(); },
        }),
      h('div', { class: 'card-info' },
        h('p', { class: 'spool-weight' }, t('calc.emptyweight', { w: grams(spool.weight_g) }),
          spool.weight_min_g && h('small', {}, `${num(spool.weight_min_g, 1)}–${num(spool.weight_max_g, 1)} g`)),
        spoolTags(spool),
        dimensionLine(spool),
        spool.comment && h('p', {}, spool.comment),
        sourceLine(spool),
        onCatalog && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => selectSpool(spool) }, t('row.use')))),
  );
  dialog.showModal();
}

// ---------- contribute ----------

function openContribute() {
  $('c-error').textContent = '';
  if (!$('c-maker').value && $('q').value) $('c-maker').value = $('q').value;
  makerHint();
  $('contribute').showModal();
}

function makerHint() {
  const hint = $('c-maker-hint');
  const typed = $('c-maker').value.trim();
  hint.className = 'hint';
  hint.replaceChildren();
  if (!typed) return;
  const known = findManufacturer(state.makers, typed);
  if (known) {
    hint.textContent = t('contribute.maker.known', { name: known.name });
    return;
  }
  hint.classList.add('warn');
  const similar = similarManufacturers(state.makers, typed).slice(0, 3);
  hint.append(t(similar.length ? 'contribute.maker.similar' : 'contribute.maker.new'), ' ');
  for (const m of similar) {
    hint.append(h('button', { type: 'button', onclick: () => { $('c-maker').value = m.name; makerHint(); } }, m.name), ' ');
  }
}

function submitContribution(event) {
  event.preventDefault();
  const repo = repository();
  if (!repo) {
    $('c-error').className = 'hint error';
    $('c-error').textContent = t('contribute.norepo');
    return;
  }
  const typed = $('c-maker').value.trim();
  const maker = findManufacturer(state.makers, typed)?.name ?? typed;
  const body = $('c-body').value;
  const fields = {
    template: 'spool-addition.yml',
    title: `[Spool] ${maker} ${$('c-filament').value.trim()}`.trim(),
    manufacturer: maker,
    country: $('c-country').value === GLOBAL ? 'Global' : $('c-country').value,
    variant: $('c-variant').value.trim(),
    filaments: $('c-filaments').value.trim(),
    filament: $('c-filament').value.trim(),
    spool_material: body ? body[0].toUpperCase() + body.slice(1) : '',
    outer_mm: $('c-outer').value,
    width_mm: $('c-width').value,
    hole_mm: $('c-hole').value,
    weight: $('c-weight').value,
    year: $('c-year').value,
    source_type: $('c-source').value,
    source_url: $('c-source-url').value.trim(),
    comment: $('c-comment').value.trim(),
  };
  const query = new URLSearchParams(Object.entries(fields).filter(([, v]) => v));
  window.open(`https://github.com/${repo}/issues/new?${query}`, '_blank', 'noopener');
  $('contribute').close();
}

// ---------- start ----------

async function start() {
  const langSelect = $('lang');
  langSelect.append(...Object.entries(LANGUAGES).map(([code, label]) => option(code, label)));
  langSelect.addEventListener('change', () => setLanguage(langSelect.value));

  let makers, spools;
  try {
    [state.fallback, makers, spools] = await Promise.all(
      ['i18n/en.json', 'data/manufacturers.json', 'data/spools.json'].map((u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))),
    );
  } catch {
    const message = 'Could not load the spool data. Reload the page to try again.';
    if (onCatalog) $('list').replaceChildren(h('div', { class: 'empty' }, h('p', {}, message)));
    else $('scale-main').textContent = message;
    return;
  }
  state.makers = makers;
  state.makerById = new Map(makers.map((m) => [m.id, m]));
  state.spools = spools.map((s) => {
    const m = state.makerById.get(s.manufacturer);
    return { ...s, haystack: key([m?.name, ...(m?.aliases ?? []), s.variant, s.filaments.join(' '), s.spool_material, s.filament_g && `${s.filament_g}g ${s.filament_g / 1000}kg`, s.comment].join(' ')) };
  });
  // Catalogue order: manufacturer name, then the order in the data file.
  const order = new Map(makers.map((m, i) => [m.id, i]));
  state.spools.sort((a, b) => order.get(a.manufacturer) - order.get(b.manufacturer));
  loadFavorites();
  if (onCalculator) {
    $('reading').value = params.get('w') ?? '';
    state.selected = state.spools.find((sp) => sp.id === params.get('spool')) ?? null;
    if (state.selected) $('pick').value = fullTitle(state.selected);
  }
  if (onCatalog) {
    $('makers').append(...makers.map((m) => option(m.name, '')));
    $('q').value = params.get('q') ?? '';
  }

  const lang = pickLanguage();
  langSelect.value = lang;
  await setLanguage(lang);
  if (onCatalog && store.get('country')) {
    $('f-country').value = store.get('country');
    if (!$('f-country').value) $('f-country').value = '';
    renderList();
  }

  if (onCalculator) {
    $('pick').addEventListener('input', () => { state.selected = null; renderFavorites(); renderScale(); openPicker(); });
    $('pick').addEventListener('focus', () => { $('pick').select(); if (!state.selected) openPicker(); });
    $('pick').addEventListener('blur', closePicker);
    $('pick').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); $('pick-list').hidden ? openPicker() : movePicker(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); movePicker(-1); }
      else if (e.key === 'Enter' && pickerItems[pickerIndex] && !$('pick-list').hidden) { e.preventDefault(); selectSpool(pickerItems[pickerIndex]); $('reading').focus(); }
      else if (e.key === 'Escape') closePicker();
    });
    $('reading').addEventListener('input', () => { renderScale(); syncUrl(); });
  }

  if (onCatalog) {
    $('filters').addEventListener('input', renderList);
    // The country filter is remembered: people usually want the same one every time.
    $('f-country').addEventListener('change', () => { store.set('country', $('f-country').value); $('c-country').value = $('f-country').value || GLOBAL; });
    $('filters').addEventListener('submit', (e) => e.preventDefault());
    $('open-contribute').addEventListener('click', openContribute);
    $('contribute-cancel').addEventListener('click', () => $('contribute').close());
    $('c-maker').addEventListener('input', makerHint);
    $('contribute-form').addEventListener('submit', submitContribution);
    // The calculator links here with #add when the spool was not found.
    if (location.hash === '#add') openContribute();
  }
}

start();
