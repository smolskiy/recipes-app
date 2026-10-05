// Наши рецепты — клиентская часть без сборки.
// Два режима: «ПК» (домашняя сеть, данные на сервере) и «телефон» (данные на телефоне, ПК — обработка).

import { serverStore } from './store-server.js';

const view = document.getElementById('view');
const dialog = document.getElementById('dialog');
const toastEl = document.getElementById('toast');
const connEl = document.getElementById('conn');

// ---------- Режим ----------
const params0 = new URLSearchParams(location.search);
if (params0.has('device')) sessionStorage.setItem('forceDevice', params0.get('device'));
const forced = sessionStorage.getItem('forceDevice');
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const DEVICE = forced === '1' || (forced !== '0' && (location.protocol === 'https:' || NATIVE));
const ORIGIN_IS_PC = !!document.querySelector('meta[name="recipes-server"]');
let store = serverStore;
if (DEVICE) store = (await import('./store-device.js')).deviceStore;
document.documentElement.dataset.mode = store.mode;

// ---------- Утилиты ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const CATEGORIES = ['Завтраки', 'Супы', 'Салаты', 'Закуски', 'Основные блюда', 'Гарниры', 'Выпечка', 'Десерты',
  'Напитки', 'Соусы', 'Заготовки', 'Детское меню'];
const ACTIVE = ['pending', 'queued', 'downloading', 'transcribing', 'extracting'];

let toastTimer;
function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

const FRACT = [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1 / 3, '⅓'], [2 / 3, '⅔']];
function fmtAmount(x) {
  if (x == null) return '';
  const whole = Math.floor(x + 1e-9);
  const frac = x - whole;
  if (frac > 0.01) {
    for (const [v, s] of FRACT) if (Math.abs(frac - v) < 0.02 && whole < 10) return (whole ? whole : '') + s;
  }
  const r = Math.round(x * 100) / 100;
  return String(r).replace('.', ',');
}
function fmtQty(ing, scale = 1) {
  if (ing.amount == null) return null;
  let s = fmtAmount(ing.amount * scale);
  if (ing.amount_max != null) s += '–' + fmtAmount(ing.amount_max * scale);
  return ing.unit ? `${s} ${ing.unit}` : s;
}
function fmtMin(m) {
  if (!m) return null;
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}
const priceFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPrice = (p) => (p == null ? '—' : `${priceFmt.format(p)} ₽`);
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtAgo(iso) {
  if (!iso) return 'никогда';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  return fmtDate(iso);
}
function unitLabel(p) {
  // Вес обычно уже есть в названии товара — не повторяем его.
  if (!p.unit_text) return '';
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '').replace(',', '.');
  return norm(p.name).includes(norm(p.unit_text)) ? '' : ` <small>${esc(p.unit_text)}</small>`;
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
function servingsText(r, scale = 1) {
  if (r.servings) { const n = Math.round(r.servings * scale * 10) / 10; return `${fmtAmount(n)} ${plural(Math.round(n), ['порция', 'порции', 'порций'])}`; }
  return r.servings_text || null;
}
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path, params: new URLSearchParams(query) };
}
async function setImg(img, name) {
  const url = await store.imageUrl(name);
  if (url) img.src = url; else img.closest('.thumb, .hero-img')?.classList.add('noimg');
}
function hydrateImages(root = view) {
  $$('img[data-img]', root).forEach((img) => setImg(img, img.dataset.img));
}

// ---------- Диалоги ----------
function openDialog(html, onMount) {
  dialog.innerHTML = `<div class="dialog-body">${html}</div>`;
  dialog.showModal();
  onMount?.(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
  });
}
async function confirmDialog(title, text, okLabel, danger = false) {
  const res = await openDialog(`
    <h3>${esc(title)}</h3><p>${esc(text)}</p>
    <form method="dialog" class="dialog-actions">
      <button class="btn" value="cancel">Отмена</button>
      <button class="btn ${danger ? 'btn-danger-fill' : 'btn-primary'}" value="ok">${esc(okLabel)}</button>
    </form>`);
  return res === 'ok';
}
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close('cancel'); });

// ---------- Счётчик заданий и связь ----------
let badgeTimer = null;
async function refreshBadge() {
  try {
    const active = await store.activeCount();
    const badge = document.getElementById('active-badge');
    badge.hidden = active === 0;
    badge.textContent = active;
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(refreshBadge, active ? 4000 : 30000);
  } catch { badgeTimer = setTimeout(refreshBadge, 30000); }
}

const CONN_TEXT = { lan: 'Дома', wan: 'Через интернет', offline: 'Нет связи с ПК', unpaired: 'Не подключено', unknown: 'Проверяю связь' };
async function renderConn() {
  if (!DEVICE) return;
  const c = await store.connection();
  const state = !c.paired ? 'unpaired' : c.conn?.state || 'unknown';
  const navItem = document.querySelector('[data-nav="system"]');
  navItem.dataset.conn = state;
  navItem.title = `${CONN_TEXT[state] || state}${c.lastSync ? `, синхронизация ${fmtAgo(c.lastSync)}` : ''}`;
  // Полоса над меню — только когда связи нет.
  connEl.hidden = !(state === 'offline' || state === 'unpaired' || c.authLost);
  connEl.dataset.state = state;
  connEl.textContent = c.authLost ? 'Компьютер отключил этот телефон — подключите заново'
    : state === 'unpaired' ? 'Приложение не подключено к компьютеру'
      : `Нет связи с домашним компьютером${c.pending ? ` — ${c.pending} ${plural(c.pending, ['ссылка ждёт', 'ссылки ждут', 'ссылок ждут'])} в очереди` : '. Рецепты доступны'}`;
}

// ---------- Маршрутизация ----------
let currentCleanup = null;
async function route() {
  currentCleanup?.();
  currentCleanup = null;
  const { path, params } = parseHash();
  const parts = path.split('/').filter(Boolean);
  let nav = 'list';
  try {
    if (DEVICE && parts[0] !== 'pair' && !(await store.paired())) {
      location.replace('#/pair');
      return;
    }
    if (parts[0] === 'r' && parts[1] && parts[2] === 'edit') await renderEdit(parts[1]);
    else if (parts[0] === 'r' && parts[1]) await renderRecipe(parts[1]);
    else if (parts[0] === 'add') { nav = 'add'; await renderAdd(params); }
    else if (parts[0] === 'system') { nav = 'system'; await renderSystem(); }
    else if (parts[0] === 'pair' && DEVICE) { nav = 'system'; await renderPair(params); }
    else if (parts[0] === 'phone' && !DEVICE) { nav = 'system'; await renderPhoneSetup(); }
    else await renderList(params);
  } catch (e) {
    view.innerHTML = `<div class="notice error">${icon('warn')}<div><b>Не удалось открыть страницу</b><div class="small">${esc(e.message)}</div></div></div>`;
  }
  $$('.nav-item').forEach((a) => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

// =====================================================================
// Коллекция
// =====================================================================
const listState = { q: '', category: '', favorite: false, review: false };

async function renderList(params) {
  listState.q = params.get('q') || listState.q;
  view.innerHTML = `
    <header class="page-head">
      <h1 class="h1">Наши рецепты</h1>
      <span class="count" id="count"></span>
    </header>
    <label class="search">${icon('search')}
      <span class="sr-only">Поиск</span>
      <input class="input" id="q" type="search" placeholder="Название, продукт или тег" value="${esc(listState.q)}" autocomplete="off" enterkeyhint="search">
    </label>
    <div class="chips" id="chips" role="toolbar" aria-label="Фильтры"></div>
    <div id="results"><div class="list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>`;
  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { listState.q = e.target.value.trim(); loadList(); }, 220);
  });
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const f = b.dataset.f;
    if (f === 'all') { listState.category = ''; listState.favorite = false; listState.review = false; }
    else if (f === 'fav') listState.favorite = !listState.favorite;
    else if (f === 'review') listState.review = !listState.review;
    else listState.category = listState.category === f ? '' : f;
    loadList();
  });
  await loadList();
}

