/**
 * AI 会話ログ Markdown 変換 - sw.js（Service Worker。オフライン対応にするツールだけ使う）
 * hoshizora-sanpo の sw.js と同じ方針:
 * - ネットワーク優先。オンラインなら常に最新を取得してキャッシュも更新し、オフライン（または応答が遅い）ときだけキャッシュを返す
 * - yorozu-craft.com の各ツールは同じオリジンでキャッシュ領域を共有するため、
 *   キャッシュ名には必ず "ai-log-" を付け、ほかのツールのキャッシュには触れない
 * - 自分のパス配下だけを扱う。広告・アクセス解析など別オリジンや、ほかのツールのファイルは横取りしない
 */

'use strict';

const CACHE_PREFIX = 'ai-log-';
const CACHE_NAME   = `${CACHE_PREFIX}v1`; // キャッシュする中身の構成を変えたら上げる（英語のページ・Web Worker も入れてある）

/** 初回インストール時に取得しておくファイル */
const PRECACHE_URLS = [
  './',
  './index.html',
  './guide.html',
  './en/',
  './en/index.html',
  './en/guide.html',
  './style.css',
  './constants.js',
  './text.js',
  './calc.js',
  './zip.js',
  './engine.js',
  './worker.js',
  './screen.js',
  './main.js',
  './manifest.webmanifest',
  './favicon.svg',
  './apple-touch-icon.png',
];

/** この時間ネットワークが応答しなければ、キャッシュがあればそちらを返す */
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)   // 自分のキャッシュだけ掃除する
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 同じオリジンでも、ほかのツールのファイルには手を出さない
  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;

  const fromNetwork = fetch(request);
  event.waitUntil(
    fromNetwork
      .then((response) => {
        if (!response.ok || response.redirected) return undefined;
        const copy = response.clone();
        return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      })
      .catch(() => undefined),
  );
  event.respondWith(networkFirst(request, fromNetwork));
});

async function networkFirst(request, fromNetwork) {
  try {
    const response = await Promise.race([fromNetwork, delay(NETWORK_TIMEOUT_MS)]);
    if (response) return response;
  } catch {
    // オフライン: 下でキャッシュを探す
  }
  const cache = await caches.open(CACHE_NAME);
  const cached = request.mode === 'navigate'
    ? (await cache.match(request, { ignoreSearch: true })) || cache.match('./')
    : await cache.match(request);
  return cached || fromNetwork;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms, null));
}
