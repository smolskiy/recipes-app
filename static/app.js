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
  if (url) {
    img.onload = () => img.closest('.dish, .hero-img')?.classList.add('loaded');
    img.onerror = () => img.closest('.dish, .hero-img')?.classList.add('noimg');
    img.src = url;
  } else img.closest('.dish, .hero-img')?.classList.add('noimg');
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
const isOnline = (state) => state === 'lan' || state === 'wan';
function connState(c) {
  if (!c.paired) return 'unpaired';
  if (c.authLost) return 'auth';
  return c.conn?.state || 'unknown';
}
const queueText = (n) => `${n} ${plural(n, ['ссылка ждёт', 'ссылки ждут', 'ссылок ждут'])} отправки`;

// Строка состояния над меню: видна всегда, чтобы было понятно, доступен ли компьютер прямо сейчас.
async function renderConn() {
  if (!DEVICE) return;
  const c = await store.connection();
  const state = connState(c);
  const navItem = document.querySelector('[data-nav="system"]');
  navItem.dataset.conn = state === 'auth' ? 'unpaired' : state;
  navItem.title = `${CONN_TEXT[state] || ''}${c.lastSync ? `, синхронизация ${fmtAgo(c.lastSync)}` : ''}`;
  let main;
  let extra = '';
  if (state === 'unpaired') main = 'Приложение не подключено к компьютеру';
  else if (state === 'auth') main = 'Компьютер отключил этот телефон — подключите заново';
  else if (isOnline(state) && c.conn?.paused) {
    main = 'Компьютер на связи · обработка на паузе';
    extra = c.pending ? queueText(c.pending) : 'ссылки подождут';
  } else if (isOnline(state)) main = `Компьютер на связи · ${state === 'lan' ? 'дома' : 'через интернет'}`;
  else if (state === 'offline') {
    main = c.conn?.reason === 'nonet' ? 'Нет интернета на телефоне' : 'Компьютер недоступен';
    extra = c.pending ? queueText(c.pending) : c.lastOnline ? `был на связи ${fmtAgo(c.lastOnline)}` : 'рецепты на телефоне доступны';
  } else main = 'Проверяю связь с компьютером…';
  connEl.dataset.state = state;
  connEl.dataset.paused = isOnline(state) && c.conn?.paused ? '1' : '';
  connEl.innerHTML = `<i class="dot" aria-hidden="true"></i><span>${esc(main)}</span>${extra ? `<small>${esc(extra)}</small>` : ''}`;
  connEl.hidden = false;
  document.body.classList.add('has-conn');
}

// ---------- Маршрутизация ----------
let currentCleanup = null;
async function route() {
  closeCook?.();
  currentCleanup?.();
  currentCleanup = null;
  const { path, params } = parseHash();
  const parts = path.split('/').filter(Boolean);
  document.body.dataset.route = parts[0] || 'list';
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
      <h1 class="h1">Что готовим?</h1>
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
      : `<div class="empty"><span class="plate" aria-hidden="true"><i></i></span><p>Здесь пока пусто. Добавьте ссылку на рецепт с сайта, YouTube или Instagram — он появится тут в едином виде.</p><a class="btn btn-primary" href="#/add">${icon('plus')}Добавить рецепт</a></div>`;
    return;
  }
  box.innerHTML = `<div class="list">${data.items.map(cardHtml).join('')}</div>`;
  hydrateImages(box);
}

// Тарелка вместо фото: белая эмаль с кобальтовой каймой, в центре — первая буква; фон — по категории.
const CAT_TINT = { 'Выпечка': 'butter', 'Десерты': 'butter', 'Завтраки': 'butter', 'Супы': 'tomato', 'Основные блюда': 'tomato',
  'Салаты': 'dill', 'Закуски': 'dill', 'Гарниры': 'dill', 'Напитки': 'cobalt', 'Соусы': 'cobalt' };
function plateHtml(r, big = false) {
  const letter = (r.title || '?').trim()[0]?.toUpperCase() || '?';
  const tint = CAT_TINT[(r.categories || [])[0]] || 'cobalt';
  return `<span class="plate ${big ? 'big' : ''}" data-tint="${tint}" aria-hidden="true"><i>${esc(letter)}</i></span>`;
}

function cardHtml(r) {
  const time = fmtMin(r.total_time_min);
  const meta = [];
  if (time) meta.push(`<span>${icon('clock')}${esc(time)}</span>`);
  if (r.servings) meta.push(`<span>${icon('people')}${esc(fmtAmount(r.servings))}</span>`);
  if (!meta.length && r.source_name) meta.push(`<span>${esc(r.source_name.split(',')[0])}</span>`);
  return `<a class="card" href="#/r/${esc(r.key)}">
    <div class="dish">${plateHtml(r)}${r.image ? `<img data-img="${esc(r.image)}" alt="" loading="lazy">` : ''}
      ${r.favorite ? `<span class="fav" title="В избранном">${icon('heart-fill')}</span>` : ''}
      ${r.needs_review ? `<span class="review-dot" title="Нужно уточнить">${icon('warn')}</span>` : ''}</div>
    <p class="card-title">${esc(r.title)}</p>
    ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
  </a>`;
}