async function loadList() {
  const data = await store.listRecipes(listState);
  const counts = data.category_counts || {};
  const anyFilter = listState.category || listState.favorite || listState.review;
  const chips = [`<button class="chip" data-f="all" aria-pressed="${!anyFilter}">Все</button>`,
    `<button class="chip" data-f="fav" aria-pressed="${listState.favorite}">${icon('heart')}Избранное</button>`,
    `<button class="chip" data-f="review" aria-pressed="${listState.review}">${icon('warn')}Нужно уточнить</button>`];
  for (const c of data.categories || CATEGORIES) {
    if (!counts[c] && listState.category !== c) continue;
    chips.push(`<button class="chip" data-f="${esc(c)}" aria-pressed="${listState.category === c}">${esc(c)} <span class="count">${counts[c] || 0}</span></button>`);
  }
  if (!$('#chips')) return;
  $('#chips').innerHTML = chips.join('');
  $('#count').textContent = data.items.length ? `${data.items.length} ${plural(data.items.length, ['рецепт', 'рецепта', 'рецептов'])}` : '';
  const box = $('#results');
  if (!data.items.length) {
    box.innerHTML = (listState.q || anyFilter)
      ? `<div class="empty"><p>Ничего не нашлось. Попробуйте другое слово или сбросьте фильтры.</p></div>`
      : `<div class="empty"><div class="plate"></div><p>Здесь пока пусто. Добавьте ссылку на рецепт с сайта, YouTube или Instagram — он появится тут в едином виде.</p><a class="btn btn-primary" href="#/add">${icon('plus')}Добавить рецепт</a></div>`;
    return;
  }
  box.innerHTML = `<div class="list">${data.items.map(cardHtml).join('')}</div>`;
  hydrateImages(box);
}

