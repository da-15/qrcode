// ネット優先なので、更新のたびにこの名前を変える必要はありません（ファイルを消したときだけ変える）
const CACHE = 'qr-reader-v17';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './jsQR.js',
  './manifest.webmanifest',
  './icons/app-192-w.png',
  './icons/apple-touch-180-w.png',
  './icons/app-512-w.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 画面とスクリプトはネット優先（更新がすぐ届く）、オフライン時はキャッシュ
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(async () =>
        (await caches.match(e.request, { ignoreSearch: true })) ||
        // 画面の読み込みだけはトップページで代用。画像などは失敗のまま返す
        (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
