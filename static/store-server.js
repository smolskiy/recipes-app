// Режим ПК (домашняя сеть, http://ПК:8765): данные берутся прямо с сервера.

class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

async function api(path, { method = 'GET', body, text = false } = {}) {
  const opts = { method, headers: {} };
  if (method !== 'GET') opts.headers['X-Recipes'] = '1';
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); } catch { throw new ApiError('Нет связи с сервером. Проверьте, что компьютер включён и вы в домашней сети.', 0); }
  if (text && res.ok) return res.text();
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) {
    let msg = data?.detail;
    if (Array.isArray(msg)) msg = msg.map((d) => d.msg).join('; ');
    throw new ApiError(msg || `Ошибка сервера (${res.status})`, res.status, data);
  }
  return data;
}

const withKey = (r) => (r ? { ...r, key: String(r.id) } : r);

// «Есть дома» на ПК хранится в этом браузере.
function readLocal(k, fallback) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeLocal(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим — не запоминаем */ }
}

export const serverStore = {
  mode: 'server',
  api,
  refreshCatalog: (chain) => api(`api/grocery/catalog/${chain}/refresh`, { method: 'POST' }),
  async init() {},
  imageUrl: async (name) => (name ? `images/${name}` : null),
  // Все краткие карточки раздела: поиск, фильтры и сортировку делает listing.js.
  async listRecipes({ collection = 'mine' } = {}) {
    const data = await api('api/recipes?collection=' + encodeURIComponent(collection));
    return { ...data, items: data.items.map(withKey) };
  },
  async getRecipe(key) {
    const { recipe, job } = await api(`api/recipes/${key}`);
    return { recipe: withKey(recipe), job };
  },
  source: (key) => api(`api/recipes/${key}/source`, { text: true }),
  saveRecipe: async (key, body) => withKey((await api(`api/recipes/${key}`, { method: 'PUT', body })).recipe),
  setFavorite: (key, favorite) => api(`api/recipes/${key}/favorite`, { method: 'POST', body: { favorite } }),
  setSaved: (key, saved) => api(`api/recipes/${key}/saved`, { method: 'POST', body: { saved } }),
  async getPantry() { return readLocal('pantry', null); },
  async setPantry(value) { writeLocal('pantry', value); },
  channels: () => api('api/channels'),
  addChannel: (url, limit) => api('api/channels', { method: 'POST', body: { url, limit } }),
  channelAction: (id, action) => api(`api/channels/${id}/${action}`, { method: 'POST' }),
  deleteChannel: (id) => api(`api/channels/${id}`, { method: 'DELETE' }),
  renameChannel: (id, title) => api(`api/channels/${id}/rename`, { method: 'POST', body: { title } }),
  deleteRecipe: (key) => api(`api/recipes/${key}`, { method: 'DELETE' }),
  reprocess: (key) => api(`api/recipes/${key}/reprocess`, { method: 'POST' }),
  addJob: (body) => api('api/jobs', { method: 'POST', body }),
  async listJobs() {
    const { items } = await api('api/jobs?limit=30');
    return items.map((j) => ({ ...j, key: String(j.id), recipe_keys: j.recipe_ids.map(String) }));
  },
  retryJob: (key) => api(`api/jobs/${key}/retry`, { method: 'POST' }),
  deleteJob: (key) => api(`api/jobs/${key}`, { method: 'DELETE' }),
  jobSource: (key) => api(`api/jobs/${key}/source`, { text: true }),
  shopping: (key, chain, scale) => api(`api/recipes/${key}/shopping?chain=${chain}&scale=${scale}`),
  chains: () => api('api/grocery/chains'),
  setDefaultChain: (chain) => api('api/grocery/default', { method: 'POST', body: { chain } }),
  stores: (chain) => api(`api/grocery/stores?chain=${chain}`),
  setStore: (store) => api('api/grocery/store', { method: 'POST', body: store }),
  groceryCheck: (chain) => api(`api/grocery/check?chain=${chain}`),
  grocerySearch: (chain, q) => api(`api/grocery/search?chain=${chain}&q=${encodeURIComponent(q)}`),
  geocode: (query) => api('api/grocery/geocode', { method: 'POST', body: { query } }),
  setLocation: (loc) => api('api/grocery/location', { method: 'POST', body: loc }),
  limits: () => api('api/limits'),
  system: () => api('api/system'),
  backup: () => api('api/backup', { method: 'POST' }),
  async activeCount() {
    const items = await this.listJobs();
    return items.filter((j) => ['queued', 'downloading', 'transcribing', 'extracting'].includes(j.status)).length;
  },
  // Управление телефонами и внешним доступом — только с ПК.
  devices: () => api('api/devices'),
  pairCode: () => api('api/devices/pair-code', { method: 'POST' }),
  revokeDevice: (id) => api(`api/devices/${id}`, { method: 'DELETE' }),
  net: () => api('api/net'),
  setNet: (body) => api('api/net', { method: 'PUT', body }),
  cloud: () => api('api/cloud'),
  setCloud: (body) => api('api/cloud', { method: 'PUT', body }),
  cloudUpload: () => api('api/cloud/upload', { method: 'POST' }),
  cloudDisconnect: () => api('api/cloud', { method: 'DELETE' }),
};