function cardHtml(r) {
  const time = fmtMin(r.total_time_min);
  const thumb = r.image
    ? `<img data-img="${esc(r.image)}" alt="" loading="lazy">`
    : `<span class="mono">${esc((r.title || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
  const meta = [];
  if (time) meta.push(`<span>${icon('clock')}${esc(time)}</span>`);
  if (r.servings) meta.push(`<span>${icon('people')}${esc(fmtAmount(r.servings))}</span>`);
  if (r.needs_review) meta.push(`<span class="flag">${icon('warn')}уточнить</span>`);
  else if (r.source_name) meta.push(`<span>${esc(r.source_name.split(',')[0])}</span>`);
  return `<a class="card" href="#/r/${esc(r.key)}">
    <div class="thumb">${thumb}</div>
    <div><p class="card-title">${esc(r.title)}</p><div class="meta">${meta.join('')}</div></div>
    ${r.favorite ? `<span class="fav" title="В избранном">${icon('heart-fill')}</span>` : ''}
  </a>`;
}

// =====================================================================
// Рецепт
// =====================================================================
async function renderRecipe(key) {
  const { recipe: r, job } = await store.getRecipe(key);
  let scale = 1;
  const baseServ = r.servings;

  const times = [];
  if (r.prep_time_min) times.push(`подготовка ${fmtMin(r.prep_time_min)}`);
  if (r.cook_time_min) times.push(`готовка ${fmtMin(r.cook_time_min)}`);
  const total = r.total_time_min || ((r.prep_time_min || 0) + (r.cook_time_min || 0)) || null;
  const issues = r.issues || [];

  view.innerHTML = `
    <div class="topbar">
      <a class="btn btn-ghost" href="#/">${icon('back')}Рецепты</a>
      <div class="btn-row">
        <button class="btn btn-icon" id="fav" aria-pressed="${!!r.favorite}" title="${r.favorite ? 'Убрать из избранного' : 'В избранное'}">${icon(r.favorite ? 'heart-fill' : 'heart')}</button>
        <a class="btn btn-icon" href="#/r/${esc(r.key)}/edit" title="Изменить">${icon('edit')}</a>
        <button class="btn btn-icon" id="more" title="Ещё">${icon('more')}</button>
      </div>
    </div>
    <section class="recipe-hero ${r.image ? 'has-img' : ''}">
      ${r.image ? `<div class="hero-img"><img data-img="${esc(r.image)}" alt=""></div>` : ''}
      <div class="hero-text">
        <h1 class="h1">${esc(r.title)}</h1>
        ${r.description ? `<p class="lead">${esc(r.description)}</p>` : ''}
        <div class="meta">
          ${total ? `<span>${icon('clock')}${esc(fmtMin(total))}${times.length ? ` <span class="muted">(${esc(times.join(', '))})</span>` : ''}</span>` : ''}
          ${servingsText(r) ? `<span>${icon('people')}${esc(servingsText(r))}</span>` : ''}
        </div>
        ${r.source_url ? `<a class="source-link" href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">${icon(r.source_kind && r.source_kind !== 'web' ? 'play' : 'link')}${esc(r.source_name || hostOf(r.source_url))}</a>` : (r.source_name ? `<span class="muted small">${esc(r.source_name)}</span>` : '')}
        ${r.author && !(r.source_name || '').includes(r.author) ? `<span class="muted small">Автор: ${esc(r.author)}</span>` : ''}
        <div class="tags">${(r.categories || []).map((c) => `<span class="tag cat">${esc(c)}</span>`).join('')}${(r.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>
    </section>
    ${(r.needs_review || issues.length) ? `
      <div class="notice">${icon('warn')}<div>
        <b>${r.needs_review ? 'Нужно уточнить' : 'Замечания'}</b>
        ${issues.length ? `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      </div></div>` : ''}
    <div class="recipe-body">
      <div class="recipe-side">
        <section class="section" aria-labelledby="h-ing">
          <div class="section-head">
            <h2 class="h2" id="h-ing">Ингредиенты</h2>
            <div class="scaler" role="group" aria-label="Количество порций">
              <button type="button" data-step="-1" aria-label="Меньше">−</button>
              <output id="scale-out"></output>
              <button type="button" data-step="1" aria-label="Больше">+</button>
            </div>
          </div>
          <div id="ings"></div>
        </section>
        <section class="receipt-wrap" aria-labelledby="h-shop">
          <div class="section-head"><h2 class="h2" id="h-shop">Что купить</h2></div>
          <div class="store-switch" id="chain-switch" role="group" aria-label="Магазин"></div>
          <div class="receipt" id="receipt"><div class="rc-loading">Подбираю товары…<div class="bar"></div></div></div>
        </section>
      </div>
      <div class="recipe-main">
        <section class="section" aria-labelledby="h-steps">
          <h2 class="h2" id="h-steps">Приготовление</h2>
          ${(r.steps || []).length ? `<ol class="steps">${r.steps.map(stepHtml).join('')}</ol>` : '<p class="muted">Шаги не указаны. Их можно дописать вручную.</p>'}
        </section>
        ${(r.tips || []).length ? `<section class="section" style="margin-top:28px"><h2 class="h2">Советы автора</h2><ul class="tips">${r.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}
        <section style="margin-top:28px">
          <details class="raw" id="raw"><summary>Исходный текст</summary><pre>Загрузка…</pre></details>
        </section>
        <p class="muted small" style="margin-top:16px">Добавлен ${esc(fmtDate(r.created_at))}${r.updated_at && r.updated_at !== r.created_at ? `, изменён ${esc(fmtDate(r.updated_at))}` : ''}</p>
      </div>
    </div>`;
  hydrateImages();

  const ingredients = r.ingredients || [];
  const renderIngs = () => {
    let group = null;
    const rows = [];
    ingredients.forEach((ing, i) => {
      if (ing.group && ing.group !== group) { group = ing.group; rows.push(`</ul><div class="ing-group">${esc(group)}</div><ul class="ing">`); }
      const q = fmtQty(ing, scale);
      rows.push(`<li><label><input type="checkbox" data-i="${i}">
        <span class="ing-name">${esc(ing.name)}${ing.note ? `<span class="ing-note">${esc(ing.note)}</span>` : ''}</span>
        <span class="ing-qty ${q ? '' : 'unknown'}">${q ? esc(q) : (ing.note && /вкус/i.test(ing.note) ? '' : 'не указано')}</span></label></li>`);
    });
    $('#ings').innerHTML = ingredients.length ? `<ul class="ing">${rows.join('')}</ul>`.replace('<ul class="ing"></ul>', '') : '<p class="muted">Ингредиенты не указаны.</p>';
    $('#scale-out').textContent = baseServ ? servingsText(r, scale) : `× ${fmtAmount(scale)}`;
  };
  renderIngs();

  $('.scaler').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const step = +b.dataset.step;
    if (baseServ) {
      const next = Math.max(1, Math.round(baseServ * scale) + step);
      scale = next / baseServ;
    } else {
      scale = Math.max(0.5, Math.min(10, scale + step * 0.5));
    }
    renderIngs();
    shop.reload(scale);
  });

  const favBtn = $('#fav');
  if (r.favorite) favBtn.style.color = 'var(--tomato)';
  favBtn.addEventListener('click', async () => {
    const value = !r.favorite;
    try {
      await store.setFavorite(r.key, value);
      r.favorite = value;
      favBtn.setAttribute('aria-pressed', value);
      favBtn.innerHTML = icon(value ? 'heart-fill' : 'heart');
      favBtn.style.color = value ? 'var(--tomato)' : '';
      toast(value ? 'Добавлено в избранное' : 'Убрано из избранного');
    } catch (e) { toast(e.message); }
  });

  $('#more').addEventListener('click', () => recipeMenu(r));

  $('#raw').addEventListener('toggle', async (e) => {
    if (!e.target.open || e.target.dataset.loaded) return;
    e.target.dataset.loaded = '1';
    try { $('#raw pre').textContent = await store.source(r.key); }
    catch (err) { $('#raw pre').textContent = err.offline ? 'Исходный текст хранится на компьютере — откройте, когда будет связь.' : 'Исходный текст не сохранён.'; e.target.dataset.loaded = ''; }
  });

  const shop = receipt(r);
  await shop.init();
}

function stepHtml(s) {
  const meta = [];
  if (s.temperature_c != null) meta.push(`<span class="hot">${icon('flame')}${s.temperature_c} °C</span>`);
  if (s.duration_min != null) meta.push(`<span>${icon('clock')}${esc(fmtMin(Math.round(s.duration_min)) || `${s.duration_min} мин`)}</span>`);
  return `<li><div><p class="step-text">${esc(s.text)}</p>${meta.length ? `<div class="step-meta">${meta.join('')}</div>` : ''}</div></li>`;
}

async function recipeMenu(r) {
  const res = await openDialog(`
    <h3>${esc(r.title)}</h3>
    <form method="dialog" class="menu-list">
      <button class="btn" value="reprocess">${icon('refresh')}Обработать заново</button>
      ${r.source_url ? `<a class="btn" href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">${icon('link')}Открыть источник</a>` : ''}
      <button class="btn btn-danger" value="delete">${icon('trash')}Удалить рецепт</button>
      <button class="btn btn-ghost" value="cancel">Закрыть</button>
    </form>`);
  if (res === 'delete') {
    if (await confirmDialog('Удалить рецепт?', `«${r.title}» исчезнет из коллекции${DEVICE ? ' на телефоне и на компьютере' : ''}. Это действие нельзя отменить.`, 'Удалить', true)) {
      try { await store.deleteRecipe(r.key); toast('Рецепт удалён'); location.hash = '#/'; }
      catch (e) { toast(e.message); }
    }
  } else if (res === 'reprocess') {
    if (await confirmDialog('Обработать заново?', 'Рецепт будет собран из источника ещё раз. Ручные правки заменятся новым результатом, избранное сохранится.', 'Обработать')) {
      try { await store.reprocess(r.key); toast('Задание поставлено в очередь'); refreshBadge(); if (!DEVICE) location.hash = '#/add'; }
      catch (e) { toast(e.message, 4000); }
    }
  }
}

// ---------- Чек «Что купить» ----------
function receipt(r) {
  const box = $('#receipt');
  const sw = $('#chain-switch');
  let chain = null;
  let chains = [];
  let scale = 1;
  let data = null;
  const excluded = new Set();
  const chosen = new Map();

  async function init() {
    try {
      const res = await store.chains();
      chains = res.items;
      chain = res.default_chain;
    } catch (e) { box.innerHTML = `<div class="rc-miss">${esc(e.message)}</div>`; return; }
    renderSwitch();
    if (!(r.ingredients || []).length) { box.innerHTML = '<div class="rc-miss">В рецепте нет ингредиентов.</div>'; return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: '200px' });
    io.observe(box);
  }

  function renderSwitch() {
    sw.innerHTML = chains.map((c) => `<button class="chip" data-chain="${c.id}" aria-pressed="${c.id === chain}">${esc(c.name)}</button>`).join('');
  }
  sw.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-chain]');
    if (!b || b.dataset.chain === chain) return;
    chain = b.dataset.chain;
    chosen.clear(); excluded.clear();
    renderSwitch();
    store.setDefaultChain(chain).catch(() => {});
    load();
  });

  async function load() {
    box.innerHTML = `<div class="rc-loading">Ищу товары в магазине «${esc(chains.find((c) => c.id === chain)?.name || '')}»…<div class="bar"></div></div>`;
    try { data = await store.shopping(r.key, chain, scale); }
    catch (e) { data = { error: e.message, items: [] }; }
    draw();
  }

  function lineCost(item) {
    const p = chosen.get(item.index) || item.product;
    if (!p) return null;
    return p.price * (item.packs || 1);
  }

  function draw() {
    const storeName = data.chain_name || chains.find((c) => c.id === chain)?.name || '';
    const head = `<div class="rc-head"><div class="rc-store">${esc(storeName.toUpperCase())}</div>
      <div class="rc-addr">${data.store ? esc(data.store.address || `магазин ${data.store.id}`) : (data.offline ? 'нет связи с компьютером' : 'магазин не выбран')}</div>
      ${data.offline ? '' : '<div class="rc-actions" style="justify-content:center"><button type="button" data-act="store">сменить магазин</button></div>'}</div>`;
    if (data.error) {
      box.innerHTML = head + `<div class="rc-miss">${esc(data.error)}</div>
        ${data.blocked ? `<div class="rc-foot">Пока можно посмотреть цены в другой сети — переключите магазин выше.</div>` : ''}`;
      return;
    }
    let total = 0;
    const lines = data.items.map((it) => {
      const p = chosen.get(it.index) || it.product;
      const off = excluded.has(it.index) || it.skip || !p;
      const cost = lineCost(it);
      if (!off && cost) total += cost;
      if (it.skip) return '';
      const need = it.need ? `нужно ${esc(it.need)}` : '';
      if (!p) {
        return `<div class="rc-line"><div class="rc-for"><span>${esc(it.ingredient)}</span><span>${need}</span></div>
          <div class="rc-miss">${it.error ? esc(it.error) : 'не нашлось'}</div>
          <div class="rc-actions"><button type="button" data-act="search" data-i="${it.index}">искать иначе</button></div></div>`;
      }
      const packs = it.packs > 1 ? ` <small>× ${it.packs}</small>` : '';
      const old = p.old_price ? `<span class="rc-old">${esc(fmtPrice(p.old_price * (it.packs || 1)))}</span>` : '';
      const alts = it.alternatives?.length || 0;
      return `<div class="rc-line">
        <div class="rc-for"><span>${esc(it.ingredient)}</span><span>${need}</span></div>
        <div class="rc-row">
          <label><input type="checkbox" data-i="${it.index}" ${off ? '' : 'checked'}>
          <span class="rc-name">${esc(p.name)}${unitLabel(p)}${packs}${p.old_price ? '<span class="rc-promo">акция</span>' : ''}</span></label>
          <span class="rc-dots"></span>
          <span class="rc-price">${old}${esc(fmtPrice(cost))}</span>
        </div>
        <div class="rc-actions">
          ${alts ? `<button type="button" data-act="alts" data-i="${it.index}">другие (${alts})</button>` : ''}
          <button type="button" data-act="search" data-i="${it.index}">искать иначе</button>
          ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">на сайте</a>` : ''}
        </div>
        <div class="alts-box" data-alts="${it.index}"></div>
      </div>`;
    }).join('');
    box.innerHTML = head + lines + `
      <div class="rc-total"><span>Итого примерно</span><b>${esc(fmtPrice(total))}</b></div>
      <div class="rc-foot">${data.offline_cached ? 'Нет связи с компьютером — показаны сохранённые цены. ' : ''}Цены магазина на ${esc(fmtDate(data.fetched_at))}. Считается целыми упаковками. Снимите галочку с того, что уже есть дома.</div>`;
  }

  box.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox][data-i]');
    if (!cb) return;
    const i = +cb.dataset.i;
    cb.checked ? excluded.delete(i) : excluded.add(i);
    draw();
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const i = +b.dataset.i;
    const item = data?.items?.find((x) => x.index === i);
    if (act === 'alts' && item) {
      const slot = box.querySelector(`[data-alts="${i}"]`);
      if (slot.innerHTML) { slot.innerHTML = ''; return; }
      const list = [item.product, ...item.alternatives].filter(Boolean);
      slot.innerHTML = `<ul class="rc-alts">${list.map((p, k) => `<li><button type="button" data-act="pick" data-i="${i}" data-k="${k}"><span>${esc(p.name)}${unitLabel(p)}</span><b>${esc(fmtPrice(p.price))}</b></button></li>`).join('')}</ul>`;
    } else if (act === 'pick' && item) {
      const list = [item.product, ...item.alternatives].filter(Boolean);
      chosen.set(i, list[+b.dataset.k]);
      excluded.delete(i);
      draw();
    } else if (act === 'search' && item) {
      await searchOther(item);
    } else if (act === 'store') {
      await chooseStore(chain, () => load());
    }
  });

  async function searchOther(item) {
    const res = await openDialog(`
      <h3>Найти в магазине</h3>
      <form method="dialog" id="sform" class="dialog-body" style="padding:0">
        <label class="field"><span>Что искать</span><input class="input" name="q" value="${esc(item.query || item.ingredient)}" required minlength="2"></label>
        <div id="sres" class="store-results"></div>
        <div class="dialog-actions"><button class="btn" value="cancel">Закрыть</button><button class="btn btn-primary" id="sgo" type="button">${icon('search')}Найти</button></div>
      </form>`, (d) => {
      const run = async () => {
        const q = $('input[name=q]', d).value.trim();
        if (q.length < 2) return;
        const out = $('#sres', d);
        out.innerHTML = '<p class="muted small">Ищу…</p>';
        try {
          const { items } = await store.grocerySearch(chain, q);
          if (!items.length) { out.innerHTML = '<p class="muted small">Ничего не нашлось.</p>'; return; }
          out.innerHTML = items.slice(0, 15).map((p, k) => `<button type="button" data-k="${k}">${esc(p.name)} <b>${esc(fmtPrice(p.price))}</b><small>${esc(p.unit_text || '')}${p.available === false ? ', нет в наличии' : ''}</small></button>`).join('');
          out.onclick = (ev) => {
            const btn = ev.target.closest('[data-k]');
            if (!btn) return;
            const p = items[+btn.dataset.k];
            chosen.set(item.index, p);
            if (!item.product) { item.product = p; item.packs = 1; }
            excluded.delete(item.index);
            d.close('picked');
          };
        } catch (err) { out.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
      };
      $('#sgo', d).addEventListener('click', run);
      $('input[name=q]', d).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); run(); } });
      run();
    });
    if (res === 'picked') draw();
  }

  return { init, reload(s) { scale = s; if (data) load(); } };
}

async function chooseStore(chain, onDone) {
  const names = { '5ka': 'Пятёрочка', magnit: 'Магнит', lenta: 'Лента' };
  const res = await openDialog(`
    <h3>Магазин: ${esc(names[chain])}</h3>
    <p class="small">Магазины рядом с адресом, указанным в разделе «Система». Цены зависят от магазина.</p>
    <div id="stores" class="store-results"><p class="muted small">Ищу магазины…</p></div>
    <form method="dialog" class="dialog-actions"><button class="btn" value="cancel">Закрыть</button></form>`,
  async (d) => {
    const out = $('#stores', d);
    try {
      const { items } = await store.stores(chain);
      if (!items.length) { out.innerHTML = '<p class="muted small">Рядом магазинов не найдено. Укажите другой адрес в разделе «Система».</p>'; return; }
      out.innerHTML = items.map((s, k) => `<button type="button" data-k="${k}">${esc(s.address || s.id)}<small>${esc(s.name || '')}${s.distance_km != null ? `, ${String(s.distance_km).replace('.', ',')} км` : ''}</small></button>`).join('');
      out.onclick = async (ev) => {
        const b = ev.target.closest('[data-k]');
        if (!b) return;
        await store.setStore(items[+b.dataset.k]);
        d.close('picked');
      };
    } catch (e) { out.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  });
  if (res === 'picked') { toast('Магазин выбран'); onDone?.(); }
}

// =====================================================================
// Добавление и очередь
// =====================================================================
let addMode = 'url';
async function renderAdd(params) {
  const limits = await store.limits().catch(() => null);
  const preset = params.get('url') || '';
  if (params.get('shared')) toast('Ссылка добавлена в очередь', 3000);
  view.innerHTML = `
    <header class="page-head"><h1 class="h1">Добавить рецепт</h1></header>
    <form class="add-panel" id="add-form" novalidate>
      <div class="seg" role="group" aria-label="Способ">
        <button type="button" data-mode="url" aria-pressed="${addMode === 'url'}">Ссылка</button>
        <button type="button" data-mode="text" aria-pressed="${addMode === 'text'}">Текст</button>
      </div>
      <div class="add-row" id="mode-url" ${addMode === 'url' ? '' : 'hidden'}>
        <label class="field"><span class="sr-only">Ссылка</span>
          <input class="input" name="url" type="url" inputmode="url" placeholder="Вставьте ссылку на рецепт или видео" value="${esc(preset)}" autocomplete="off" enterkeyhint="go"></label>
        <button class="btn btn-primary" type="submit">${icon('plus')}Добавить</button>
      </div>
      <div id="mode-text" class="field" ${addMode === 'text' ? '' : 'hidden'}>
        <label class="field"><span>Текст рецепта</span>
          <textarea class="textarea" name="text" rows="8" placeholder="Скопируйте сюда текст рецепта — например, описание под видео или сообщение из чата"></textarea></label>
        <button class="btn btn-primary" type="submit" style="justify-self:start">${icon('text')}Разобрать текст</button>
      </div>
      <p class="form-error" id="add-err" hidden></p>
      <p class="sources">Сайты с рецептами, YouTube, Instagram, TikTok, VK Видео, Rutube. ${DEVICE
        ? 'Ссылку можно отправить и через «Поделиться» в любом приложении. Без связи с домашним компьютером она подождёт в очереди и уйдёт сама.'
        : 'Обработка идёт на домашнем компьютере, обычно 1–3 минуты.'}</p>
      ${limits ? `<details class="limits"><summary>Ограничения</summary><ul>
        <li>Видео до ${limits.max_video_minutes} минут — у более длинных используются только описание и субтитры.</li>
        <li>Аудио до ${limits.max_audio_mb} МБ, видео для чтения кадров до ${limits.max_video_mb} МБ, не больше ${limits.max_frames} кадров.</li>
        <li>Страница сайта до ${limits.max_page_mb} МБ, текст до ${limits.max_text_chars.toLocaleString('ru-RU')} символов.</li>
        <li>Одно задание обрабатывается не дольше ${limits.job_timeout_min} минут, при сбое сети — до ${limits.max_attempts} попыток.</li>
        <li>Ссылки на домашнюю сеть и служебные адреса не принимаются.</li></ul></details>` : ''}
    </form>
    <h2 class="h2" style="margin-top:24px">Очередь и история</h2>
    <div class="jobs" id="jobs"></div>`;

  const form = $('#add-form');
  $$('.seg button', form).forEach((b) => b.addEventListener('click', () => {
    addMode = b.dataset.mode;
    $$('.seg button', form).forEach((x) => x.setAttribute('aria-pressed', x.dataset.mode === addMode));
    $('#mode-url').hidden = addMode !== 'url';
    $('#mode-text').hidden = addMode !== 'text';
    $(addMode === 'url' ? 'input[name=url]' : 'textarea[name=text]').focus();
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitJob(form, false);
  });
  await loadJobs();
  const timer = setInterval(loadJobs, DEVICE ? 3000 : 2500);
  currentCleanup = () => clearInterval(timer);
}

async function submitJob(form, force) {
  const err = $('#add-err');
  err.hidden = true;
  const body = addMode === 'url' ? { url: form.url.value.trim(), force } : { text: form.text.value.trim(), force };
  if (!(body.url || body.text)) { err.textContent = addMode === 'url' ? 'Вставьте ссылку' : 'Вставьте текст рецепта'; err.hidden = false; return; }
  try {
    await store.addJob(body);
    form.reset();
    toast(DEVICE ? 'Добавлено в очередь — отправится на компьютер' : 'Добавлено в очередь');
    refreshBadge();
    await loadJobs();
  } catch (e) {
    if (e.status === 409 && e.data) {
      const links = (e.data.recipes || []).map((r) => `<a href="#/r/${r.id}">«${esc(r.title)}»</a>`).join(', ');
      err.innerHTML = `${esc(e.data.detail)}${links ? `: ${links}` : ''}. <button type="button" class="btn btn-ghost" id="force" style="min-height:32px">Добавить ещё раз</button>`;
      err.hidden = false;
      $('#force').addEventListener('click', () => submitJob(form, true));
    } else {
      err.textContent = e.message;
      err.hidden = false;
    }
  }
}

async function loadJobs() {
  const box = $('#jobs');
  if (!box) return;
  let items;
  try { items = await store.listJobs(); } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
  if (!items.length) { box.innerHTML = '<p class="muted">Заданий пока не было.</p>'; return; }
  box.innerHTML = items.map((j) => {
    const title = j.title || (j.kind === 'text' ? 'Текст рецепта' : hostOf(j.url));
    const done = ['done', 'needs_review', 'duplicate'].includes(j.status) && j.recipe_keys.length;
    const canRetry = ['error', 'done', 'needs_review', 'rejected', 'duplicate'].includes(j.status);
    const canDelete = !['downloading', 'transcribing', 'extracting'].includes(j.status);
    const statusCls = j.status === 'pending' ? 'queued' : j.status === 'duplicate' ? 'needs_review' : j.status === 'rejected' ? 'error' : j.status;
    return `<article class="job">
      <div class="job-top"><span class="job-title">${esc(title)}</span><span class="status s-${statusCls}">${esc(j.status_label)}</span></div>
      ${j.url ? `<a class="job-url" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">${esc(j.url)}</a>` : ''}
      ${j.stage_detail ? `<div class="job-detail">${esc(j.stage_detail)}</div>` : ''}
      ${j.error ? `<div class="job-error">${esc(j.error)}</div>` : ''}
      ${j.notes?.length ? `<div class="job-detail">${j.notes.map(esc).join('<br>')}</div>` : ''}
      <div class="btn-row">
        ${done ? j.recipe_keys.map((k, n) => `<a class="btn btn-primary" href="#/r/${esc(k)}">${j.recipe_keys.length > 1 ? `Рецепт ${n + 1}` : 'Открыть рецепт'}</a>`).join('') : ''}
        ${canRetry ? `<button class="btn" data-retry="${esc(j.key)}">${icon('refresh')}${j.status === 'duplicate' ? 'Добавить всё равно' : 'Повторить'}</button>` : ''}
        ${j.status === 'error' && !j.local ? `<button class="btn" data-src="${esc(j.key)}">${icon('text')}Что удалось получить</button>` : ''}
        ${canDelete ? `<button class="btn btn-ghost" data-del="${esc(j.key)}" title="Убрать из списка">${icon('trash')}</button>` : ''}
      </div>
      <div class="muted small">${esc(fmtDate(j.created_at))}${j.attempts > 1 ? `, попыток: ${j.attempts}` : ''}</div>
    </article>`;
  }).join('');
}

document.addEventListener('click', async (e) => {
  const retry = e.target.closest('[data-retry]');
  const del = e.target.closest('[data-del]');
  const src = e.target.closest('[data-src]');
  if (retry) {
    try { await store.retryJob(retry.dataset.retry); toast('Задание снова в очереди'); refreshBadge(); loadJobs(); }
    catch (err) { toast(err.message, 4000); }
  } else if (del) {
    try { await store.deleteJob(del.dataset.del); loadJobs(); }
    catch (err) { toast(err.message); }
  } else if (src) {
    const text = await store.jobSource(src.dataset.src).catch(() => '');
    openDialog(`<h3>Что удалось получить</h3><pre style="white-space:pre-wrap;max-height:60vh;overflow:auto;font-family:inherit;font-size:14px">${esc(text || 'Ничего — источник не загрузился.')}</pre>
      <p class="small">Если рецепт тут есть, скопируйте его и добавьте через вкладку «Текст».</p>
      <form method="dialog" class="dialog-actions"><button class="btn" value="ok">Закрыть</button></form>`);
  }
});

// =====================================================================
// Редактирование
// =====================================================================
async function renderEdit(key) {
  const { recipe: r } = await store.getRecipe(key);
  const num = (v) => (v == null ? '' : String(v).replace('.', ','));
  const ingRow = (i = {}) => `<div class="ing-row">
      <input class="input" name="i_name" placeholder="Продукт" value="${esc(i.name || '')}" aria-label="Продукт">
      <input class="input" name="i_amount" inputmode="decimal" placeholder="Кол-во" value="${esc(num(i.amount))}" aria-label="Количество">
      <input class="input" name="i_unit" placeholder="Ед." value="${esc(i.unit || '')}" aria-label="Единица">
      <button type="button" class="btn btn-icon btn-ghost" data-rm title="Удалить строку">${icon('trash')}</button>
      <input class="input note" name="i_note" placeholder="Примечание (по вкусу, для подачи…)" value="${esc(i.note || '')}" aria-label="Примечание">
      <input type="hidden" name="i_group" value="${esc(i.group || '')}"><input type="hidden" name="i_max" value="${esc(i.amount_max ?? '')}"><input type="hidden" name="i_q" value="${esc(i.shop_query || '')}">
    </div>`;
  const stepRow = (s = {}) => `<div class="step-row">
      <textarea class="textarea" name="s_text" rows="2" style="min-height:72px" aria-label="Шаг">${esc(s.text || '')}</textarea>
      <button type="button" class="btn btn-icon btn-ghost" data-rm title="Удалить шаг">${icon('trash')}</button>
      <div class="sub"><input class="input" name="s_temp" inputmode="numeric" placeholder="°C" value="${esc(s.temperature_c ?? '')}" aria-label="Температура">
      <input class="input" name="s_dur" inputmode="decimal" placeholder="мин" value="${esc(num(s.duration_min))}" aria-label="Минут"></div>
    </div>`;

  view.innerHTML = `
    <div class="topbar"><a class="btn btn-ghost" href="#/r/${esc(r.key)}">${icon('back')}К рецепту</a></div>
    <h1 class="h1" style="margin-bottom:20px">Редактирование</h1>
    <form class="edit-form" id="edit">
      <label class="field"><span>Название</span><input class="input" name="title" required value="${esc(r.title)}"></label>
      <label class="field"><span>Описание</span><textarea class="textarea" name="description" rows="2" style="min-height:72px">${esc(r.description || '')}</textarea></label>
      <div class="edit-grid-2">
        <label class="field"><span>Порций</span><input class="input" name="servings" inputmode="decimal" value="${esc(num(r.servings))}"></label>
        <label class="field"><span>Порции текстом</span><input class="input" name="servings_text" value="${esc(r.servings_text || '')}" placeholder="форма 22 см"></label>
      </div>
      <div class="edit-grid-3">
        <label class="field"><span>Подготовка, мин</span><input class="input" name="prep" inputmode="numeric" value="${esc(r.prep_time_min ?? '')}"></label>
        <label class="field"><span>Готовка, мин</span><input class="input" name="cook" inputmode="numeric" value="${esc(r.cook_time_min ?? '')}"></label>
        <label class="field"><span>Всего, мин</span><input class="input" name="total" inputmode="numeric" value="${esc(r.total_time_min ?? '')}"></label>
      </div>
      <fieldset class="fieldset"><legend>Ингредиенты</legend><div class="rows" id="ing-rows">${(r.ingredients || []).map(ingRow).join('')}</div>
        <button type="button" class="btn" id="add-ing" style="justify-self:start">${icon('plus')}Ингредиент</button></fieldset>
      <fieldset class="fieldset"><legend>Шаги</legend><div class="rows" id="step-rows">${(r.steps || []).map(stepRow).join('')}</div>
        <button type="button" class="btn" id="add-step" style="justify-self:start">${icon('plus')}Шаг</button></fieldset>
      <label class="field"><span>Советы автора — по одному на строку</span><textarea class="textarea" name="tips" rows="3">${esc((r.tips || []).join('\n'))}</textarea></label>
      <fieldset class="fieldset"><legend>Категории</legend><div class="chips" style="flex-wrap:wrap;margin:0;padding:0" id="cats">
        ${CATEGORIES.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${(r.categories || []).includes(c)}">${esc(c)}</button>`).join('')}</div></fieldset>
      <label class="field"><span>Теги через запятую</span><input class="input" name="tags" value="${esc((r.tags || []).join(', '))}"></label>
      <div class="edit-grid-2">
        <label class="field"><span>Ссылка на источник</span><input class="input" name="source_url" value="${esc(r.source_url || '')}"></label>
        <label class="field"><span>Автор</span><input class="input" name="author" value="${esc(r.author || '')}"></label>
      </div>
      <label class="field"><span>Что нужно уточнить — по одному на строку</span><textarea class="textarea" name="issues" rows="3">${esc((r.issues || []).join('\n'))}</textarea></label>
      <label class="check"><input type="checkbox" name="needs_review" ${r.needs_review ? 'checked' : ''}> Пометка «Нужно уточнить»</label>
      <p class="form-error" id="edit-err" hidden></p>
      <div class="sticky-actions"><a class="btn" href="#/r/${esc(r.key)}">Отмена</a><button class="btn btn-primary" type="submit">${icon('check')}Сохранить</button></div>
    </form>`;

  const form = $('#edit');
  $('#add-ing').addEventListener('click', () => { $('#ing-rows').insertAdjacentHTML('beforeend', ingRow()); $('#ing-rows .ing-row:last-child input').focus(); });
  $('#add-step').addEventListener('click', () => { $('#step-rows').insertAdjacentHTML('beforeend', stepRow()); $('#step-rows .step-row:last-child textarea').focus(); });
  form.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) rm.parentElement.remove();
    const cat = e.target.closest('[data-cat]');
    if (cat) cat.setAttribute('aria-pressed', cat.getAttribute('aria-pressed') !== 'true');
  });
  const toNum = (v) => { const s = String(v || '').trim().replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#edit-err');
    err.hidden = true;
    const ingredients = $$('#ing-rows .ing-row').map((row) => ({
      name: $('[name=i_name]', row).value.trim(),
      amount: toNum($('[name=i_amount]', row).value),
      amount_max: toNum($('[name=i_max]', row).value),
      unit: $('[name=i_unit]', row).value.trim() || null,
      note: $('[name=i_note]', row).value.trim() || null,
      group: $('[name=i_group]', row).value || null,
      shop_query: $('[name=i_q]', row).value || null,
    })).filter((i) => i.name);
    const steps = $$('#step-rows .step-row').map((row) => ({
      text: $('[name=s_text]', row).value.trim(),
      temperature_c: toNum($('[name=s_temp]', row).value),
      duration_min: toNum($('[name=s_dur]', row).value),
    })).filter((s) => s.text);
    const bad = [...ingredients.flatMap((i) => [i.amount, i.amount_max]), ...steps.flatMap((s) => [s.temperature_c, s.duration_min])].some((v) => Number.isNaN(v));
    const nums = ['servings', 'prep', 'cook', 'total'].map((n) => toNum(form[n].value));
    if (bad || nums.some((v) => Number.isNaN(v))) { err.textContent = 'В числовых полях должны быть только числа (например 1,5).'; err.hidden = false; return; }
    steps.forEach((s) => { if (s.temperature_c != null) s.temperature_c = Math.round(s.temperature_c); });
    const body = {
      title: form.title.value.trim(), description: form.description.value.trim() || null,
      servings: nums[0], servings_text: form.servings_text.value.trim() || null,
      prep_time_min: nums[1] != null ? Math.round(nums[1]) : null, cook_time_min: nums[2] != null ? Math.round(nums[2]) : null,
      total_time_min: nums[3] != null ? Math.round(nums[3]) : null,
      ingredients, steps,
      tips: form.tips.value.split('\n').map((s) => s.trim()).filter(Boolean),
      categories: $$('#cats [aria-pressed=true]').map((b) => b.dataset.cat),
      tags: form.tags.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      author: form.author.value.trim() || null, source_url: form.source_url.value.trim() || null,
      source_name: r.source_name, issues: form.issues.value.split('\n').map((s) => s.trim()).filter(Boolean),
      needs_review: form.needs_review.checked, favorite: !!r.favorite,
    };
    if (!body.title) { err.textContent = 'Укажите название.'; err.hidden = false; return; }
    try { await store.saveRecipe(r.key, body); toast('Сохранено'); location.hash = `#/r/${r.key}`; }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

// =====================================================================
// Привязка телефона (режим телефона)
// =====================================================================
async function renderPair(params) {
  const paired = await store.paired();
  const code = params.get('code') || '';
  const pc = params.get('pc') || (ORIGIN_IS_PC ? location.origin : '');
  if (paired && !code) { location.replace('#/system'); return; }
  view.innerHTML = `
    <header class="page-head"><h1 class="h1">Подключение к домашнему компьютеру</h1></header>
    <form class="add-panel" id="pair-form">
      <p style="margin:0">Рецепты хранятся на этом телефоне, а разбирает ссылки домашний компьютер. Подключите приложение один раз — дальше всё работает само, дома и вне дома.</p>
      <label class="field"><span>Адрес компьютера</span>
        <input class="input" name="pc" value="${esc(pc)}" placeholder="https://адрес-компьютера:порт" inputmode="url" autocomplete="off" required></label>
      <label class="field"><span>Код с компьютера</span>
        <input class="input" name="code" value="${esc(code)}" placeholder="8 символов" autocomplete="one-time-code" autocapitalize="characters" required></label>
      <label class="field"><span>Как назвать этот телефон</span>
        <input class="input" name="name" value="Телефон" maxlength="60"></label>
      <p class="form-error" id="pair-err" hidden></p>
      <button class="btn btn-primary" type="submit" style="justify-self:start">${icon('check')}Подключить</button>
      <p class="muted small" style="margin:0">Код и адрес показаны на компьютере: «Система → Телефоны → Подключить телефон». Код действует 15 минут.</p>
    </form>`;
  const form = $('#pair-form');
  const submit = async () => {
    const err = $('#pair-err');
    err.hidden = true;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await store.pair(form.pc.value.trim(), form.code.value.trim(), form.name.value.trim());
      toast('Телефон подключён');
      await renderConn();
      store.sync('paired');
      location.replace('#/system');
    } catch (e) {
      err.textContent = e.message.includes('Failed to fetch') || e.name === 'TypeError' || e.name === 'TimeoutError'
        ? 'Компьютер не отвечает по этому адресу. Проверьте адрес и что телефон в домашней Wi-Fi сети.' : e.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  if (code && pc && !paired) submit();
}

// =====================================================================
// Система
// =====================================================================
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('#install')?.removeAttribute('hidden'); });

async function renderSystem() {
  if (DEVICE) return renderDeviceSystem();
  view.innerHTML = `<header class="page-head"><h1 class="h1">Система</h1></header><div class="sys-grid" id="sys"><div class="skeleton"></div><div class="skeleton"></div></div>`;
  const [s, g, devs, net] = await Promise.all([store.system(), store.chains(), store.devices(), store.net().catch(() => null)]);
  $('#sys').innerHTML = phonesPanel(devs.items, net) + netPanel(net) + systemPanels(s, g);
  bindSystemPanels(g);
  bindPhonePanels();
}

function phonesPanel(devices, net) {
  const rows = devices.filter((d) => !d.revoked).map((d) => `<li style="display:flex;justify-content:space-between;gap:8px;align-items:center">
    <span><b>${esc(d.name)}</b><small class="muted" style="display:block">подключён ${esc(fmtDate(d.created_at))}, был на связи ${esc(fmtAgo(d.last_seen))}</small></span>
    <button class="btn btn-ghost" style="min-height:34px" data-revoke="${d.id}">Отключить</button></li>`).join('');
  return `<section class="panel wide"><h3>Телефоны с приложением</h3>
    <p class="small" style="margin:0">Приложение хранит рецепты на телефоне и отправляет ссылки сюда, когда видит компьютер — дома по Wi-Fi или через интернет.</p>
    ${rows ? `<ul class="errlist" style="gap:10px">${rows}</ul>` : '<p class="muted small" style="margin:0">Пока ни одного телефона.</p>'}
    <div class="btn-row"><button class="btn btn-primary" id="pair-new">${icon('plus')}Подключить телефон</button>
    <a class="btn" href="#/phone">Инструкция для телефона</a></div></section>`;
}

function netPanel(net) {
  if (!net) return '';
  const t = net.tls;
  return `<section class="panel"><h3>Внешний доступ</h3>
    <p class="small" style="margin:0">Чтобы приложение работало вне дома: укажите статический IP и пробросьте порт на роутере на ${esc(net.lan_ips[0] || 'этот компьютер')}:${net.https_port}.</p>
    <form id="net-form" style="display:grid;gap:8px">
      <label class="field"><span>Внешний адрес (статический IP или домен)</span><input class="input" name="host" value="${esc(net.public_host)}" placeholder="например 203.0.113.10"></label>
      <label class="field"><span>Внешний порт на роутере</span><input class="input" name="port" inputmode="numeric" value="${esc(net.public_port)}"></label>
      <button class="btn" type="submit" style="justify-self:start">Сохранить</button>
      <p class="form-error" id="net-err" hidden></p>
    </form>
    <dl class="kv"><dt>Дома</dt><dd>${esc(net.endpoints.lan.join(', ') || '—')}</dd>
      <dt>Из интернета</dt><dd>${esc(net.endpoints.wan.join(', ') || 'не настроено')}</dd>
      ${t ? `<dt>Сертификат до</dt><dd>${esc(fmtDate(t.valid_until))}</dd><dt>Отпечаток</dt><dd style="font-size:11px">${esc(t.ca_fingerprint.slice(0, 29))}…</dd>` : ''}</dl></section>`;
}

function bindPhonePanels() {
  $('#pair-new')?.addEventListener('click', showPairDialog);
  $$('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Отключить телефон?', 'Приложение на нём перестанет получать новые рецепты. Рецепты на телефоне останутся.', 'Отключить', true))) return;
    await store.revokeDevice(+b.dataset.revoke);
    toast('Телефон отключён');
    renderSystem();
  }));
  $('#net-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#net-err');
    err.hidden = true;
    try {
      const res = await store.setNet({ public_host: e.target.host.value.trim(), public_port: +e.target.port.value || 0 });
      toast(res.ca_changed ? 'Сохранено. Сертификат обновлён — его нужно заново установить на телефон.' : 'Сохранено', 5000);
      renderSystem();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

async function showPairDialog() {
  let code;
  try { code = await store.pairCode(); } catch (e) { toast(e.message); return; }
  const url = code.app_url;
  await openDialog(`
    <h3>Подключить телефон</h3>
    <p>Откройте камерой телефона этот код или введите в приложении:</p>
    ${url ? `<img src="api/qr?text=${encodeURIComponent(url)}" alt="QR-код для подключения" style="width:220px;height:220px;justify-self:center;border-radius:12px">` : ''}
    <div class="addr" style="text-align:center;letter-spacing:.12em">${esc(code.code.slice(0, 4))}-${esc(code.code.slice(4))}</div>
    <p class="small muted">Код действует 15 минут и подходит для одного телефона. ${url ? `Адрес приложения: ${esc(url.split('/#')[0])}` : ''}</p>
    <p class="small">Если телефон пишет, что подключение небезопасно, сначала установите на него сертификат — см. «Инструкция для телефона».</p>
    <form method="dialog" class="dialog-actions"><button class="btn" value="ok">Готово</button></form>`);
  renderSystem();
}

function systemPanels(s, g) {
  const o = s.ollama, gpu = s.gpu, w = s.whisper, q = s.queue.counts;
  const yes = (v, okText = 'да', badText = 'нет') => (v ? `<span class="ok">${okText}</span>` : `<span class="bad">${badText}</span>`);
  const memPct = gpu.ok ? Math.round((gpu.mem_used_mb / gpu.mem_total_mb) * 100) : 0;
  const lan = (s.lan_urls || []).map((u) => `<div class="addr">${esc(u)}</div>`).join('');
  return `
    ${DEVICE ? '' : `<section class="panel wide"><h3>Открыть в браузере телефона</h3>
      <p class="small" style="margin:0">Без установки приложения можно открыть в браузере телефона в домашней Wi-Fi сети:</p>
      ${lan || `<div class="addr">${esc(location.origin)}</div>`}
      <p class="small muted" style="margin:0">Не открывается? Тип сети на компьютере должен быть «Частная», а во VPN на компьютере и телефоне должен быть разрешён доступ к локальной сети. Подробно — в README.md.</p>
    </section>`}
    <section class="panel"><h3>Модель (Ollama) ${yes(o.ok && o.model_installed, 'работает', 'недоступна')}</h3>
      <dl class="kv"><dt>Адрес</dt><dd>${esc(o.url)}</dd><dt>Версия</dt><dd>${esc(o.version || '—')}</dd>
      <dt>Модель</dt><dd>${esc(o.model)}</dd><dt>Скачана</dt><dd>${yes(o.model_installed)}</dd>
      <dt>В видеопамяти</dt><dd>${o.loaded?.length ? o.loaded.map((m) => `${esc(m.name)} (${m.vram_mb} МБ)`).join(', ') : 'нет (загрузится при обработке)'}</dd></dl>
      ${o.error ? `<p class="form-error">${esc(o.error)}</p>` : ''}</section>
    <section class="panel"><h3>Видеокарта ${yes(gpu.ok, 'есть', 'не найдена')}</h3>
      ${gpu.ok ? `<dl class="kv"><dt>GPU</dt><dd>${esc(gpu.name)}</dd><dt>Драйвер</dt><dd>${esc(gpu.driver)}</dd>
      <dt>Память</dt><dd>${gpu.mem_used_mb} / ${gpu.mem_total_mb} МБ</dd><dt>Температура</dt><dd>${gpu.temp_c} °C</dd><dt>Загрузка</dt><dd>${gpu.util_pct}%</dd></dl>
      <div class="meter"><i style="width:${memPct}%"></i></div>` : `<p class="form-error">${esc(gpu.error)}</p>`}</section>
    <section class="panel"><h3>Распознавание речи ${yes(w.downloaded && w.cuda?.ok, 'готово', 'не готово')}</h3>
      <dl class="kv"><dt>Модель</dt><dd>Whisper ${esc(w.model)}</dd><dt>Скачана</dt><dd>${yes(w.downloaded)}</dd>
      <dt>CUDA для Whisper</dt><dd>${yes(w.cuda?.ok)}</dd><dt>Режим</dt><dd>${esc(w.device)} / ${esc(w.compute_type)}</dd>
      <dt>CTranslate2</dt><dd>${esc(w.cuda?.ctranslate2 || '—')}</dd></dl>
      ${w.cuda?.error ? `<p class="form-error">${esc(w.cuda.error)}</p>` : ''}</section>
    <section class="panel"><h3>Очередь</h3>
      <dl class="kv"><dt>В очереди</dt><dd>${q.queued || 0}</dd><dt>В работе</dt><dd>${(q.downloading || 0) + (q.transcribing || 0) + (q.extracting || 0)}</dd>
      <dt>Готово</dt><dd>${q.done || 0}</dd><dt>Нужно уточнить</dt><dd>${q.needs_review || 0}</dd><dt>Ошибки</dt><dd>${q.error || 0}</dd>
      <dt>Обработано с запуска</dt><dd>${s.queue.processed_since_start}</dd></dl></section>
    <section class="panel"><h3>Магазины</h3>
      <p class="small" style="margin:0">Адрес для подбора ближайших магазинов: <b>${esc(g.location?.label || '—')}</b></p>
      <form id="loc-form" class="add-row"><input class="input" name="q" placeholder="Город, улица, дом" autocomplete="street-address"><button class="btn" type="submit">Найти</button></form>
      <div id="loc-res" class="store-results"></div>
      <div id="chains" style="display:grid;gap:8px">${g.items.map(chainRow).join('')}</div></section>
    <section class="panel"><h3>Инструменты</h3>
      <dl class="kv"><dt>FFmpeg</dt><dd>${esc(s.tools.ffmpeg || 'не найден')}</dd><dt>yt-dlp</dt><dd>${esc(s.tools.yt_dlp)}</dd>
      <dt>Node.js (для YouTube)</dt><dd>${esc(s.tools.node || 'не найден')}</dd><dt>Свободно на диске</dt><dd>${s.disk_free_gb} ГБ</dd>
      <dt>Cookies</dt><dd>${s.cookies.length ? esc(s.cookies.join(', ')) : 'нет'}</dd></dl></section>
    <section class="panel"><h3>Резервные копии</h3>
      <dl class="kv"><dt>Последняя</dt><dd>${s.backup ? `${esc(fmtDate(s.backup.time))}, ${s.backup.size_kb} КБ` : 'ещё не было'}</dd></dl>
      <p class="small muted" style="margin:0">Копия делается автоматически раз в сутки в папку data\\backups на компьютере.</p>
      ${DEVICE ? '' : '<button class="btn" id="backup" style="justify-self:start">Сделать копию сейчас</button>'}</section>
    <section class="panel wide"><h3>Последние ошибки</h3>
      ${s.last_errors.length ? `<ul class="errlist">${s.last_errors.map((e) => `<li><time>${esc(fmtDate(e.ts))}${e.job_id ? `, задание ${e.job_id}` : ''}</time>${esc(e.message)}</li>`).join('')}</ul>` : '<p class="muted small" style="margin:0">Ошибок нет.</p>'}
      <p class="small muted" style="margin:0">Подробный журнал: data\\logs\\app.log на компьютере.</p></section>`;
}

function bindSystemPanels() {
  $('#backup')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await store.backup(); toast(`Копия сохранена: ${r.file}`); }
    catch (err) { toast(err.message); }
    e.target.disabled = false;
  });
  $('#chains')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-check]');
    const st = e.target.closest('[data-store]');
    if (b) {
      const out = $(`#chk-${b.dataset.check}`);
      out.innerHTML = '<span class="muted">Проверяю…</span>';
      try {
        const r = await store.groceryCheck(b.dataset.check);
        out.innerHTML = r.ok ? `<span class="ok">Работает</span>: найдено ${r.found} товаров за ${String(r.seconds).replace('.', ',')} с` : `<span class="bad">${esc(r.error)}</span>`;
      } catch (err) { out.innerHTML = `<span class="bad">${esc(err.message)}</span>`; }
    } else if (st) {
      await chooseStore(st.dataset.store, () => renderSystem());
    }
  });
  $('#loc-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#loc-res');
    const qv = e.target.q.value.trim();
    if (qv.length < 3) return;
    out.innerHTML = '<p class="muted small">Ищу адрес…</p>';
    try {
      const { items } = await store.geocode(qv);
      if (!items.length) { out.innerHTML = '<p class="muted small">Адрес не найден. Попробуйте «Город, улица, дом».</p>'; return; }
      out.innerHTML = items.map((it, k) => `<button type="button" data-k="${k}">${esc(it.label)}</button>`).join('');
      out.onclick = async (ev) => {
        const btn = ev.target.closest('[data-k]');
        if (!btn) return;
        out.innerHTML = '<p class="muted small">Подбираю ближайшие магазины…</p>';
        const it = items[+btn.dataset.k];
        await store.setLocation({ lat: it.lat, lon: it.lon, label: it.label.split(',').slice(0, 3).join(',') });
        toast('Адрес сохранён');
        renderSystem();
      };
    } catch (err) { out.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
  });
}