// =====================================================================
// Рецепт
// =====================================================================
async function renderRecipe(key) {
  const { recipe: r } = await store.getRecipe(key);
  let scale = 1;
  const baseServ = r.servings;
  const checked = new Set(); // отмеченные ингредиенты — общие для страницы и режима готовки

  const total = r.total_time_min || ((r.prep_time_min || 0) + (r.cook_time_min || 0)) || null;
  const issues = r.issues || [];
  const steps = r.steps || [];
  const ingredients = r.ingredients || [];
  const facts = [];
  const timeLabel = r.prep_time_min && r.cook_time_min ? 'всего' : r.cook_time_min ? 'готовка' : r.prep_time_min ? 'подготовка' : 'всего';
  if (total) facts.push(`<div><b>${esc(fmtMin(total))}</b><span>${timeLabel}</span></div>`);
  if (baseServ) facts.push(`<div><b id="fact-serv">${esc(fmtAmount(baseServ))}</b><span>${esc(plural(Math.round(baseServ), ['порция', 'порции', 'порций']))}</span></div>`);
  if (ingredients.length) facts.push(`<div><b>${ingredients.length}</b><span>${plural(ingredients.length, ['ингредиент', 'ингредиента', 'ингредиентов'])}</span></div>`);
  if (!total && steps.length) facts.push(`<div><b>${steps.length}</b><span>${plural(steps.length, ['шаг', 'шага', 'шагов'])}</span></div>`);
  const source = r.source_url
    ? `<a class="source-link" href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">${icon(r.source_kind && r.source_kind !== 'web' ? 'play' : 'link')}${esc(r.source_name || hostOf(r.source_url))}</a>`
    : (r.source_name ? `<span class="source-link">${esc(r.source_name)}</span>` : '');

  view.innerHTML = `
    <div class="recipe-top">
      <a class="round-btn" href="#/" aria-label="К рецептам">${icon('back')}</a>
      <div class="recipe-actions">
        <button class="round-btn" id="fav" aria-pressed="${!!r.favorite}" aria-label="${r.favorite ? 'Убрать из избранного' : 'В избранное'}">${icon(r.favorite ? 'heart-fill' : 'heart')}</button>
        <a class="round-btn" href="#/r/${esc(r.key)}/edit" aria-label="Изменить">${icon('edit')}</a>
        <button class="round-btn" id="more" aria-label="Ещё">${icon('more')}</button>
      </div>
    </div>
    <section class="recipe-hero ${r.image ? 'has-img' : 'no-img'}">
      <div class="hero-img">${plateHtml(r, true)}${r.image ? `<img data-img="${esc(r.image)}" alt="">` : ''}</div>
      <div class="hero-text">
        <h1 class="recipe-title">${esc(r.title)}</h1>
        ${r.description ? `<p class="lead">${esc(r.description)}</p>` : ''}
        ${source || r.author ? `<p class="byline">${source}${r.author && !(r.source_name || '').includes(r.author) ? `<span>автор: ${esc(r.author)}</span>` : ''}</p>` : ''}
        ${facts.length ? `<div class="facts">${facts.join('')}</div>` : ''}
        ${steps.length ? `<button class="btn btn-primary btn-big btn-cook" id="cook" type="button">${icon('play')}Готовить по шагам</button>` : ''}
        ${(r.categories || []).length || (r.tags || []).length ? `<div class="tags">${(r.categories || []).map((c) => `<span class="tag cat">${esc(c)}</span>`).join('')}${(r.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </section>
    ${(r.needs_review || issues.length) ? `
      <div class="notice">${icon('warn')}<div>
        <b>${r.needs_review ? 'Нужно уточнить' : 'Замечания'}</b>
        ${issues.length ? `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      </div></div>` : ''}
    <nav class="recipe-tabs" aria-label="Разделы рецепта">
      <a href="#sec-ing" data-sec="sec-ing">Ингредиенты</a><a href="#sec-steps" data-sec="sec-steps">Шаги</a><a href="#sec-shop" data-sec="sec-shop">Купить</a>
    </nav>
    <div class="recipe-body">
      <div class="recipe-side">
        <section class="section" id="sec-ing" aria-labelledby="h-ing">
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
        <section class="receipt-wrap" id="sec-shop" aria-labelledby="h-shop">
          <div class="section-head"><h2 class="h2" id="h-shop">Что купить</h2></div>
          <div class="store-switch" id="chain-switch" role="group" aria-label="Магазин"></div>
          <div class="receipt" id="receipt"><div class="rc-loading">Подбираю товары…<div class="bar"></div></div></div>
        </section>
      </div>
      <div class="recipe-main">
        <section class="section" id="sec-steps" aria-labelledby="h-steps">
          <h2 class="h2" id="h-steps">Приготовление</h2>
          ${steps.length ? `<ol class="steps">${steps.map(stepHtml).join('')}</ol>` : '<p class="muted">Шаги не указаны. Их можно дописать вручную.</p>'}
        </section>
        ${(r.tips || []).length ? `<section class="section tips-sec"><h2 class="h2">Советы автора</h2><ul class="tips">${r.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}
        <details class="raw" id="raw"><summary>Исходный текст</summary><pre>Загрузка…</pre></details>
        <p class="muted small added">Добавлен ${esc(fmtDate(r.created_at))}${r.updated_at && r.updated_at !== r.created_at ? `, изменён ${esc(fmtDate(r.updated_at))}` : ''}</p>
      </div>
    </div>`;
  hydrateImages();

  const renderIngs = () => {
    $('#ings').innerHTML = ingredients.length ? ingListHtml(ingredients, scale, checked) : '<p class="muted">Ингредиенты не указаны.</p>';
    $('#scale-out').textContent = baseServ ? servingsText(r, scale) : `× ${fmtAmount(scale)}`;
    if ($('#fact-serv') && baseServ) $('#fact-serv').textContent = fmtAmount(Math.round(baseServ * scale * 10) / 10);
  };
  renderIngs();
  $('#ings').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-i]');
    if (cb) cb.checked ? checked.add(+cb.dataset.i) : checked.delete(+cb.dataset.i);
  });

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

  // Вкладки: прокрутка к разделу и подсветка текущего.
  const tabs = $('.recipe-tabs');
  tabs.addEventListener('click', (e) => {
    const a = e.target.closest('[data-sec]');
    if (!a) return;
    e.preventDefault();
    const sec = document.getElementById(a.dataset.sec);
    window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY - tabs.offsetHeight - 12, behavior: 'smooth' });
  });
  const spy = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) $$('[data-sec]', tabs).forEach((a) => a.toggleAttribute('aria-current', a.dataset.sec === en.target.id));
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  ['sec-ing', 'sec-steps', 'sec-shop'].forEach((id) => spy.observe(document.getElementById(id)));
  currentCleanup = () => spy.disconnect();

  $('#cook')?.addEventListener('click', () => openCook(r, () => scale, checked, () => renderIngs()));
  $('.steps')?.addEventListener('click', (e) => {
    const t = e.target.closest('[data-timer]');
    if (t) startTimer(+t.dataset.timer, `${r.title}: шаг ${+t.dataset.step + 1}`);
  });

  const favBtn = $('#fav');
  favBtn.addEventListener('click', async () => {
    const value = !r.favorite;
    try {
      await store.setFavorite(r.key, value);
      r.favorite = value;
      favBtn.setAttribute('aria-pressed', value);
      favBtn.innerHTML = icon(value ? 'heart-fill' : 'heart');
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

function ingListHtml(ingredients, scale, checked) {
  let group = null;
  const rows = [];
  ingredients.forEach((ing, i) => {
    if (ing.group && ing.group !== group) { group = ing.group; rows.push(`</ul><div class="ing-group">${esc(group)}</div><ul class="ing">`); }
    const q = fmtQty(ing, scale);
    rows.push(`<li><label><input type="checkbox" data-i="${i}" ${checked.has(i) ? 'checked' : ''}>
      <span class="ing-name">${esc(ing.name)}${ing.note ? `<span class="ing-note">${esc(ing.note)}</span>` : ''}</span>
      <span class="ing-qty ${q ? '' : 'unknown'}">${q ? esc(q) : (ing.note && /вкус/i.test(ing.note) ? '' : 'не указано')}</span></label></li>`);
  });
  return `<ul class="ing">${rows.join('')}</ul>`.replace('<ul class="ing"></ul>', '');
}

function stepHtml(s, i) {
  const meta = [];
  if (s.temperature_c != null) meta.push(`<span class="hot">${icon('flame')}${s.temperature_c} °C</span>`);
  if (s.duration_min != null) {
    meta.push(`<button type="button" class="timer-chip" data-timer="${Math.round(s.duration_min * 60)}" data-step="${i}" title="Запустить таймер">${icon('clock')}${esc(fmtMin(Math.round(s.duration_min)) || `${s.duration_min} мин`)}</button>`);
  }
  return `<li><div><p class="step-text">${esc(s.text)}</p>${meta.length ? `<div class="step-meta">${meta.join('')}</div>` : ''}</div></li>`;
}

// =====================================================================
// Таймеры шагов: идут, даже если закрыть режим готовки; по окончании — звук, вибрация и сообщение.
// =====================================================================
const timers = [];
let timerTick = null;
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.32);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* звук недоступен */ }
}
function renderTimers() {
  const now = Date.now();
  const html = timers.map((t) => `<button type="button" class="timer-pill ${t.end <= now ? 'done' : ''}" data-cancel="${t.id}" title="${esc(t.label)}">
    ${icon('clock')}<span>${t.end <= now ? 'Готово' : fmtClock((t.end - now) / 1000)}</span></button>`).join('');
  $$('.timer-tray').forEach((tray) => { tray.innerHTML = html; tray.hidden = !timers.length; });
}
function startTimer(seconds, label) {
  if (!seconds) return;
  timers.push({ id: Math.random().toString(36).slice(2), end: Date.now() + seconds * 1000, label, fired: false });
  toast(`Таймер на ${fmtClock(seconds)} запущен`);
  if (!timerTick) {
    timerTick = setInterval(() => {
      const now = Date.now();
      for (const t of timers) {
        if (!t.fired && t.end <= now) {
          t.fired = true;
          beep();
          navigator.vibrate?.([400, 200, 400, 200, 400]);
          toast(`Время вышло: ${t.label}`, 8000);
        }
      }
      // Сработавшие таймеры висят минуту, потом исчезают.
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].end < now - 60000) timers.splice(i, 1);
      if (!timers.length) { clearInterval(timerTick); timerTick = null; }
      renderTimers();
    }, 1000);
  }
  renderTimers();
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cancel]');
  if (!b) return;
  const i = timers.findIndex((t) => t.id === b.dataset.cancel);
  if (i < 0) return;
  if (timers[i].end <= Date.now() || await confirmDialog('Остановить таймер?', timers[i].label, 'Остановить')) {
    timers.splice(i, 1);
    renderTimers();
  }
});

// =====================================================================
// Режим «Готовить по шагам»: один шаг на экран, крупно; экран не гаснет.
// Кнопка «Назад» телефона закрывает режим, а не уходит со страницы рецепта.
// =====================================================================
let closeCook = null;
async function openCook(r, getScale, checked, onChecked) {
  const steps = r.steps || [];
  if (!steps.length) return;
  let idx = 0;
  let wake = null;
  const el = document.createElement('div');
  el.className = 'cook';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `Готовим: ${r.title}`);
  document.body.append(el);
  document.body.classList.add('cooking');

  const lockScreen = async () => {
    try { wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; }
  };
  lockScreen();
  const onVisible = () => { if (document.visibilityState === 'visible' && el.isConnected) lockScreen(); };
  document.addEventListener('visibilitychange', onVisible);

  const draw = () => {
    const s = steps[idx];
    const last = idx === steps.length - 1;
    el.innerHTML = `
      <header class="cook-head">
        <button class="round-btn" data-c="close" aria-label="Закрыть">${icon('back')}</button>
        <div class="cook-title"><b>${esc(r.title)}</b><span>Шаг ${idx + 1} из ${steps.length}</span></div>
        <button class="round-btn" data-c="ings" aria-label="Ингредиенты">${icon('cart')}</button>
      </header>
      <div class="cook-progress" aria-hidden="true">${steps.map((_, k) => `<i class="${k < idx ? 'past' : k === idx ? 'now' : ''}"></i>`).join('')}</div>
      <div class="timer-tray" hidden></div>
      <main class="cook-step">
        <span class="cook-num" aria-hidden="true">${idx + 1}</span>
        <p>${esc(s.text)}</p>
        <div class="cook-meta">
          ${s.temperature_c != null ? `<span class="hot">${icon('flame')}${s.temperature_c} °C</span>` : ''}
          ${s.duration_min != null ? `<button type="button" class="btn btn-big" data-c="timer">${icon('clock')}Таймер ${esc(fmtMin(Math.round(s.duration_min)) || `${s.duration_min} мин`)}</button>` : ''}
        </div>
      </main>
      <footer class="cook-nav">
        <button class="btn btn-big" data-c="prev" ${idx ? '' : 'disabled'}>Назад</button>
        <button class="btn btn-primary btn-big" data-c="${last ? 'done' : 'next'}">${last ? 'Готово' : 'Дальше'}</button>
      </footer>
      <div class="cook-sheet" hidden>
        <div class="cook-sheet-head"><h2 class="h2">Ингредиенты</h2><button class="round-btn" data-c="ings-close" aria-label="Закрыть">×</button></div>
        <div class="cook-ings">${ingListHtml(r.ingredients || [], getScale(), checked)}</div>
      </div>`;
    renderTimers();
  };
  const onPop = () => { if (el.isConnected) close(true); };
  const close = (fromHistory = false) => {
    if (!el.isConnected) return;
    wake?.release?.().catch(() => {});
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    document.body.classList.remove('cooking');
    el.remove();
    closeCook = null;
    onChecked();
    if (!fromHistory && history.state?.cook) history.back();
  };
  closeCook = () => close(true);
  history.pushState({ cook: true }, '');
  window.addEventListener('popstate', onPop);
  const go = (d) => { idx = Math.max(0, Math.min(steps.length - 1, idx + d)); draw(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (c === 'close') close();
    else if (c === 'next') go(1);
    else if (c === 'prev') go(-1);
    else if (c === 'done') { close(); toast('Приятного аппетита!', 3000); }
    else if (c === 'timer') startTimer(Math.round(steps[idx].duration_min * 60), `${r.title}: шаг ${idx + 1}`);
    else if (c === 'ings') $('.cook-sheet', el).hidden = false;
    else if (c === 'ings-close') $('.cook-sheet', el).hidden = true;
  });
  el.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-i]');
    if (cb) cb.checked ? checked.add(+cb.dataset.i) : checked.delete(+cb.dataset.i);
  });
  // Свайп влево-вправо — следующий/предыдущий шаг.
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.target.closest('.cook-sheet') ? null : e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
    x0 = null;
  });
  draw();
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
  // Из закладки «В рецепты»: текст открытой в браузере страницы и её адрес.
  const presetText = params.get('text') || '';
  const presetSrc = params.get('src') || '';
  if (presetText) { addMode = 'text'; history.replaceState(null, '', '#/add'); }
  if (params.get('shared')) toast('Ссылка добавлена в очередь', 3000);
  const canPaste = !!navigator.clipboard?.readText;
  view.innerHTML = `
    <header class="page-head"><h1 class="h1">Новый рецепт</h1></header>
    <form class="add-panel" id="add-form" novalidate>
      <div class="seg" role="group" aria-label="Что добавить">
        <button type="button" data-mode="url" aria-pressed="${addMode === 'url'}">${icon('link')}Ссылка</button>
        <button type="button" data-mode="text" aria-pressed="${addMode === 'text'}">${icon('text')}Текст</button>
      </div>
      <div class="add-row" id="mode-url" ${addMode === 'url' ? '' : 'hidden'}>
        <label class="paste-field"><span class="sr-only">Ссылка</span>
          <input class="input" name="url" type="url" inputmode="url" placeholder="Ссылка на рецепт" value="${esc(preset)}" autocomplete="off" enterkeyhint="go">
          ${canPaste ? '<button type="button" class="paste-btn" id="paste">Вставить</button>' : ''}</label>
        <button class="btn btn-primary btn-big" type="submit">${icon('plus')}Добавить</button>
      </div>
      <div id="mode-text" class="field" ${addMode === 'text' ? '' : 'hidden'}>
        <label class="field"><span class="sr-only">Текст рецепта</span>
          <textarea class="textarea" name="text" rows="8" placeholder="Скопируйте сюда текст рецепта — описание под видео, сообщение из чата, страницу из книги">${esc(presetText)}</textarea></label>
        ${presetSrc ? `<p class="src-note">${icon('link')}Текст со страницы <b>${esc(hostOf(presetSrc))}</b> — ссылка сохранится у рецепта</p>` : ''}
        <button class="btn btn-primary btn-big" type="submit" style="justify-self:start">${icon('text')}Разобрать текст</button>
      </div>
      <p class="form-error" id="add-err" hidden></p>
      <div class="sources" aria-label="Откуда можно добавлять">
        ${['Сайты с рецептами', 'YouTube', 'Instagram', 'TikTok', 'VK Видео', 'Rutube'].map((s) => `<span>${s}</span>`).join('')}
      </div>
      <p class="add-hint">${DEVICE
        ? (IOS ? 'На iPhone: скопируйте ссылку в YouTube или Instagram и нажмите «Вставить». ' : 'Удобнее всего — «Поделиться → Рецепты» прямо из YouTube или Instagram. ')
          + 'Без связи с компьютером ссылка подождёт в очереди и уйдёт сама.'
        : 'Рецепт разбирает этот компьютер, обычно за 1–3 минуты.'}</p>
      <details class="limits"><summary>Сайт «пускает только браузеры»?</summary>${browserOnlyHelp()}</details>
      ${limits ? `<details class="limits"><summary>Ограничения</summary><ul>
        <li>Видео до ${limits.max_video_minutes} минут — у более длинных используются только описание и субтитры.</li>
        <li>Аудио до ${limits.max_audio_mb} МБ, видео для чтения кадров до ${limits.max_video_mb} МБ, не больше ${limits.max_frames} кадров.</li>
        <li>Страница сайта до ${limits.max_page_mb} МБ, текст до ${limits.max_text_chars.toLocaleString('ru-RU')} символов.</li>
        <li>Одно задание обрабатывается не дольше ${limits.job_timeout_min} минут, при сбое сети — до ${limits.max_attempts} попыток.</li>
        <li>Ссылки на домашнюю сеть и служебные адреса не принимаются.</li></ul></details>` : ''}
    </form>
    <h2 class="h2 jobs-head">Очередь и история</h2>
    <div class="jobs" id="jobs"></div>`;

  const form = $('#add-form');
  if (presetSrc) form.dataset.src = presetSrc;
  $('.bookmarklet')?.addEventListener('click', (e) => { e.preventDefault(); toast('Перетащите кнопку на панель закладок браузера', 3500); });
  $$('.seg button', form).forEach((b) => b.addEventListener('click', () => {
    addMode = b.dataset.mode;
    $$('.seg button', form).forEach((x) => x.setAttribute('aria-pressed', x.dataset.mode === addMode));
    $('#mode-url').hidden = addMode !== 'url';
    $('#mode-text').hidden = addMode !== 'text';
    $(addMode === 'url' ? 'input[name=url]' : 'textarea[name=text]').focus();
  }));
  $('#paste')?.addEventListener('click', async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const url = text.match(/https?:\/\/\S+/)?.[0];
      if (url) { form.url.value = url; await submitJob(form, false); }
      else if (text.length > 40) { $('[data-mode=text]', form).click(); form.text.value = text; }
      else toast('В буфере нет ссылки — скопируйте её в YouTube, Instagram или браузере', 3500);
    } catch {
      form.url.focus();
      toast('Нет доступа к буферу — нажмите на поле и выберите «Вставить»', 3500);
    }
  });
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
  const body = addMode === 'url' ? { url: form.url.value.trim(), force }
    : { text: form.text.value.trim(), force, ...(form.dataset.src ? { source_url: form.dataset.src } : {}) };
  if (!(body.url || body.text)) { err.textContent = addMode === 'url' ? 'Вставьте ссылку' : 'Вставьте текст рецепта'; err.hidden = false; return; }
  try {
    await store.addJob(body);
    form.reset();
    delete form.dataset.src;
    $('.src-note')?.remove();
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

// Сайты с защитой от программ (например, lenta.com) отдают страницу только браузеру. Тогда рецепт отправляет
// сам браузер: выделенный текст через «Поделиться», вставка из буфера или закладка «В рецепты» на компьютере.
function bookmarkletHref() {
  const target = `${location.origin}${location.pathname}#/add?src=`;
  return `javascript:(function(){var t=(String(getSelection())||document.body.innerText).slice(0,40000);`
    + `window.open('${target}'+encodeURIComponent(location.href)+'&text='+encodeURIComponent(t),'_blank')})()`;
}

function browserOnlyHelp() {
  const phone = `<li><b>Android:</b> откройте рецепт в браузере, выделите его текст и нажмите «Поделиться → Рецепты».</li>
    <li><b>iPhone:</b> выделите и скопируйте текст рецепта, затем здесь нажмите «Вставить».</li>`;
  return `<ul>${phone}
    ${DEVICE ? '' : `<li><b>Компьютер:</b> перетащите эту кнопку на панель закладок браузера —
      <a class="bookmarklet" href="${esc(bookmarkletHref())}">${icon('plus')}В рецепты</a>.
      Потом на странице с рецептом нажмите закладку: откроется эта страница с текстом, останется «Разобрать текст».
      Можно сначала выделить только сам рецепт.</li>`}</ul>
    <p class="muted">Ссылка на страницу сохранится у рецепта. Саму страницу программа не загружает — это делает ваш браузер.</p>`;
}

const JOB_ICON = { youtube: 'play', instagram: 'play', tiktok: 'play', vk: 'play', rutube: 'play', dzen: 'play', text: 'text' };
async function loadJobs() {
  const box = $('#jobs');
  if (!box) return;
  let items;
  try { items = await store.listJobs(); } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
  if (!items.length) { box.innerHTML = '<p class="muted jobs-empty">Здесь появятся добавленные ссылки и ход их разбора.</p>'; return; }
  box.innerHTML = items.map((j) => {
    const title = j.title || (j.kind === 'text' ? 'Текст рецепта' : hostOf(j.url));
    const done = ['done', 'needs_review', 'duplicate'].includes(j.status) && j.recipe_keys.length;
    // У готового рецепта «Повторить» не нужна: есть «Обработать заново» в самом рецепте.
    const canRetry = ['error', 'needs_review', 'rejected', 'duplicate'].includes(j.status) || (j.status === 'done' && !j.recipe_keys.length);
    const canDelete = !['downloading', 'transcribing', 'extracting'].includes(j.status);
    const active = ['downloading', 'transcribing', 'extracting'].includes(j.status);
    const statusCls = j.status === 'pending' ? 'queued' : j.status === 'duplicate' ? 'needs_review' : j.status === 'rejected' ? 'error' : j.status;
    const where = j.url ? `<a class="job-url" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(j.url))}</a>` : '';
    return `<article class="job s-${statusCls}">
      <span class="job-icon" aria-hidden="true">${icon(JOB_ICON[j.source_kind] || (j.kind === 'text' ? 'text' : 'link'))}</span>
      <div class="job-body">
        <div class="job-top"><span class="job-title">${esc(title)}</span><span class="status s-${statusCls}">${esc(j.status_label)}</span></div>
        <div class="job-sub">${where}<span>${esc(fmtDate(j.created_at))}${j.attempts > 1 ? `, попыток: ${j.attempts}` : ''}</span></div>
        ${active ? '<div class="job-bar" aria-hidden="true"><i></i></div>' : ''}
        ${j.stage_detail ? `<div class="job-detail">${esc(j.stage_detail)}</div>` : ''}
        ${j.error ? `<div class="job-error">${esc(j.error)}</div>` : ''}
        ${j.notes?.length ? `<div class="job-detail">${j.notes.map(esc).join('<br>')}</div>` : ''}
        ${done || canRetry || canDelete ? `<div class="btn-row">
          ${done ? j.recipe_keys.map((k, n) => `<a class="btn btn-primary" href="#/r/${esc(k)}">${j.recipe_keys.length > 1 ? `Рецепт ${n + 1}` : 'Открыть рецепт'}</a>`).join('') : ''}
          ${canRetry ? `<button class="btn" data-retry="${esc(j.key)}">${icon('refresh')}${j.status === 'duplicate' ? 'Добавить всё равно' : 'Повторить'}</button>` : ''}
          ${j.status === 'error' && !j.local ? `<button class="btn" data-src="${esc(j.key)}">${icon('text')}Что удалось получить</button>` : ''}
          ${canDelete ? `<button class="btn btn-ghost btn-icon" data-del="${esc(j.key)}" aria-label="Убрать из списка">${icon('trash')}</button>` : ''}
        </div>` : ''}
      </div>
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
const UA = navigator.userAgent;
const IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ANDROID = /Android/.test(UA);
const STANDALONE = NATIVE || navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const defaultName = () => (/iPhone/.test(UA) ? 'iPhone' : IOS ? 'iPad' : ANDROID ? 'Android' : 'Телефон');
const SHARE_ICON = '<svg class="inline-ico" aria-label="Поделиться"><use href="#i-share"/></svg>';

// iPhone хранит данные Safari и приложения с экрана «Домой» раздельно. Код из ссылки кладём в cookie на 15 минут
// (столько живёт код): если iOS перенесёт её в установленное приложение, оно подключится само; если нет —
// в приложении сканируют тот же QR-код.
const HANDOFF = 'recipes_pair';
const cookieAttrs = () => `; path=${location.pathname.replace(/[^/]*$/, '')}; secure; samesite=strict`;
function saveHandoff(pc, code) {
  document.cookie = `${HANDOFF}=${encodeURIComponent(JSON.stringify({ pc, code }))}; max-age=900${cookieAttrs()}`;
}
function readHandoff() {
  const m = document.cookie.match(new RegExp(`(?:^|; )${HANDOFF}=([^;]*)`));
  try { return m ? JSON.parse(decodeURIComponent(m[1])) : null; } catch { return null; }
}
function clearHandoff() { document.cookie = `${HANDOFF}=; max-age=0${cookieAttrs()}`; }

// Ссылка из QR-кода: «…/#/pair?pc=…&code=…» (приложение с GitHub Pages) или «https://ПК/#/pair?code=…».
function parsePairLink(text) {
  try {
    const u = new URL(String(text).trim());
    const q = new URLSearchParams(u.hash.split('?')[1] || '');
    const code = q.get('code');
    return code ? { pc: q.get('pc') || u.origin, code } : null;
  } catch { return null; }
}

function friendlyPairError(e) {
  return e.name === 'TypeError' || e.name === 'TimeoutError' || /fetch|network|load failed/i.test(e.message)
    ? 'Компьютер не отвечает по этому адресу. Проверьте, что он включён, и попробуйте ещё раз.' : e.message;
}

async function doPair(pc, code, name) {
  await store.pair(pc, code, name || defaultName());
  clearHandoff();
  history.replaceState(null, '', '#/pair?done=1'); // использованный код из адреса убираем
  await renderConn();
  store.sync('paired');
}

let jsqrLoading = null;
function loadJsQR() {
  return (jsqrLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'static/vendor/jsQR.js';
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => { jsqrLoading = null; reject(new Error('Не удалось загрузить распознавание QR-кода — проверьте интернет')); };
    document.head.append(s);
  }));
}

// Сканер QR-кода камерой: BarcodeDetector (Android Chrome) или jsQR (iPhone и остальные).
async function scanQr() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна в этом браузере — введите код вручную');
  let detector = null;
  if ('BarcodeDetector' in window) {
    try { if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch { /* нет */ }
  }
  const decodeLib = detector ? null : await loadJsQR();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    throw new Error(e.name === 'NotAllowedError'
      ? 'Нет доступа к камере. Разрешите камеру для этого приложения в настройках телефона или введите код вручную.'
      : 'Не удалось включить камеру — введите код вручную');
  }
  let done = false;
  let found = null;
  const closed = openDialog(`
    <h3>Наведите камеру на QR-код</h3>
    <div class="scan-box"><video playsinline muted autoplay></video><i class="scan-frame" aria-hidden="true"></i></div>
    <p class="small">QR-код — на экране компьютера: «Система → Подключить телефон».</p>
    <form method="dialog" class="dialog-actions"><button class="btn" value="cancel">Отмена</button></form>`);
  const video = $('video', dialog);
  video.srcObject = stream;
  video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (done) return;
    if (video.readyState >= 2 && video.videoWidth) {
      try {
        let text = null;
        if (detector) text = (await detector.detect(video))[0]?.rawValue || null;
        else {
          const k = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * k);
          canvas.height = Math.round(video.videoHeight * k);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          text = decodeLib(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
        }
        if (text) {
          const link = parsePairLink(text);
          if (link) { found = link; dialog.close('ok'); return; }
          toast('Это не QR-код подключения — откройте его на компьютере в «Система → Подключить телефон»', 3500);
        }
      } catch { /* кадр не распознан */ }
    }
    setTimeout(tick, 180);
  };
  tick();
  await closed;
  done = true;
  stream.getTracks().forEach((t) => t.stop());
  return found;
}

const pairHead = (title) => `<header class="page-head"><h1 class="h1">${esc(title)}</h1></header>`;

async function renderPair(params) {
  const paired = await store.paired();
  let code = params.get('code') || '';
  let pc = params.get('pc') || (ORIGIN_IS_PC ? location.origin : '');
  const again = params.has('again');
  if (paired && !code && !again) { location.replace('#/system'); return; }
  let fromHandoff = false;
  if (!code && !paired) {
    const h = readHandoff();
    if (h?.code && h?.pc) { ({ code, pc } = h); fromHandoff = true; }
  }
  // iPhone в Safari: подключение в Safari не перейдёт в приложение на экране «Домой» — сначала установка.
  if (code && pc && IOS && !STANDALONE && !params.has('safari')) {
    saveHandoff(pc, code);
    renderIosInstall(pc, code);
    return;
  }
  if (code && pc) {
    view.innerHTML = `${pairHead('Подключение')}<section class="panel pair-wait"><span class="spinner" aria-hidden="true"></span><p>Подключаю к домашнему компьютеру…</p></section>`;
    try {
      await doPair(pc, code);
      renderPaired();
    } catch (e) {
      if (fromHandoff) clearHandoff();
      renderPairForm({ pc, code: fromHandoff ? '' : code, error: friendlyPairError(e) });
    }
    return;
  }
  if (!pc) { // подключение заново: подставляем уже известный адрес компьютера
    const eps = (await store.connection()).endpoints || {};
    pc = (eps.wan || [])[0] || (eps.lan || [])[0] || '';
  }
  renderPairForm({ pc, code: '' });
}

function renderPairForm({ pc = '', code = '', error = '' }) {
  const iosSafari = IOS && !STANDALONE;
  view.innerHTML = `${pairHead('Подключение к компьютеру')}
    <section class="panel pair-hero">
      <p style="margin:0">Рецепты хранятся на телефоне, а ссылки разбирает домашний компьютер. Подключите приложение один раз — дальше всё работает само, дома и вне дома.</p>
      ${iosSafari ? `<div class="notice">${icon('warn')}<div><b>На iPhone сначала добавьте приложение на экран «Домой»:</b> ${SHARE_ICON} «Поделиться» → «На экран Домой». Откройте его оттуда и подключите там — Safari и приложение на экране «Домой» хранят данные раздельно.</div></div>` : ''}
      <button class="btn btn-primary btn-big" id="scan" type="button">${icon('qr')}Сканировать QR-код</button>
      <p class="small muted" style="margin:0">QR-код — на экране компьютера: «Система → Подключить телефон».</p>
      <p class="form-error" id="pair-err" ${error ? '' : 'hidden'}>${esc(error)}</p>
    </section>
    <details class="panel manual" ${code || error ? 'open' : ''}>
      <summary>Ввести адрес и код вручную</summary>
      <form id="pair-form" style="display:grid;gap:12px;margin-top:12px">
        <label class="field"><span>Адрес компьютера</span>
          <input class="input" name="pc" value="${esc(pc.replace(/^https:\/\//, ''))}" placeholder="например 203.0.113.10:8444" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
        <label class="field"><span>Код (8 символов)</span>
          <input class="input code-input" name="code" value="${esc(code)}" placeholder="XXXX-XXXX" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required></label>
        <label class="field"><span>Как назвать этот телефон</span>
          <input class="input" name="name" value="${esc(defaultName())}" maxlength="60"></label>
        <button class="btn btn-primary" type="submit" style="justify-self:start">${icon('check')}Подключить</button>
      </form>
    </details>`;
  const err = $('#pair-err');
  const fail = (e) => { err.textContent = friendlyPairError(e); err.hidden = false; };
  const run = async (pcUrl, pcCode, name, btn) => {
    err.hidden = true;
    btn.disabled = true;
    try { await doPair(pcUrl, pcCode, name); renderPaired(); } catch (e) { fail(e); } finally { btn.disabled = false; }
  };
  $('#scan').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    err.hidden = true;
    let link;
    try { link = await scanQr(); } catch (ex) { fail(ex); return; }
    if (link) run(link.pc, link.code, defaultName(), btn);
  });
  const form = $('#pair-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(form.pc.value, form.code.value, form.name.value.trim(), $('button[type=submit]', form));
  });
}

function renderIosInstall(pc, code) {
  const safariLink = `#/pair?pc=${encodeURIComponent(pc)}&code=${encodeURIComponent(code)}&safari=1`;
  view.innerHTML = `${pairHead('Установите приложение')}
    <section class="panel">
      <p style="margin:0">На iPhone приложение сначала добавляют на экран «Домой» — иначе оно не запомнит подключение к компьютеру.</p>
      <ol class="steps-list">
        <li><b>Нажмите ${SHARE_ICON} «Поделиться»</b> на панели Safari.</li>
        <li><b>Выберите «На экран Домой»</b> (если не видно — прокрутите список ниже) и нажмите «Добавить». Переключатель «Открыть как веб-приложение» оставьте включённым.</li>
        <li><b>Откройте «Рецепты» с экрана «Домой».</b> Если приложение не подключится само, нажмите в нём «Сканировать QR-код» и наведите камеру на тот же QR-код на компьютере.</li>
      </ol>
    </section>
    <div class="btn-row" style="margin-top:12px"><a class="btn btn-ghost" href="${esc(safariLink)}">Пользоваться в Safari без установки</a></div>`;
}

function renderPaired() {
  const install = STANDALONE ? '' : IOS
    ? `<section class="panel"><h3>Приложение на экране «Домой»</h3>
        <p class="small" style="margin:0">Сейчас подключён Safari. Если добавите приложение на экран «Домой», подключите его там ещё раз: «Сканировать QR-код».</p></section>`
    : `<section class="panel"><h3>Установите приложение</h3>
        <p class="small" style="margin:0">Оно откроется одним касанием с главного экрана и появится в меню «Поделиться» — так удобнее всего отправлять ссылки из YouTube и Instagram.</p>
        <button class="btn btn-primary" id="install" style="justify-self:start" ${installEvent ? '' : 'hidden'}>${icon('plus')}Установить</button>
        <p class="small muted" id="install-hint" style="margin:0" ${installEvent ? 'hidden' : ''}>Меню браузера ⋮ → «Установить приложение» или «Добавить на главный экран».</p></section>`;
  view.innerHTML = `${pairHead('Готово!')}
    <div class="sys-grid">
      <section class="panel pair-done">${icon('check')}<div><b>Телефон подключён к компьютеру</b>
        <p class="small muted" style="margin:0">Рецепты с компьютера загружаются на телефон, новые ссылки будут уходить на обработку сами.</p></div></section>
      ${install}
    </div>
    <div class="btn-row" style="margin-top:16px"><a class="btn btn-primary" href="#/">${icon('book')}К рецептам</a></div>`;
  bindInstallButton();
}

function bindInstallButton() {
  $('#install')?.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    $('#install')?.setAttribute('hidden', '');
  });
}

// =====================================================================
// Система
// =====================================================================
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('#install')?.removeAttribute('hidden');
  $('#install-hint')?.setAttribute('hidden', '');
});
window.addEventListener('appinstalled', () => { installEvent = null; $('#install')?.setAttribute('hidden', ''); toast('Приложение установлено — оно на главном экране'); });

async function renderSystem() {
  if (DEVICE) return renderDeviceSystem();
  view.innerHTML = `<header class="page-head"><h1 class="h1">Система</h1><a class="btn btn-sm" href="instruction" target="_blank" rel="noopener">${icon('book')}Инструкция</a></header><div class="sys-grid" id="sys"><div class="skeleton"></div><div class="skeleton"></div></div>`;
  const [s, g, devs, net, cloud] = await Promise.all([store.system(), store.chains(), store.devices(),
    store.net().catch(() => null), store.cloud().catch(() => null)]);
  $('#sys').innerHTML = pausePanel(s.pause) + phonesPanel(devs.items, net) + netPanel(net) + cloudPanel(cloud) + systemPanels(s, g);
  $('#pause-toggle')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const st = await store.api('api/pause', { method: 'PUT', body: { paused: !s.pause?.paused } });
      toast(st.paused ? 'Пауза: видеокарта свободна, ссылки ждут в очереди' : 'Обработка продолжается', 3500);
    } catch (ex) { toast(ex.message); }
    renderSystem();
  });
  bindSystemPanels(g);
  bindPhonePanels();
  bindCloudPanel();
}

