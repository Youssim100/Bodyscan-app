// Offline support.
// 1. Install caches the small app shell, so the app opens offline right away.
// 2. Voices (~25 MB) download one clip at a time into their own cache when the page
//    asks ('cache-audio'). An interrupted download resumes on the next visit, and
//    progress is reported to the page.
// Bump VERSION whenever app files change. Bump AUDIO_CACHE only when voice files change.
const VERSION = 'bodyscan-v11';
const AUDIO_CACHE = 'bodyscan-audio-v2';
const CORE = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/audio.js',
  'js/body.js',
  'js/content.js',
  'js/selection.js',
  'js/theme.js',
  'js/session.js',
  'js/timing.js',
  'data/durations.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // 'reload' skips the browser's HTTP cache (GitHub Pages allows 10 min), so a new
    // version never gets stored together with stale copies of the old files.
    await (await caches.open(VERSION)).addAll(CORE.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION && key !== AUDIO_CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
  // Start the voices right away too, in case the open page is an older version that never asks.
  cacheAudio();
});

self.addEventListener('message', (event) => {
  if (event.data === 'cache-audio') event.waitUntil(cacheAudio());
});

async function broadcast(msg) {
  const appFiles = (await (await caches.open(VERSION)).keys()).length;
  const full = { ...msg, version: VERSION, appFiles, appTotal: CORE.length };
  for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(full);
}

let running = null;
function cacheAudio() {
  running ??= downloadAudio().finally(() => { running = null; });
  return running;
}

async function downloadAudio() {
  const durationsRes = (await caches.match('data/durations.json')) || (await fetch('data/durations.json'));
  const durations = await durationsRes.json();
  const urls = Object.entries(durations).flatMap(([narrator, clips]) =>
    Object.keys(clips).map((id) => new URL(`audio/${narrator}/${id}.mp3`, self.registration.scope).href));
  const cache = await caches.open(AUDIO_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const todo = urls.filter((u) => !have.has(u));
  let done = urls.length - todo.length;
  let failed = 0;
  await broadcast({ type: 'audio-progress', done, total: urls.length, failed, finished: !todo.length });

  // A few clips at a time; each one is saved as soon as it arrives.
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const url = todo[next++];
      try {
        await cache.add(url);
      } catch {
        failed++;
      }
      done++;
      if (done % 6 === 0 || done === urls.length) {
        await broadcast({ type: 'audio-progress', done: done - failed, total: urls.length, failed, finished: false });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await broadcast({ type: 'audio-progress', done: urls.length - failed, total: urls.length, failed, finished: true });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const target = url.pathname.includes('/audio/') ? AUDIO_CACHE : VERSION;
        (await caches.open(target)).put(request, response.clone());
      }
      return response;
    } catch (err) {
      if (request.mode === 'navigate') return (await caches.match('index.html', { ignoreSearch: true })) || Response.error();
      throw err;
    }
  })());
});