function chainRow(c) {
  const st = c.status;
  return `<div style="display:grid;gap:4px;padding:10px 12px;border:1px solid var(--line);border-radius:12px">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(c.name)}</b>
      <span class="btn-row"><button class="btn" style="min-height:34px" data-store="${c.id}">Магазин</button><button class="btn" style="min-height:34px" data-check="${c.id}">Проверить</button></span></div>
    <div class="small muted">${c.store ? esc(c.store.address || c.store.id) : 'магазин не выбран'}</div>
    <div class="small" id="chk-${c.id}">${st ? (st.ok ? '<span class="ok">Последний запрос успешен</span>' : `<span class="bad">${esc(st.message)}</span>`) : ''}</div>
  </div>`;
}

async function renderDeviceSystem() {
  const c = await store.connection();
  const state = c.conn?.state || 'unknown';
  view.innerHTML = `<header class="page-head"><h1 class="h1">Связь и система</h1></header>
    <div class="sys-grid" id="sys">
      <section class="panel wide"><h3>Домашний компьютер <span class="${['lan', 'wan'].includes(state) ? 'ok' : 'bad'}">${esc(CONN_TEXT[state] || state)}</span></h3>
        <dl class="kv">
          <dt>Телефон</dt><dd>${esc(c.device?.name || '—')}</dd>
          <dt>Адрес</dt><dd>${esc(c.conn?.endpoint || '—')}</dd>
          <dt>Последняя синхронизация</dt><dd>${esc(fmtAgo(c.lastSync))}</dd>
          <dt>Рецептов на телефоне</dt><dd>${c.recipes}</dd>
          <dt>Ждут отправки</dt><dd>${c.pending} ссыл. / ${c.dirty} правок</dd>
          <dt>Домашние адреса</dt><dd>${esc((c.endpoints.lan || []).join(', ') || '—')}</dd>
          <dt>Внешний адрес</dt><dd>${esc((c.endpoints.wan || []).join(', ') || 'не настроен на компьютере')}</dd>
        </dl>
        ${c.lastError && state === 'offline' ? `<p class="small muted" style="margin:0">${esc(c.lastError)}. Рецепты на телефоне доступны, новые ссылки ждут в очереди.</p>` : ''}
        ${c.authLost ? '<p class="form-error">Компьютер отключил этот телефон. Подключите заново.</p>' : ''}
        <div class="btn-row">
          <button class="btn btn-primary" id="sync-now">${icon('refresh')}Синхронизировать</button>
          <button class="btn" id="install" ${installEvent ? '' : 'hidden'}>${icon('plus')}Установить приложение</button>
          <a class="btn btn-ghost" href="#/pair?code=">Подключить заново</a>
        </div>
      </section>
      <div id="pc-panels" class="panel wide"><p class="muted small" style="margin:0">Состояние компьютера загружается…</p></div>
    </div>`;
  $('#sync-now').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const res = await store.sync('manual');
    e.target.disabled = false;
    toast(res.ok ? `Готово${res.changed ? `: обновлено ${res.changed}` : ''}` : res.error, 3500);
    renderDeviceSystem();
  });
  $('#install').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    $('#install').hidden = true;
  });
  try {
    const [s, g] = await Promise.all([store.system(), store.chains()]);
    const holder = $('#pc-panels');
    if (!holder) return;
    holder.outerHTML = systemPanels(s, g);
    bindSystemPanels();
  } catch (e) {
    const holder = $('#pc-panels');
    if (holder) holder.innerHTML = `<p class="muted small" style="margin:0">${esc(e.message)}</p>`;
  }
}