function pausePanel(p) {
  if (!p) return '';
  return `<section class="panel wide pause-panel"><h3>Пауза для игр ${p.paused ? '<span class="bad">включена</span>' : '<span class="ok">выключена</span>'}</h3>
    <p class="small" style="margin:0">${p.paused
    ? `С ${esc(fmtDate(p.since))} новые ссылки не разбираются, модель выгружена из видеопамяти. Телефоны видят компьютер и синхронизируются, ссылки ждут в очереди. После перезагрузки компьютера пауза снимается сама.`
    : 'На время игры обработку можно приостановить: видеокарта освободится, телефоны продолжат работать, а ссылки подождут в очереди. То же самое — game-on.cmd и game-off.cmd в папке программы.'}</p>
    <button class="btn ${p.paused ? 'btn-primary' : ''}" id="pause-toggle" style="justify-self:start">${p.paused ? 'Продолжить обработку' : 'Поставить на паузу'}</button></section>`;
}

function cloudPanel(c) {
  if (!c) return '';
  const last = c.last_upload;
  let body;
  if (c.configured) {
    body = `<dl class="kv"><dt>Аккаунт</dt><dd>${esc(c.user || 'подключён')}</dd><dt>Папка</dt><dd>${esc(c.folder)}</dd>
      <dt>Последняя копия</dt><dd>${last ? `${esc(fmtDate(last.time))}, ${last.size_kb} КБ` : 'ещё не было'}</dd></dl>
      ${c.last_error ? `<p class="form-error">${esc(c.last_error)}</p>` : ''}
      <div class="btn-row"><button class="btn btn-primary" id="cloud-upload">Отправить копию сейчас</button>
      <button class="btn btn-ghost" id="cloud-off">Отключить</button></div>`;
  } else if (!c.client_id) {
    body = `<p class="small" style="margin:0">Укажите Client ID приложения из oauth.yandex.ru (с правом «Доступ к папке приложения на Диске» и Redirect URI https://oauth.yandex.ru/verification_code).</p>
      <form id="cloud-cid" class="add-row"><input class="input" name="cid" placeholder="Client ID" autocomplete="off"><button class="btn" type="submit">Сохранить</button></form>`;
  } else {
    body = `<ol class="small" style="margin:0;padding-left:18px;display:grid;gap:4px">
        <li>Нажмите «Войти в Яндекс» и разрешите доступ.</li>
        <li>Яндекс покажет токен — скопируйте его и вставьте ниже.</li></ol>
      <a class="btn" href="${esc(c.auth_url)}" target="_blank" rel="noopener noreferrer" style="justify-self:start">Войти в Яндекс</a>
      <form id="cloud-token" class="add-row"><input class="input" name="token" placeholder="Токен со страницы Яндекса" autocomplete="off"><button class="btn btn-primary" type="submit">Подключить</button></form>`;
  }
  return `<section class="panel"><h3>Копии в Яндекс Диск ${c.configured ? '<span class="ok">включены</span>' : ''}</h3>
    <p class="small muted" style="margin:0">Раз в сутки копия базы рецептов с картинками уходит на Диск, хранятся последние 30. Токен хранится только на этом компьютере.</p>
    ${body}<p class="form-error" id="cloud-err" hidden></p></section>`;
}

