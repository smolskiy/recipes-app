// Ядро офлайн-режима: хранилище на телефоне (IndexedDB) и синхронизация с домашним ПК.
// Используется и страницей, и service worker (фоновая отправка ссылок).

const DB_NAME = 'recipes-app';
const DB_VERSION = 1;
const NATIVE = typeof self !== 'undefined' && !!self.Capacitor?.isNativePlatform?.();
export const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('recipes-sync') : null;
// BroadcastChannel не доставляет сообщение тому же окну, которое его отправило, — поэтому ещё и локальные события.
export const events = new EventTarget();

// ---------- IndexedDB ----------
let dbPromise = null;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of [['recipes', 'uid'], ['images', 'name'], ['outbox', 'cid'], ['kv', 'k'], ['shopping', 'key']]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const getDB = () => (dbPromise ||= openDB());
const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const txDone = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export async function dbGet(store, key) { const db = await getDB(); return reqP(db.transaction(store).objectStore(store).get(key)); }
export async function dbAll(store) { const db = await getDB(); return reqP(db.transaction(store).objectStore(store).getAll()); }
export async function dbPut(store, value) { const db = await getDB(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(value); return txDone(t); }
export async function dbPutMany(store, values) { if (!values.length) return; const db = await getDB(); const t = db.transaction(store, 'readwrite'); const s = t.objectStore(store); values.forEach((v) => s.put(v)); return txDone(t); }
export async function dbDel(store, key) { const db = await getDB(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).delete(key); return txDone(t); }
export async function dbClear(store) { const db = await getDB(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).clear(); return txDone(t); }

export const kv = {
  async get(k, fallback = null) { const row = await dbGet('kv', k); return row ? row.v : fallback; },
  set(k, v) { return dbPut('kv', { k, v }); },
  del(k) { return dbDel('kv', k); },
};

export function newId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function emit(type, data = {}) {
  const msg = { type, ...data };
  try { channel?.postMessage(msg); } catch { /* закрыт */ }
  events.dispatchEvent(new MessageEvent('message', { data: msg }));
}

// ---------- Связь с ПК ----------
export class AuthError extends Error {}
export class OfflineError extends Error {}

function isPrivateHost(host) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)/.test(host);
}

async function candidates() {
  const eps = await kv.get('endpoints', { lan: [], wan: [], http_lan: [] });
  const last = await kv.get('lastEndpoint');
  const securePage = self.location.protocol === 'https:' && !NATIVE;
  const list = [];
  const add = (url, kind) => {
    if (!url) return;
    url = url.replace(/\/+$/, '');
    if (securePage && url.startsWith('http:')) return; // смешанное содержимое запрещено браузером
    if (!list.some((x) => x.url === url)) list.push({ url, kind });
  };
  if (last) add(last.url, last.kind);
  // Адрес страницы — это ПК, только если страницу отдал сам ПК (а не GitHub Pages).
  if (!NATIVE && (await kv.get('originIsPc', false))) add(self.location.origin, isPrivateHost(self.location.hostname) ? 'lan' : 'wan');
  (eps.lan || []).forEach((u) => add(u, 'lan'));
  (eps.http_lan || []).forEach((u) => add(u, 'lan'));
  (eps.wan || []).forEach((u) => add(u, 'wan'));
  return list;
}

// Порядок групп: приложение с ПК или APK — сначала дом; приложение с GitHub Pages — сначала интернет
// (домашний адрес с публичной страницы вызывает запрос разрешения на доступ к локальной сети).
async function groups(list) {
  const lanFirst = NATIVE || (await kv.get('originIsPc', false));
  const last = await kv.get('lastEndpoint');
  const lan = list.filter((e) => e.kind === 'lan');
  const wan = list.filter((e) => e.kind === 'wan');
  const out = [];
  if (last) out.push(list.filter((e) => e.url === last.url));
  out.push(...(lanFirst ? [lan, wan] : [wan, lan]));
  return out.filter((g) => g.length);
}

let current = null; // { url, kind, at }

async function probe(ep, token, ms = 3500) {
  const r = await fetch(ep.url + '/api/device/ping', {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(ms),
  });
  if (r.status === 401) throw new AuthError('Телефон отключён на компьютере. Подключите его заново.');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ep;
}

