// Режим телефона: рецепты хранятся на телефоне, ПК — только обработка и резервная копия.

import * as core from './sync-core.js';
import { inCollection } from './listing.js';

const STATUS_LABELS = {
  pending: 'Ждёт связи с компьютером', queued: 'В очереди', downloading: 'Загрузка', transcribing: 'Распознавание',
  extracting: 'Формирование рецепта', done: 'Готово', needs_review: 'Нужно уточнить', error: 'Ошибка',
  duplicate: 'Уже в коллекции', rejected: 'Ошибка',
};
const CATEGORIES = ['Завтраки', 'Супы', 'Салаты', 'Закуски', 'Основные блюда', 'Гарниры', 'Выпечка', 'Десерты',
  'Напитки', 'Соусы', 'Заготовки', 'Детское меню'];

const imageCache = new Map();

function summary(r) {
  return {
    key: r.uid, uid: r.uid, title: r.title, description: r.description, categories: r.categories || [],
    tags: r.tags || [], favorite: !!r.favorite, needs_review: !!r.needs_review, image: r.image,
    source_kind: r.source_kind, source_name: r.source_name,
    total_time_min: r.total_time_min || ((r.prep_time_min || 0) + (r.cook_time_min || 0)) || null,
    servings: r.servings, created_at: r.created_at, author: r.author,
    ingredients: (r.ingredients || []).map((i) => ({ name: i.name, shop_query: i.shop_query, note: i.note })),
    ingredients_count: (r.ingredients || []).length,
    channel_id: r.channel_id || null, saved: !!r.saved, video_views: r.video_views || null, video_date: r.video_date || null,
  };
}

// Все рецепты в памяти: с каналами их сотни, а список и «Есть дома» перечитывают их при каждом открытии.
// Сбрасывается при синхронизации с изменениями и при своих правках.
let recipesCache = null;
function invalidate() { recipesCache = null; }
function onSyncMessage(ev) {
  const t = ev.data?.type;
  if (t === 'synced' && ev.data.changed) invalidate();
  if (t === 'synced') imgPending.clear(); // неудачные картинки — ещё раз после новой синхронизации
}
core.events.addEventListener('message', onSyncMessage);
core.channel?.addEventListener('message', onSyncMessage);

function liveRecipes() {
  if (!recipesCache) {
    recipesCache = core.dbAll('recipes').then((all) => all.filter((r) => !r._deleted));
    recipesCache.catch(() => { recipesCache = null; });
  }
  return recipesCache;
}

// Картинки, которых ещё нет на телефоне (их докачивает синхронизация), — сразу для видимых карточек.
const imgQueue = [];
const imgPending = new Set();
let imgActive = 0;
async function pumpImages() {
  if (imgActive >= 3 || !imgQueue.length) return;
  const conn = await core.kv.get('conn');
  if (conn?.state !== 'lan' && conn?.state !== 'wan') { imgQueue.length = 0; return; }
  while (imgActive < 3 && imgQueue.length) {
    const name = imgQueue.shift();
    imgActive++;
    core.fetchImage(name).catch(() => {}).finally(() => { imgActive--; pumpImages(); });
  }
}
function fetchLater(name) {
  if (imgPending.has(name)) return;
  imgPending.add(name);
  imgQueue.push(name);
  pumpImages();
}

let syncTimer = null;
function scheduleSync(ms = 300) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => core.syncAll('change'), ms);
}

async function online(fn) {
  try { return await fn(); } catch (e) {
    if (e instanceof core.OfflineError) {
      const err = new Error('Нет связи с домашним компьютером. Это действие выполняет компьютер — попробуйте, когда связь появится.');
      err.offline = true;
      throw err;
    }
    throw e;
  }
}

function jobView(it) {
  const job = it.job || {};
  const status = it.state === 'pending' ? 'pending' : it.state === 'duplicate' ? 'duplicate' : it.state === 'rejected' ? 'rejected' : job.status || 'queued';
  return {
    key: it.cid, kind: it.text ? 'text' : 'url', url: it.url, title: job.title || null, status, source_kind: job.source_kind || null,
    status_label: STATUS_LABELS[status] || job.status_label || status,
    stage_detail: it.state === 'pending' ? (it.error || 'Отправится, как только телефон увидит компьютер') : job.stage_detail,
    error: it.state === 'duplicate' ? it.error : (it.state === 'rejected' ? it.error : job.error),
    notes: job.notes || [], attempts: job.attempts || 0, created_at: it.created_at,
    recipe_keys: it.state === 'duplicate' ? (it.dup?.recipes || []).map((r) => r.uid).filter(Boolean) : (job.recipe_uids || []),
    dup_recipes: it.dup?.recipes || [], server_id: job.id || null, local: true,
  };
}