function bindCloudPanel() {
  const fail = (e) => { const el = $('#cloud-err'); if (el) { el.textContent = e.message; el.hidden = false; } };
  $('#cloud-cid')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await store.setCloud({ client_id: e.target.cid.value.trim() }); renderSystem(); } catch (ex) { fail(ex); }
  });
  $('#cloud-token')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await store.setCloud({ token: e.target.token.value.trim() }); toast('Яндекс Диск подключён'); renderSystem(); } catch (ex) { fail(ex); }
  });
  $('#cloud-upload')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Отправляю…';
    try { await store.cloudUpload(); toast('Копия отправлена в Яндекс Диск'); renderSystem(); }
    catch (ex) { fail(ex); e.target.disabled = false; e.target.textContent = 'Отправить копию сейчас'; }
  });
  $('#cloud-off')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Отключить Яндекс Диск?', 'Новые копии перестанут отправляться. Уже отправленные останутся на Диске.', 'Отключить'))) return;
    await store.cloudDisconnect(); renderSystem();
  });
}

function phonesPanel(devices, net) {
  const rows = devices.filter((d) => !d.revoked).map((d) => `<li style="display:flex;justify-content:space-between;gap:8px;align-items:center">
    <span><b>${esc(d.name)}</b><small class="muted" style="display:block">подключён ${esc(fmtDate(d.created_at))}, был на связи ${esc(fmtAgo(d.last_seen))}</small></span>
    <button class="btn btn-ghost" style="min-height:34px" data-revoke="${d.id}">Отключить</button></li>`).join('');
  return `<section class="panel wide"><h3>Телефоны с приложением</h3>
    <p class="small" style="margin:0">Приложение хранит рецепты на телефоне и отправляет ссылки сюда, когда видит компьютер — дома по Wi-Fi или через интернет.</p>
    ${rows ? `<ul class="devlist">${rows}</ul>` : '<p class="muted small" style="margin:0">Пока ни одного телефона.</p>'}
    <div class="btn-row"><button class="btn btn-primary" id="pair-new">${icon('plus')}Подключить телефон</button>
    <a class="btn" href="#/phone">Инструкция для телефона</a></div></section>`;
}

