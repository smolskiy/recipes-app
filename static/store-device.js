// Режим телефона: рецепты хранятся на телефоне, ПК — только обработка и резервная копия.

import * as core from './sync-core.js';

const STATUS_LABELS = {
  pending: 'Ждёт связи с компьютером', queued: 'В очереди', downloading: 'Загрузка', transcribing: 'Распознавание',
  extracting: 'Формирование рецепта', done: 'Готово', needs_review: 'Нужно уточнить', error: 'Ошибка',
  duplicate: 'Уже в коллекции', rejected: 'Ошибка',
};
const CATEGORIES = ['Завтраки', 'Супы', 'Салаты', 'Закуски', 'Основные блюда', 'Гарниры', 'Выпечка', 'Десерты',
  'Напитки', 'Соусы', 'Заготовки', 'Детское меню'];

const imageCache = new Map();
const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е');

function searchText(r) {
  return norm([r.title, r.description, r.author, r.source_name, ...(r.ingredients || []).map((i) => i.name),
    ...(r.tags || []), ...(r.categories || [])].join(' '));
}

function summary(r) {
  return {
    key: r.uid, uid: r.uid, title: r.title, description: r.description, categories: r.categories || [],
    tags: r.tags || [], favorite: !!r.favorite, needs_review: !!r.needs_review, image: r.image,
    source_kind: r.source_kind, source_name: r.source_name,
    total_time_min: r.total_time_min || ((r.prep_time_min || 0) + (r.cook_time_min || 0)) || null,
    servings: r.servings, created_at: r.created_at,
  };
}

async function liveRecipes() {
  return (await core.dbAll('recipes')).filter((r) => !r._deleted);
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
    key: it.cid, kind: it.text ? 'text' : 'url', url: it.url, title: job.title || null, status,
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
    if (!row) return null;
    const url = URL.createObjectURL(row.blob);
    imageCache.set(name, url);
    return url;
  },
  async listRecipes({ q, category, favorite, review }) {
    let items = await liveRecipes();
    const counts = {};
    items.forEach((r) => (r.categories || []).forEach((c) => (counts[c] = (counts[c] || 0) + 1)));
    if (q) {
      const words = norm(q).match(/[\p{L}\p{N}]+/gu) || [];
      items = items.filter((r) => { const t = searchText(r); return words.every((w) => t.includes(w)); });
    }
    if (category) items = items.filter((r) => (r.categories || []).includes(category));
    if (favorite) items = items.filter((r) => r.favorite);
    if (review) items = items.filter((r) => r.needs_review);
    items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return { items: items.map(summary), categories: CATEGORIES, category_counts: counts };
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
    scheduleSync();
    return { ...next, key };
  },
  async setFavorite(key, favorite) {
    const r = await core.dbGet('recipes', key);
    if (!r) return;
    Object.assign(r, { favorite, updated_at: new Date().toISOString(), _dirty: 1 });
    await core.dbPut('recipes', r);
    scheduleSync();
  },
  async deleteRecipe(key) {
    const r = await core.dbGet('recipes', key);
    if (!r) return;
    Object.assign(r, { _deleted: true, updated_at: new Date().toISOString(), _dirty: 1 });
    await core.dbPut('recipes', r);
    scheduleSync();
  },
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
      const res = await core.api('/api/grocery/chains');
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
  geocode: (query) => online(() => core.api('/api/grocery/geocode', { method: 'POST', body: { query } })),
  setLocation: (loc) => online(() => core.api('/api/grocery/location', { method: 'POST', body: loc, timeout: 120000 })),
  async limits() {
    try { const l = await core.api('/api/limits'); await core.kv.set('limits', l); return l; }
    catch { return core.kv.get('limits'); }
  },
  system: () => online(() => core.api('/api/system')),
  activeCount: () => core.activeJobs(),
  async connection() {
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