// =====================================================================
// Инструкция для телефона (режим ПК, открывается в браузере телефона)
// =====================================================================
async function renderPhoneSetup() {
  const net = await store.net();
  const lanApp = net.endpoints.lan[0];
  view.innerHTML = `
    <div class="topbar"><a class="btn btn-ghost" href="#/system">${icon('back')}Система</a></div>
    <h1 class="h1" style="margin-bottom:16px">Приложение на телефон</h1>
    <div class="edit-form">
      <section class="panel"><h3>1. Сертификат домашнего компьютера</h3>
        <p class="small" style="margin:0">Один раз — чтобы телефон доверял компьютеру. Сертификат подходит только для адресов домашней сети${net.public_host ? ` и ${esc(net.public_host)}` : ''} и не даёт доступа к другим сайтам.</p>
        <a class="btn btn-primary" href="ca.crt" download style="justify-self:start">Скачать сертификат</a>
        <ol class="small" style="margin:0;padding-left:18px;display:grid;gap:4px">
          <li>Откройте «Настройки → Безопасность → Шифрование и учётные данные → Установка сертификата → Сертификат ЦС» (на Samsung: «Биометрия и безопасность → Другие параметры безопасности → Установить из памяти»).</li>
          <li>Нажмите «Всё равно установить» и выберите скачанный файл recipes-home-ca.crt.</li>
          <li>Android попросит PIN-код экрана — это нормально.</li>
        </ol>
        <p class="small muted" style="margin:0">Отпечаток: ${esc(net.tls?.ca_fingerprint || '')}</p>
      </section>
      <section class="panel"><h3>2. Открыть и подключить приложение</h3>
        <p class="small" style="margin:0">Телефон должен быть в домашней Wi-Fi сети. Кнопка откроет приложение и сразу подключит его к компьютеру.</p>
        <button class="btn btn-primary" id="open-app" style="justify-self:start" ${lanApp ? '' : 'disabled'}>Открыть приложение</button>
        <p class="form-error" id="open-err" hidden></p>
      </section>
      <section class="panel"><h3>3. Установить на главный экран</h3>
        <p class="small" style="margin:0">В открывшемся приложении: меню Chrome «⋮ → Установить приложение» (или кнопка «Установить приложение» в разделе «Связь»). После установки в меню «Поделиться» появится «Рецепты» — так удобнее всего отправлять ссылки из YouTube и Instagram.</p>
      </section>
    </div>`;
  $('#open-app').addEventListener('click', async () => {
    try {
      const code = await store.pairCode();
      location.href = code.app_url + '&name=' + encodeURIComponent('Телефон');
    } catch (e) { $('#open-err').textContent = e.message; $('#open-err').hidden = false; }
  });
}