export async function connect(force = false) {
  const token = await kv.get('token');
  if (!token) throw new AuthError('Приложение ещё не подключено к компьютеру');
  if (!force && current && Date.now() - current.at < 60000) return current;
  const list = await candidates();
  let found = null;
  let authErr = null;
  for (const group of await groups(list)) {
    const results = await Promise.allSettled(group.map((ep) => probe(ep, token)));
    authErr ||= results.find((r) => r.status === 'rejected' && r.reason instanceof AuthError)?.reason;
    const ok = results.findIndex((r) => r.status === 'fulfilled');
    if (ok >= 0) { found = group[ok]; break; }
  }
  if (!found) {
    current = null;
    await setConn({ state: 'offline', tried: list.map((e) => e.url) });
    if (authErr) throw authErr;
    throw new OfflineError('Нет связи с домашним компьютером');
  }
  current = { ...found, at: Date.now() };
  await kv.set('lastEndpoint', { url: current.url, kind: current.kind });
  await setConn({ state: current.kind, endpoint: current.url });
  return current;
}

async function setConn(conn) {
  conn.at = new Date().toISOString();
  if (conn.state !== 'offline') await kv.set('lastOnline', conn.at);
  await kv.set('conn', conn);
  emit('conn', { conn });
}

export async function api(path, { method = 'GET', body, timeout = 25000, raw = false } = {}) {
  const token = await kv.get('token');
  for (let attempt = 0; attempt < 2; attempt++) {
    const ep = await connect(attempt > 0);
    let res;
    try {
      res = await fetch(ep.url + path, {
        method, cache: 'no-store', signal: AbortSignal.timeout(timeout),
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      current = null; // адрес перестал отвечать — выбираем заново
      if (attempt === 1) throw new OfflineError('Связь с компьютером прервалась');
      continue;
    }
    if (res.status === 401) {
      await kv.set('authLost', true);
      emit('auth');
      throw new AuthError('Телефон отключён на компьютере. Подключите его заново в разделе «Связь».');
    }
    if (raw) return res;
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err = new Error((data && data.detail) || `Ошибка компьютера (${res.status})`);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }
}

// ---------- Привязка ----------
export async function pair(baseUrl, code, name) {
  const res = await fetch(baseUrl.replace(/\/+$/, '') + '/api/device/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ code, name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Ошибка привязки (${res.status})`);
  await kv.set('token', data.token);
  await kv.set('device', data.device);
  await kv.set('endpoints', data.endpoints);
  await kv.set('lastEndpoint', { url: baseUrl.replace(/\/+$/, ''), kind: isPrivateHost(new URL(baseUrl).hostname) ? 'lan' : 'wan' });
  await kv.del('authLost');
  current = null;
  return data;
}

export async function unpair() {
  for (const k of ['token', 'device', 'lastEndpoint', 'conn', 'authLost']) await kv.del(k);
  current = null;
  emit('conn', { conn: { state: 'unpaired' } });
}

// ---------- Очередь ссылок ----------
export function extractUrl(text) {
  const m = (text || '').match(/https?:\/\/[^\s<>"'«»]+/);
  return m ? m[0].replace(/[.,;:!?)\]}]+$/, '') : null;
}

export async function enqueue({ url = '', text = '', force = false }) {
  url = (url || '').trim();
  text = (text || '').trim();
  if (!url && text && text.length < 300) {
    const found = extractUrl(text);
    if (found) { url = found; text = ''; }
  }
  if (url && !/^https?:\/\//i.test(url)) {
    const found = extractUrl(url);
    url = found || (url.includes('.') ? 'https://' + url : url);
  }
  if (!url && text.length < 40) throw new Error(text ? 'Текст слишком короткий — вставьте рецепт целиком' : 'Вставьте ссылку или текст рецепта');
  const item = { cid: newId(), url: url || null, text: url ? null : text, force, state: 'pending', created_at: new Date().toISOString(), job: null, error: null };
  await dbPut('outbox', item);
  emit('outbox');
  return item;
}

export async function sendOutbox() {
  const items = (await dbAll('outbox')).filter((i) => i.state === 'pending');
  let sent = 0;
  for (const it of items) {
    try {
      const res = await api('/api/device/jobs', { method: 'POST', body: { client_id: it.cid, url: it.url, text: it.text, force: !!it.force } });
      Object.assign(it, { state: 'sent', job: res.job, error: null });
      sent++;
    } catch (e) {
      if (e instanceof OfflineError || e instanceof AuthError) throw e;
      if (e.status === 409) Object.assign(it, { state: 'duplicate', error: e.message, dup: e.data });
      else if (e.status === 400 || e.status === 422) Object.assign(it, { state: 'rejected', error: e.message });
      else Object.assign(it, { error: e.message });
    }
    await dbPut('outbox', it);
    emit('outbox');
  }
  return sent;
}

const FINAL = ['done', 'needs_review', 'error'];

async function refreshJobs() {
  const items = (await dbAll('outbox')).filter((i) => i.state === 'sent' && i.job && !FINAL.includes(i.job.status));
  if (!items.length) return false;
  const res = await api('/api/device/jobs/status', { method: 'POST', body: { ids: items.map((i) => i.job.id) } });
  const byId = new Map(res.items.map((j) => [j.id, j]));
  let finished = false;
  for (const it of items) {
    const job = byId.get(it.job.id);
    if (!job) continue;
    if (FINAL.includes(job.status)) finished = true;
    it.job = job;
    await dbPut('outbox', it);
  }
  emit('outbox');
  return finished;
}

// ---------- Рецепты ----------
async function pushChanges() {
  const dirty = (await dbAll('recipes')).filter((r) => r._dirty);
  if (!dirty.length) return;
  const items = dirty.map((r) => ({ uid: r.uid, deleted: !!r._deleted, updated_at: r.updated_at, recipe: r._deleted ? null : toRecipeIn(r) }));
  const res = await api('/api/device/push', { method: 'POST', body: { items }, timeout: 60000 });
  let stale = false;
  for (const r of dirty) {
    const status = res.results[r.uid];
    if (status === 'applied' || status === 'missing') {
      if (r._deleted) await dbDel('recipes', r.uid);
      else { delete r._dirty; await dbPut('recipes', r); }
    } else if (status === 'stale') {
      stale = true; // на ПК правка новее — заберём её полной синхронизацией
      delete r._dirty;
      if (r._deleted) delete r._deleted;
      await dbPut('recipes', r);
    }
  }
  if (stale) await kv.set('cursor', 0);
}

const RECIPE_FIELDS = ['title', 'description', 'servings', 'servings_text', 'prep_time_min', 'cook_time_min', 'total_time_min',
  'ingredients', 'steps', 'tips', 'categories', 'tags', 'author', 'source_url', 'source_name', 'issues', 'needs_review', 'favorite'];
export function toRecipeIn(r) {
  const out = {};
  for (const f of RECIPE_FIELDS) out[f] = r[f] ?? (Array.isArray(r[f]) ? [] : null);
  for (const f of ['ingredients', 'steps', 'tips', 'categories', 'tags', 'issues']) out[f] = out[f] || [];
  out.needs_review = !!out.needs_review; out.favorite = !!out.favorite;
  return out;
}

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function pullChanges() {
  let cursor = await kv.get('cursor', 0);
  let changed = 0;
  for (let page = 0; page < 50; page++) {
    const res = await api(`/api/device/sync?since=${cursor}&limit=200`, { timeout: 60000 });
    const puts = [];
    for (const item of res.items) {
      const local = await dbGet('recipes', item.uid);
      if (local && local._dirty && local.updated_at > item.updated_at) continue; // своя правка новее — отправим её
      if (item.deleted) {
        if (local) { await dbDel('recipes', item.uid); changed++; }
        continue;
      }
      const rec = { ...item.recipe, uid: item.uid, seq: item.seq, updated_at: item.updated_at };
      if (local?._source) rec._source = local._source;
      puts.push(rec);
    }
    await dbPutMany('recipes', puts);
    changed += puts.length;
    cursor = res.cursor;
    await kv.set('cursor', cursor);
    if (!res.more) break;
  }
  await fetchMissingImages();
  return changed;
}

async function fetchMissingImages() {
  const recipes = await dbAll('recipes');
  const have = new Set((await dbAll('images')).map((i) => i.name));
  const need = [...new Set(recipes.map((r) => r.image).filter((n) => n && !have.has(n)))];
  for (const name of need) {
    try {
      const res = await api(`/api/device/images/${name}`, { timeout: 30000 });
      await dbPut('images', { name, blob: b64ToBlob(res.data, res.type || 'image/jpeg') });
      emit('image', { name });
    } catch (e) {
      if (e instanceof OfflineError || e instanceof AuthError) throw e;
    }
  }
}

// ---------- Полная синхронизация ----------
let running = null;
export function syncAll(reason = '') {
  if (running) return running;
  running = (async () => {
    const token = await kv.get('token');
    if (!token) return { ok: false, state: 'unpaired' };
    try {
      await connect();
      await sendOutbox();
      await pushChanges();
      await refreshJobs();
      const changed = await pullChanges();
      await kv.set('lastSync', new Date().toISOString());
      await kv.del('lastSyncError');
      emit('synced', { changed, reason });
      return { ok: true, changed };
    } catch (e) {
      await kv.set('lastSyncError', e.message);
      emit('sync-error', { message: e.message, offline: e instanceof OfflineError, auth: e instanceof AuthError });
      return { ok: false, error: e.message, offline: e instanceof OfflineError };
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function activeJobs() {
  return (await dbAll('outbox')).filter((i) => i.state === 'pending' || (i.state === 'sent' && i.job && !FINAL.includes(i.job.status))).length;
}