export const deviceStore = {
  mode: 'device',
  core,
  CATEGORIES,
  async init() {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  },
  async paired() { return !!(await core.kv.get('token')); },
  async imageUrl(name) {
    if (!name) return null;
    if (imageCache.has(name)) return imageCache.get(name);
    const row = await core.dbGet('images', name);
    if (!row) { fetchLater(name); return null; }
    const url = URL.createObjectURL(row.blob);
    imageCache.set(name, url);
    return url;
  },
  // Все краткие карточки раздела: поиск, фильтры и сортировку делает listing.js.
  async listRecipes({ collection = 'mine' } = {}) {
    const items = (await liveRecipes()).filter((r) => inCollection(r, collection));
    return { items: items.map(summary), categories: CATEGORIES };
  },
  async getRecipe(key) {
    const r = await core.dbGet('recipes', key);
    if (!r || r._deleted) throw new Error('Рецепт не найден на телефоне');
    return { recipe: { ...r, key: r.uid, has_source_text: true }, job: null };
  },
  async source(key) {
    const r = await core.dbGet('recipes', key);
    if (r?._source) return r._source;
    const text = await online(() => core.api(`/api/device/recipes/${key}/source`, { raw: true }).then((res) => {
      if (!res.ok) throw new Error('Исходный текст не сохранён');
      return res.text();
    }));
    if (r) { r._source = text; await core.dbPut('recipes', r); }
    return text;
  },
  async saveRecipe(key, body) {
    const r = await core.dbGet('recipes', key);
    const next = { ...r, ...body, uid: key, updated_at: new Date().toISOString(), _dirty: 1 };
    await core.dbPut('recipes', next);
    invalidate();
    scheduleSync();
    return { ...next, key };
  },
  async setFavorite(key, favorite) {
    const r = await core.dbGet('recipes', key);
    if (!r) return;
    Object.assign(r, { favorite, updated_at: new Date().toISOString(), _dirty: 1 });
    await core.dbPut('recipes', r);
    invalidate();
    scheduleSync();
  },
  async setSaved(key, saved) {
    const r = await core.dbGet('recipes', key);
    if (!r) return;
    Object.assign(r, { saved, updated_at: new Date().toISOString(), _dirty: 1 });
    await core.dbPut('recipes', r);
    invalidate();
    scheduleSync();
  },
  async deleteRecipe(key) {
    const r = await core.dbGet('recipes', key);
    if (!r) return;
    Object.assign(r, { _deleted: true, updated_at: new Date().toISOString(), _dirty: 1 });
    await core.dbPut('recipes', r);
    invalidate();
    scheduleSync();
  },
  getPantry: () => core.kv.get('pantry', null),
  setPantry: (value) => core.kv.set('pantry', value),
  channels: () => online(() => core.api('/api/channels', { timeout: 15000 })),
  addChannel: (url, limit) => online(() => core.api('/api/channels', { method: 'POST', body: { url, limit } })),
  channelAction: (id, action) => online(() => core.api(`/api/channels/${id}/${action}`, { method: 'POST' })),
  deleteChannel: (id) => online(() => core.api(`/api/channels/${id}`, { method: 'DELETE', timeout: 60000 })),
  renameChannel: (id, title) => online(() => core.api(`/api/channels/${id}/rename`, { method: 'POST', body: { title }, timeout: 60000 })),
  reprocess: (key) => online(() => core.api(`/api/device/recipes/${key}/reprocess`, { method: 'POST' })),
  async addJob(body) {
    const item = await core.enqueue(body);
    if (navigator.serviceWorker?.ready) {
      navigator.serviceWorker.ready.then((reg) => reg.sync?.register('outbox')).catch(() => {});
    }
    core.syncAll('add');
    return { job: jobView(item) };
  },
  async listJobs() {
    const items = await core.dbAll('outbox');
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return items.slice(0, 40).map(jobView);
  },
  async retryJob(key) {
    const it = await core.dbGet('outbox', key);
    if (!it) return;
    if (it.job?.id && it.state === 'sent') {
      const res = await online(() => core.api(`/api/device/jobs/${it.job.id}/retry`, { method: 'POST' }));
      it.job = res.job;
    } else {
      Object.assign(it, { state: 'pending', error: null, force: it.state === 'duplicate' ? true : it.force });
    }
    await core.dbPut('outbox', it);
    core.syncAll('retry');
  },
  async deleteJob(key) { await core.dbDel('outbox', key); },
  async jobSource(key) {
    const it = await core.dbGet('outbox', key);
    return it?.text || it?.url || '';
  },
  async shopping(key, chain, scale) {
    const cacheKey = `${key}|${chain}|${scale}`;
    try {
      const data = await core.api(`/api/device/recipes/${key}/shopping?chain=${chain}&scale=${scale}`, { timeout: 120000 });
      if (!data.error) await core.dbPut('shopping', { key: cacheKey, data, at: new Date().toISOString() });
      return data;
    } catch (e) {
      const cached = await core.dbGet('shopping', cacheKey);
      if (cached) return { ...cached.data, offline_cached: true };
      if (e instanceof core.OfflineError) {
        return { chain, items: [], error: 'Нет связи с домашним компьютером — цены подбирает он. Откройте чек, когда связь появится.', offline: true };
      }
      return { chain, items: [], error: e.message };
    }
  },
  async chains() {
    try {
      const res = await core.api('/api/grocery/chains', { timeout: 8000 });
      await core.kv.set('chains', res);
      return res;
    } catch (e) {
      const cached = await core.kv.get('chains');
      if (cached) return cached;
      return { items: [{ id: '5ka', name: 'Пятёрочка' }, { id: 'magnit', name: 'Магнит' }, { id: 'lenta', name: 'Лента' }],
        default_chain: 'magnit', location: { label: '—' } };
    }
  },
  setDefaultChain: (chain) => core.api('/api/grocery/default', { method: 'POST', body: { chain } }).catch(() => {}),
  stores: (chain) => online(() => core.api(`/api/grocery/stores?chain=${chain}`, { timeout: 60000 })),
  setStore: (store) => online(() => core.api('/api/grocery/store', { method: 'POST', body: store })),
  groceryCheck: (chain) => online(() => core.api(`/api/grocery/check?chain=${chain}`, { timeout: 60000 })),
  grocerySearch: (chain, q) => online(() => core.api(`/api/grocery/search?chain=${chain}&q=${encodeURIComponent(q)}`, { timeout: 60000 })),
  refreshCatalog: (chain) => online(() => core.api(`/api/grocery/catalog/${chain}/refresh`, { method: 'POST' })),
  geocode: (query) => online(() => core.api('/api/grocery/geocode', { method: 'POST', body: { query } })),
  setLocation: (loc) => online(() => core.api('/api/grocery/location', { method: 'POST', body: loc, timeout: 120000 })),
  // Ограничения меняются редко: сразу отдаём сохранённые, свежие запрашиваем фоном.
  async limits() {
    const fresh = core.api('/api/limits', { timeout: 8000 }).then(async (l) => { await core.kv.set('limits', l); return l; });
    const cached = await core.kv.get('limits');
    if (cached) { fresh.catch(() => {}); return cached; }
    return fresh.catch(() => null);
  },
  system: () => online(() => core.api('/api/system', { timeout: 10000 })),
  activeCount: () => core.activeJobs(),
  // lite — для строки связи (каждые 15 с): без чтения всех рецептов с телефона.
  async connection({ lite = false } = {}) {
    if (lite) {
      return {
        paired: !!(await core.kv.get('token')),
        conn: await core.kv.get('conn', { state: 'unknown' }),
        lastSync: await core.kv.get('lastSync'),
        lastOnline: await core.kv.get('lastOnline'),
        pending: (await core.dbAll('outbox')).filter((i) => i.state === 'pending').length,
        authLost: await core.kv.get('authLost', false),
      };
    }
    return {
      paired: !!(await core.kv.get('token')),
      device: await core.kv.get('device'),
      conn: await core.kv.get('conn', { state: 'unknown' }),
      endpoints: await core.kv.get('endpoints', { lan: [], wan: [] }),
      lastSync: await core.kv.get('lastSync'),
      lastOnline: await core.kv.get('lastOnline'),
      lastError: await core.kv.get('lastSyncError'),
      pending: (await core.dbAll('outbox')).filter((i) => i.state === 'pending').length,
      dirty: (await core.dbAll('recipes')).filter((r) => r._dirty).length,
      recipes: (await liveRecipes()).length,
      authLost: await core.kv.get('authLost', false),
    };
  },
  sync: (reason) => core.syncAll(reason),
  check: () => core.connect(true).then(() => true, () => false),
  diagnose: () => core.diagnose(),
  markNoNetwork: () => core.markNoNetwork(),
  pair: (base, code, name) => core.pair(base, code, name),
  unpair: () => core.unpair(),
};