function netPanel(net) {
  if (!net) return '';
  const t = net.tls;
  const a = net.acme || {};
  const pc = net.lan_ips[0] || 'этот компьютер';
  return `<section class="panel wide"><h3>Доступ из интернета</h3>
    <p class="small" style="margin:0">Чтобы приложение отправляло ссылки и вне дома, на роутере пробросьте два порта на ${esc(pc)}:
      внешний <b>${esc(net.public_port)}</b> → ${esc(net.wan_port)} (приложение) и внешний <b>80</b> → 80 (проверка сертификата Let's Encrypt).
      Удобнее всего закрепить за компьютером адрес ${esc(pc)} в настройках DHCP роутера.</p>
    <form id="net-form" style="display:grid;gap:8px">
      <div class="edit-grid-2">
        <label class="field"><span>Статический IP (от провайдера)</span><input class="input" name="host" value="${esc(net.public_host)}" placeholder="например 203.0.113.10"></label>
        <label class="field"><span>Внешний порт на роутере</span><input class="input" name="port" inputmode="numeric" value="${esc(net.public_port)}"></label>
      </div>
      <label class="field"><span>Адрес приложения для телефона</span><input class="input" name="app" value="${esc(net.app_url || '')}" placeholder="https://…/recipes-app/"></label>
      <button class="btn" type="submit" style="justify-self:start">Сохранить</button>
      <p class="form-error" id="net-err" hidden></p>
    </form>
    <dl class="kv"><dt>Дома</dt><dd>${esc(net.endpoints.lan.join(', ') || '—')}</dd>
      <dt>Из интернета</dt><dd>${esc(net.endpoints.wan.join(', ') || 'не настроено')}</dd>
      <dt>Сертификат Let's Encrypt</dt><dd>${a.valid_until ? `<span class="ok">до ${esc(fmtDate(a.valid_until))}</span>, продлевается сам` : '<span class="bad">нет</span>'}</dd>
      ${a.last_error ? `<dt>Последняя ошибка</dt><dd class="bad">${esc(a.last_error)}</dd>` : ''}
      ${t ? `<dt>Свой сертификат (дом)</dt><dd>до ${esc(fmtDate(t.valid_until))}</dd>` : ''}</dl>
    ${net.endpoints.wan.length ? `<div style="display:grid;gap:8px"><button class="btn" id="net-check" type="button" style="justify-self:start">${icon('refresh')}Проверить доступ из интернета</button>
      <div id="net-check-res"></div></div>` : ''}
    ${net.public_host ? `<form id="acme-form" style="display:grid;gap:8px">
      <label class="check small"><input type="checkbox" name="agree"> Я принимаю <a href="${esc(a.terms_url)}" target="_blank" rel="noopener noreferrer">соглашение подписчика Let's Encrypt</a></label>
      <label class="field"><span>Почта для уведомлений Let's Encrypt (необязательно)</span><input class="input" name="email" type="email" autocomplete="email"></label>
      <button class="btn btn-primary" type="submit" style="justify-self:start">${a.valid_until ? 'Обновить сертификат' : 'Получить сертификат'}</button>
      <p class="form-error" id="acme-err" hidden></p></form>` : ''}</section>`;
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
      const res = await store.setNet({ public_host: e.target.host.value.trim(), public_port: +e.target.port.value || 0,
        app_url: e.target.app.value.trim() });
      toast(res.ca_changed ? 'Сохранено. Домашний сертификат обновлён — если он был установлен на телефон, установите заново.' : 'Сохранено', 5000);
      renderSystem();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  $('#net-check')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const out = $('#net-check-res');
    btn.disabled = true;
    out.innerHTML = '<p class="small muted wait-line"><span class="spinner small" aria-hidden="true"></span>Обращаюсь к компьютеру по внешнему адресу…</p>';
    try {
      const res = await store.api('api/net/check', { method: 'POST' });
      out.innerHTML = `<ul class="diag">${res.items.map((i) => `<li class="${i.ok ? 'is-ok' : 'is-bad'}">${icon(i.ok ? 'check' : 'warn')}
        <span><b>${esc(shortUrl(i.url))}</b></span><em>${i.ok ? `отвечает, ${i.ms} мс` : esc(i.error)}</em></li>`).join('')}</ul>
        <p class="small muted" style="margin:0">${res.ok ? 'Проброс порта и сертификат в порядке.' : 'Проверка идёт изнутри домашней сети.'}
        Окончательно проверить можно с телефона без Wi-Fi: «Связь» → «Проверить связь».</p>`;
    } catch (ex) { out.innerHTML = `<p class="form-error">${esc(ex.message)}</p>`; }
    btn.disabled = false;
  });
  $('#acme-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#acme-err');
    err.hidden = true;
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    btn.textContent = 'Получаю сертификат…';
    try {
      await store.api('api/acme', { method: 'POST', body: { agree: e.target.agree.checked, email: e.target.email.value.trim() || null } });
      toast('Сертификат получен');
      renderSystem();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = 'Получить сертификат';
    }
  });
}

