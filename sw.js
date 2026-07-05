const CACHE_NAME = 'GeorgeTech-Inventory-v3-branding';

// These are the core files the app NEEDS to boot up offline.
const urlsToCache = [
  './index.html',
  './manifest.json',
  './assets/css/variables.css',
  './assets/css/admin.css',
  './assets/css/inventory-style.css',
  './assets/js/inventory.js',
  './assets/js/offline-engine.js',
  './assets/images/android-chrome-192x192.png',
  './assets/images/android-chrome-512x512.png',
  './assets/images/android-chrome-maskable-512x512.png',
  './assets/images/logo.png',
  // External libraries we rely on
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/dexie/dist/dexie.js',
  'https://unpkg.com/html5-qrcode'
];

// 1. Install Event: Save the core files to the device
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Service Worker: Caching App Shell');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// 2. Activate Event: Clean up old caches if we update the version number
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🧹 Service Worker: Clearing Old Cache');
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event: The Interceptor (Network First, fallback to Cache)
self.addEventListener('fetch', event => {
  // We only want to intercept basic GET requests (HTML, CSS, JS, Images)
  // We DO NOT intercept Supabase API calls (POST/PATCH/DELETE) here.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If we got a good response from the internet, clone it and update the cache so it's always fresh
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // If the internet is down (fetch failed), look in the cache!
        console.log('📶 Offline: Serving from Cache ->', event.request.url);
        return caches.match(event.request);
      })
  );
});