// ---------- Старт ----------
async function start() {
  await store.init();
  if (DEVICE) {
    document.querySelector('[data-nav="system"] span').textContent = 'Связь';
    connEl.addEventListener('click', () => { location.hash = '#/system'; });
    await store.core.kv.set('originIsPc', ORIGIN_IS_PC);
    if ('serviceWorker' in navigator && (isSecureContext || NATIVE)) {
      navigator.serviceWorker.register('sw.js', { type: 'module', scope: './' }).catch((e) => console.warn('SW', e));
    }
    store.core.channel?.addEventListener('message', async (ev) => {
      const t = ev.data?.type;
      if (t === 'conn' || t === 'outbox' || t === 'synced' || t === 'sync-error') renderConn();
      if (t === 'outbox' || t === 'synced') refreshBadge();
      if (t === 'synced' && ev.data.changed) {
        const { path } = parseHash();
        if (path === '/' || path === '') loadList().catch(() => {});
      }
      if (t === 'image') hydrateImages();
      if (t === 'auth') toast('Компьютер отключил этот телефон — подключите его заново', 5000);
    });
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      await store.sync('tick');
    };
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    setInterval(async () => { if ((await store.activeCount()) > 0) tick(); }, 8000);
    setInterval(tick, 60000);
    renderConn();
    tick();
  }
  route();
  refreshBadge();
}
start();