const PAIR_STEPS = `<ol class="steps-list small">
      <li><b>Android:</b> наведите камеру телефона на QR-код и откройте ссылку — приложение подключится само, затем нажмите «Установить».</li>
      <li><b>iPhone:</b> откройте ссылку из камеры в Safari, добавьте приложение на экран «Домой» (подсказка появится), откройте его и нажмите «Сканировать QR-код».</li>
      <li><b>Приложение уже установлено:</b> «Связь» → «Подключить заново» → «Сканировать QR-код».</li>
    </ol>`;

async function showPairDialog() {
  let code;
  try { code = await store.pairCode(); } catch (e) { toast(e.message); return; }
  const before = new Set((await store.devices().catch(() => ({ items: [] }))).items.map((d) => d.id));
  const url = code.app_url;
  let open = true;
  const closed = openDialog(`
    <h3>Подключить телефон</h3>
    <div id="pair-live" style="display:grid;gap:12px">
      ${url ? `<img class="pair-qr" src="api/qr?text=${encodeURIComponent(url)}" alt="QR-код для подключения">` : ''}
      ${PAIR_STEPS}
      <details class="small"><summary>Ввести вручную</summary>
        <dl class="kv" style="margin-top:8px"><dt>Адрес</dt><dd>${esc(shortUrl(code.pc || ''))}</dd>
        <dt>Код</dt><dd><b class="code-big">${esc(code.code.slice(0, 4))}-${esc(code.code.slice(4))}</b></dd></dl></details>
      <p class="small muted wait-line"><span class="spinner small" aria-hidden="true"></span>Жду телефон… Код действует 15 минут и подходит для одного телефона.</p>
    </div>
    <form method="dialog" class="dialog-actions"><button class="btn" value="ok">Закрыть</button></form>`);
  // Как только телефон подключился — показываем это здесь же.
  const poll = async () => {
    if (!open) return;
    try {
      const added = (await store.devices()).items.find((d) => !d.revoked && !before.has(d.id));
      if (added && open) {
        $('#pair-live').innerHTML = `<div class="pair-done">${icon('check')}<div><b>«${esc(added.name)}» подключён</b>
          <p class="small muted" style="margin:0">Рецепты уже загружаются на телефон. Окно можно закрыть.</p></div></div>`;
        return;
      }
    } catch { /* повторим */ }
    setTimeout(poll, 2000);
  };
  setTimeout(poll, 2000);
  await closed;
  open = false;
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
    ${storesPanel(g)}
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
    } else if (e.target.closest('[data-catalog]')) {
      const chain = e.target.closest('[data-catalog]').dataset.catalog;
      try { await store.refreshCatalog(chain); toast('Скачиваю каталог — это около минуты'); }
      catch (err) { toast(err.message, 4000); }
      watchCatalog();
    }
  });
  if ((window.__chains || []).some((c) => c.catalog?.running)) watchCatalog();
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

