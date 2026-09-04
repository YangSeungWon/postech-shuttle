'use strict';

/* ------------------------------------------------------------------ *
 * 오프라인 지원.
 *
 * 시간표·노선·보행 그래프가 전부 정적 파일이라 지도 타일만 있으면 통째로
 * 오프라인으로 동작한다. 캠퍼스 실내나 신호가 약한 곳에서 쓸모가 있다.
 * ------------------------------------------------------------------ */

const VERSION = 'ad4968a91764';
const SHELL = `shuttle-shell-${VERSION}`;
const TILES = 'shuttle-tiles';
const TILE_LIMIT = 600;

/* 앱 자체 — 설치할 때 통째로 담는다 */
const SHELL_FILES = [
  './', './index.html', './map.js', './i18n.js', './planner.js', './walk.js',
  './glmap.js', './map-data.js', './style-muted.json', './style-muted-en.json',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './apple-touch-icon.png',
];
/* 라이브러리 — 다른 출처라 실패해도 설치를 막지 않는다 */
const VENDOR = [
  'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.css',
  'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(SHELL_FILES);
    await Promise.allSettled(VENDOR.map(u => c.add(new Request(u, { mode: 'no-cors' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k !== SHELL && k !== TILES) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

const isTile = u => /tiles\.openfreemap\.org|tile\.openstreetmap\.org/.test(u.hostname);

/** 캐시가 너무 커지지 않게 오래된 것부터 버린다 */
async function trim(name, limit) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - limit; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  /* 지도 타일 — 캐시를 먼저 주고 뒤에서 갱신한다 */
  if (isTile(url)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(request);
      const net = fetch(request).then(res => {
        if (res.ok || res.type === 'opaque') {
          c.put(request, res.clone()).then(() => trim(TILES, TILE_LIMIT));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  /* 앱 파일 — 네트워크를 먼저 보되 실패하면 캐시로 (배포 직후 옛 코드가 남지 않게) */
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    try {
      const res = await fetch(request);
      if (res.ok && url.origin === location.origin) c.put(request, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(request) || await c.match('./index.html');
      if (hit) return hit;
      throw err;
    }
  })());
});
