// Service worker приложения «Наши рецепты»:
// - оболочка приложения кэшируется, поэтому оно открывается без сети;
// - «Поделиться → Рецепты» кладёт ссылку в очередь на телефоне даже без связи с ПК;
// - фоновая синхронизация досылает очередь, когда связь появилась.

import { enqueue, extractUrl, syncAll } from './static/sync-core.js';

const VERSION = 'c32b1102d3d8';
const CACHE = `recipes-shell-${VERSION}`;
const SHELL = [
  './', 'manifest.webmanifest',
  'static/app.js', 'static/store-device.js', 'static/store-server.js', 'static/sync-core.js', 'static/styles.css',
  'static/fonts/onest-cyrillic.woff2', 'static/fonts/onest-latin.woff2',
  'static/fonts/unbounded-cyrillic.woff2', 'static/fonts/unbounded-latin.woff2',
  'static/icon.svg', 'static/icon-192.png', 'static/icon-512.png',
];
const scopeUrl = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map(scopeUrl))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('recipes-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function handleShare(url) {
  const shared = url.searchParams.get('url') || '';
  const text = url.searchParams.get('text') || '';
  const title = url.searchParams.get('title') || '';
  const link = extractUrl(shared) || extractUrl(text) || extractUrl(title);
  try {
    if (link) await enqueue({ url: link });
    else if ((text || '').length >= 40) await enqueue({ text });
    else return Response.redirect(scopeUrl('./#/add?url=' + encodeURIComponent(text || shared || title)), 303);
  } catch (e) {
    return Response.redirect(scopeUrl('./#/add?url=' + encodeURIComponent(link || text)), 303);
  }
  self.registration.sync?.register('outbox').catch(() => {});
  syncAll('share'); // попытка сразу; если связи нет — дошлёт фоновая синхронизация
  return Response.redirect(scopeUrl('./#/add?shared=1'), 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null;
  if (rel === null) return;
  if (rel === 'share-target') { event.respondWith(handleShare(url)); return; }
  if (rel.startsWith('api/') || rel.startsWith('images/') || rel === 'ca.crt') return; // данные — только из сети
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(scopeUrl('./'));
      const network = fetch(req).then(async (res) => {
        if (res.ok) (await caches.open(CACHE)).put(scopeUrl('./'), res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('Нет сети', { status: 503 });
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const network = fetch(req).then(async (res) => {
      if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    return (await network) || new Response('', { status: 504 });
  })());
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'outbox') return;
  event.waitUntil(syncAll('background').then((r) => {
    if (!r.ok && r.offline) throw new Error('offline'); // браузер повторит позже
  }));
});