// Пока каталог скачивается — обновляем строки магазинов, не перерисовывая всю страницу.
let catalogTimer = null;
function watchCatalog() {
  clearTimeout(catalogTimer);
  catalogTimer = setTimeout(async () => {
    const box = $('#chains');
    if (!box) return;
    try {
      const g = await store.chains();
      window.__chains = g.items;
      box.innerHTML = g.items.map(chainRow).join('');
      if (g.items.some((c) => c.catalog?.running)) watchCatalog();
    } catch { /* следующая попытка при открытии страницы */ }
  }, 2500);
}

function catalogLine(c) {
  const cat = c.catalog || {};
  if (!c.store) return '';
  if (cat.running) {
    const [done, all] = cat.progress || [];
    return `<span class="wait-line"><span class="spinner small" aria-hidden="true"></span>Скачиваю каталог${done ? `: ${done.toLocaleString('ru-RU')}${all ? ` из ${all.toLocaleString('ru-RU')}` : ''}` : '…'}</span>`;
  }
  const parts = [];
  if (cat.count) parts.push(`Каталог: <b>${cat.count.toLocaleString('ru-RU')}</b> ${plural(cat.count, ['товар', 'товара', 'товаров'])}, обновлён ${esc(fmtAgo(cat.updated))}`);
  else parts.push('Каталог ещё не скачан — цены ищутся на сайте при каждом запросе');
  if (cat.error) parts.push(`<span class="bad">${esc(cat.error)}</span>`);
  return parts.join('<br>');
}

function chainRow(c) {
  const st = c.status;
  return `<div class="chain">
    <div class="chain-head"><span class="chain-mark" data-chain="${c.id}" aria-hidden="true"></span><b>${esc(c.name)}</b>
      <span class="btn-row">
        <button class="btn btn-sm" data-store="${c.id}">Магазин</button>
        ${c.store ? `<button class="btn btn-sm" data-catalog="${c.id}" ${c.catalog?.running ? 'disabled' : ''}>${c.catalog?.count ? 'Обновить каталог' : 'Скачать каталог'}</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-check="${c.id}">Проверить</button>
      </span></div>
    <div class="small muted">${c.store ? esc(c.store.address || c.store.id) : 'Магазин не выбран — укажите адрес выше'}</div>
    <div class="small">${catalogLine(c)}</div>
    <div class="small" id="chk-${c.id}">${st && !st.ok ? `<span class="bad">${esc(st.message)}</span>` : ''}</div>
  </div>`;
}

const VPN_HELP = `<details class="vpn-help"><summary>Пятёрочка «не пускает»? Как исправить</summary>
  <p>Сайт Пятёрочки отвечает только российским адресам, а запросы компьютера идут через VPN. Нужно, чтобы сайты магазинов открывались мимо VPN:</p>
  <ol>
    <li>Откройте AmneziaVPN → «Настройки» → «Соединение» → «Раздельное туннелирование» (для сайтов). Названия пунктов могут немного отличаться в вашей версии.</li>
    <li>Включите его в режиме «Адреса из списка не должны открываться через VPN».</li>
    <li>Добавьте: <b>5ka.ru</b>, <b>5d.5ka.ru</b>, <b>magnit.ru</b>.</li>
    <li>Переподключите VPN и нажмите здесь «Проверить» у Пятёрочки, затем «Магазин», чтобы выбрать ближайший.</li>
  </ol>
  <p class="muted">YouTube и всё остальное продолжат идти через VPN. Лента так не заработает: её сайт пускает только браузеры, с VPN и без.</p></details>`;

function storesPanel(g) {
  window.__chains = g.items;
  // Подсказка про VPN — только когда сайт отказал именно из-за VPN (Пятёрочка), а не из-за защиты от программ.
  const blocked = g.items.some((c) => /VPN/.test(c.status?.message || c.catalog?.error || '') && !/ни при чём/.test(c.status?.message || ''));
  return `<section class="panel wide"><h3>Магазины</h3>
    <p class="small" style="margin:0">Адрес, рядом с которым искать магазины: <b>${esc(g.location?.label || '—')}</b></p>
    <form id="loc-form" class="add-row"><input class="input" name="q" placeholder="Город, улица, дом" autocomplete="street-address"><button class="btn" type="submit">Найти</button></form>
    <div id="loc-res" class="store-results"></div>
    <div id="chains" class="chain-list">${g.items.map(chainRow).join('')}</div>
    <p class="small muted" style="margin:0">Каталог выбранного магазина компьютер скачивает раз в сутки, около 5 утра. По нему список покупок к рецепту собирается мгновенно и не зависит от того, отвечает ли сайт магазина.</p>
    ${blocked ? VPN_HELP : ''}</section>`;
}

function shortUrl(u) { return String(u || '').replace(/^https?:\/\//, ''); }

function connCardHtml(c, diag, checking) {
  const state = connState(c);
  const online = isOnline(state);
  const nonet = state === 'offline' && c.conn?.reason === 'nonet';
  const title = checking ? 'Проверяю связь…'
    : state === 'auth' ? 'Компьютер отключил этот телефон'
      : online ? 'Компьютер на связи' : nonet ? 'Нет интернета на телефоне' : state === 'offline' ? 'Компьютер недоступен' : 'Связь ещё не проверялась';
  const okItem = diag?.items.find((i) => i.ok);
  const sub = checking ? 'Опрашиваю адреса компьютера'
    : online ? `${state === 'lan' ? 'Дома, по Wi-Fi' : 'Через интернет'}${okItem ? ` · ответ за ${okItem.ms} мс` : ''} · проверено ${fmtAgo(c.conn?.at)}`
      : c.lastOnline ? `Последний раз на связи ${fmtAgo(c.lastOnline)}` : 'Ещё ни разу не был на связи';
  const kindLabel = (k) => (k === 'lan' ? 'Дома (Wi-Fi)' : 'Через интернет');
  // Если связь есть, неотвечающие запасные адреса — не ошибка: показываем их приглушённо.
  const rows = (diag?.items || []).map((i) => `<li class="${i.ok ? 'is-ok' : diag.ok ? 'is-idle' : 'is-bad'}">
      ${icon(i.ok ? 'check' : 'warn')}<span><b>${kindLabel(i.kind)}</b> <small>${esc(shortUrl(i.url))}</small></span>
      <em>${i.ok ? `${i.ms} мс` : diag.ok ? `${esc(i.error)} — не нужен` : esc(i.error)}</em></li>`);
  if (diag && diag.internet !== null) {
    rows.push(`<li class="${diag.internet ? 'is-ok' : 'is-bad'}">${icon(diag.internet ? 'check' : 'warn')}<span><b>Интернет на телефоне</b></span><em>${diag.internet ? 'есть' : 'нет'}</em></li>`);
  }
  let hint = '';
  if (!checking && diag && !diag.ok && state !== 'auth') {
    hint = diag.internet === false
      ? 'Телефон не в сети. Рецепты доступны, а новые ссылки отправятся сами, когда появится интернет.'
      : 'Компьютер не отвечает: он выключен, спит, не запущен сервер или дома пропал интернет. Рецепты на телефоне доступны, новые ссылки сохранятся и отправятся сами, когда компьютер появится.';
    if (diag.skippedLan && diag.internet !== false) hint += ' Домашний адрес не проверялся: приложение ходит к компьютеру через интернет — так работает и дома, и вне дома.';
  }
  const dotState = checking ? 'unknown' : state;
  return `<div class="conn-head" data-state="${dotState}"><i class="dot big" aria-hidden="true"></i>
      <div><b>${esc(title)}</b><small>${esc(sub)}</small></div></div>
    ${rows.length ? `<ul class="diag">${rows.join('')}</ul>` : ''}
    ${hint ? `<p class="small" style="margin:0">${esc(hint)}</p>` : ''}
    ${online && c.conn?.paused && !checking ? '<p class="small" style="margin:0"><b>Обработка на паузе</b> — компьютер сейчас занят (например, играми). Ссылки принимаются и разберутся, когда паузу снимут.</p>' : ''}
    ${c.pending ? `<p class="small" style="margin:0"><b>${esc(queueText(c.pending))}</b> — уйдут на компьютер, как только он появится.</p>` : ''}
    ${state === 'auth' ? '<a class="btn btn-primary" href="#/pair?again=1" style="justify-self:start">Подключить заново</a>' : ''}
    <div class="btn-row"><button class="btn" id="check-now" ${checking ? 'disabled' : ''}>${icon('refresh')}Проверить связь</button></div>`;
}

async function renderDeviceSystem() {
  const c = await store.connection();
  view.innerHTML = `<header class="page-head"><h1 class="h1">Связь и система</h1></header>
    <div class="sys-grid" id="sys">
      <section class="panel wide conn-card" id="conn-card">${connCardHtml(c, null, true)}</section>
      <section class="panel wide"><h3>Этот телефон</h3>
        <dl class="kv">
          <dt>Название</dt><dd>${esc(c.device?.name || '—')}</dd>
          <dt>Рецептов на телефоне</dt><dd>${c.recipes}</dd>
          <dt>Последняя синхронизация</dt><dd>${esc(fmtAgo(c.lastSync))}</dd>
          <dt>Ждут отправки</dt><dd>${c.pending} ссыл. / ${c.dirty} правок</dd>
        </dl>
        <div class="btn-row">
          <button class="btn btn-primary" id="sync-now">${icon('refresh')}Синхронизировать</button>
          <button class="btn" id="install" ${installEvent ? '' : 'hidden'}>${icon('plus')}Установить приложение</button>
          <a class="btn btn-ghost" href="#/pair?again=1">Подключить заново</a>
        </div>
      </section>
      <div id="pc-panels" class="panel wide"><p class="muted small" style="margin:0">Состояние компьютера загрузится, когда он будет на связи.</p></div>
    </div>`;
  const runCheck = async () => {
    const card = $('#conn-card');
    if (!card) return;
    card.innerHTML = connCardHtml(await store.connection(), null, true);
    const diag = await store.diagnose().catch(() => null);
    const fresh = await store.connection();
    if (!$('#conn-card')) return;
    $('#conn-card').innerHTML = connCardHtml(fresh, diag, false);
    $('#check-now').addEventListener('click', runCheck);
    if (diag?.ok) loadPcPanels();
  };
  $('#sync-now').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const res = await store.sync('manual');
    e.target.disabled = false;
    toast(res.ok ? `Готово${res.changed ? `: обновлено ${res.changed}` : ''}` : res.error, 3500);
    renderDeviceSystem();
  });
  bindInstallButton();
  runCheck();
}

async function loadPcPanels() {
  try {
    const [s, g] = await Promise.all([store.system(), store.chains()]);
    const holder = $('#pc-panels');
    if (!holder) return;
    const o = s.ollama;
    const busy = ACTIVE.reduce((n, k) => n + (s.queue.counts[k] || 0), 0);
    const ready = o.ok && o.model_installed;
    holder.outerHTML = `<section class="panel wide"><h3>Обработка ссылок ${ready ? '<span class="ok">работает</span>' : '<span class="bad">не готова</span>'}</h3>
      <p class="small" style="margin:0">${ready ? (busy ? `Сейчас в работе и в очереди: ${busy}.` : 'Компьютер свободен и готов разбирать новые ссылки.')
        : 'Модель на компьютере недоступна — ссылки будут ждать в очереди, пока её не запустят.'}</p></section>${systemPanels(s, g)}`;
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
  const wanReady = net.endpoints.wan.length > 0 && !!net.acme?.valid_until;
  const caSteps = `
        <p class="small" style="margin:0">Один раз — чтобы телефон доверял компьютеру. Сертификат подходит только для адресов домашней сети${net.public_host ? ` и ${esc(net.public_host)}` : ''} и не даёт доступа к другим сайтам.</p>
        <a class="btn" href="ca.crt" download style="justify-self:start">Скачать сертификат</a>
        <ol class="small" style="margin:0;padding-left:18px;display:grid;gap:4px">
          <li>Откройте «Настройки → Безопасность → Шифрование и учётные данные → Установка сертификата → Сертификат ЦС» (на Samsung: «Биометрия и безопасность → Другие параметры безопасности → Установить из памяти»).</li>
          <li>Нажмите «Всё равно установить» и выберите скачанный файл recipes-home-ca.crt.</li>
          <li>Android попросит PIN-код экрана — это нормально.</li>
        </ol>
        <p class="small muted" style="margin:0">Отпечаток: ${esc(net.tls?.ca_fingerprint || '')}</p>
        <p class="small" style="margin:0">Затем откройте приложение по домашнему адресу — оно сразу подключится:</p>
        <button class="btn" id="open-app" style="justify-self:start" ${lanApp ? '' : 'disabled'}>Открыть приложение по домашнему адресу</button>
        <p class="form-error" id="open-err" hidden></p>`;
  view.innerHTML = `
    <div class="topbar"><a class="btn btn-ghost" href="#/system">${icon('back')}Система</a></div>
    <h1 class="h1" style="margin-bottom:16px">Приложение на телефон</h1>
    <div class="edit-form">
      ${wanReady ? `
      <section class="panel"><h3>1. Подключение — один QR-код</h3>
        <p class="small" style="margin:0">Сертификаты ставить не нужно: компьютер доступен по ${esc(shortUrl(net.endpoints.wan[0]))} с сертификатом Let's Encrypt — и дома, и вне дома.</p>
        ${PAIR_STEPS}
        <button class="btn btn-primary" id="show-qr" style="justify-self:start">${icon('qr')}Показать QR-код</button>
      </section>
      <section class="panel"><h3>2. Как отправлять ссылки</h3>
        <ul class="small" style="margin:0;padding-left:18px;display:grid;gap:4px">
          <li><b>Android:</b> в YouTube, Instagram или браузере «Поделиться» → «Рецепты». Ссылка встанет в очередь даже без связи с компьютером.</li>
          <li><b>iPhone:</b> скопируйте ссылку, откройте «Рецепты» → «Добавить» и вставьте её (iPhone не показывает приложения с экрана «Домой» в меню «Поделиться»).</li>
        </ul>
      </section>
      <details class="panel"><summary><b>Без интернета, только дома (необязательно)</b></summary>
        <div style="display:grid;gap:10px;margin-top:10px">${caSteps}</div></details>` : `
      <section class="panel"><h3>Сначала — доступ из интернета</h3>
        <p class="small" style="margin:0">Проще всего настроить в «Система → Доступ из интернета»: статический IP, проброс порта и сертификат Let's Encrypt. Тогда телефон подключается одним QR-кодом без установки сертификатов.</p>
      </section>
      <section class="panel"><h3>Или только дома: сертификат компьютера</h3>${caSteps}</section>`}
    </div>`;
  $('#show-qr')?.addEventListener('click', showPairDialog);
  $('#open-app')?.addEventListener('click', async () => {
    try {
      const code = await store.pairCode();
      location.href = `${lanApp}/#/pair?code=${code.code}&name=${encodeURIComponent('Телефон')}`;
    } catch (e) { $('#open-err').textContent = e.message; $('#open-err').hidden = false; }
  });
}

// ---------- Обновление приложения ----------
// Новая версия (опубликованная на GitHub Pages) ставится сама: браузер проверяет её при открытии,
// а мы — ещё и при каждом возвращении в приложение и раз в час (iPhone держит приложение в памяти
// и не перезапускает его). Как только новая версия встала — перезагружаемся, если ничего не прервём.
function setupUpdates() {
  let hadController = !!navigator.serviceWorker.controller; // при самой первой установке перезагружать нечего
  navigator.serviceWorker.register('sw.js', { type: 'module', scope: './' }).then((reg) => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 3600 * 1000);
  }).catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const wasControlled = hadController;
    hadController = true;
    if (!wasControlled || applyUpdate.done) return;
    applyUpdate();
  });
  if (sessionStorage.getItem('updated')) {
    sessionStorage.removeItem('updated');
    setTimeout(() => toast('Приложение обновлено', 2500), 600);
  }
}

function applyUpdate() {
  // Человек что-то вводит: значение поля отличается от исходного.
  const typing = $$('input:not([type=checkbox]):not([type=search]), textarea').some((el) => el.value.trim() && el.value !== el.defaultValue);
  const busy = document.querySelector('.cook') || /\/edit$/.test(location.hash) || typing || dialog.open;
  if (busy) {
    // Не перебиваем готовку и правку — новая версия откроется в следующий раз.
    toast('Вышла новая версия приложения — она откроется при следующем запуске', 4000);
    return;
  }
  applyUpdate.done = true;
  sessionStorage.setItem('updated', '1');
  location.reload();
}

// ---------- Старт ----------
async function start() {
  await store.init();
  if (DEVICE) {
    document.querySelector('[data-nav="system"] span').textContent = 'Связь';
    connEl.addEventListener('click', () => { location.hash = '#/system'; });
    await store.core.kv.set('originIsPc', ORIGIN_IS_PC);
    if ('serviceWorker' in navigator && (isSecureContext || NATIVE)) setupUpdates();
    const onSync = async (ev) => {
      const t = ev.data?.type;
      if (t === 'conn' || t === 'outbox' || t === 'synced' || t === 'sync-error') renderConn();
      // Компьютер снова на связи — сразу досылаем очередь и забираем новое.
      if (t === 'conn' && isOnline(ev.data.conn?.state) && !ev.data.wasOnline) tick();
      if (t === 'outbox' || t === 'synced') refreshBadge();
      if (t === 'synced' && ev.data.changed) {
        const { path } = parseHash();
        if (path === '/' || path === '') loadList().catch(() => {});
      }
      if (t === 'image') hydrateImages();
      if (t === 'auth') toast('Компьютер отключил этот телефон — подключите его заново', 5000);
    };
    store.core.channel?.addEventListener('message', onSync); // из service worker и других вкладок
    store.core.events.addEventListener('message', onSync); // из этой же страницы
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      await store.sync('tick');
    };
    // Лёгкая проверка «компьютер отвечает?» каждые 15 секунд, пока приложение на экране.
    const heartbeat = async () => {
      if (document.visibilityState === 'visible' && (await store.paired())) await store.check();
    };
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    window.addEventListener('offline', () => store.markNoNetwork());
    setInterval(async () => { if ((await store.activeCount()) > 0) tick(); }, 8000);
    setInterval(heartbeat, 15000);
    setInterval(tick, 60000);
    setInterval(renderConn, 30000); // «был на связи N мин назад» стареет
    renderConn();
    tick();
  }
  route();
  refreshBadge();
}
start();
