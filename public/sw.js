const CACHE_NAME = 'sirachat-v14';

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all(
      ['/', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
       '/mediapipe/selfie_segmentation.js',
       '/mediapipe/selfie_segmentation.binarypb',
       '/mediapipe/selfie_segmentation.tflite',
       '/mediapipe/selfie_segmentation_landscape.tflite',
       '/mediapipe/selfie_segmentation_solution_simd_wasm_bin.js',
       '/mediapipe/selfie_segmentation_solution_simd_wasm_bin.wasm',
       '/mediapipe/selfie_segmentation_solution_wasm_bin.js',
       '/mediapipe/selfie_segmentation_solution_wasm_bin.wasm'].map((p) =>
        caches.open(CACHE_NAME).then((cache) =>
          fetch(p).then((res) => {
            if (res.ok) return cache.put(p, res);
          }).catch(() => {})
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // Network-first for JS/CSS/assets so users always get fresh code
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'سیرا چت', body: 'پیام جدید', chat_id: '', icon: '/icon-192.png', badge: '/icon-192.png' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      data: { chat_id: data.chat_id },
      vibrate: [200, 100, 200],
      tag: data.chat_id || 'sirachat',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chat_id;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.postMessage({ type: 'open-chat', chat_id: chatId });
        return existing.focus();
      }
      const url = chatId ? `/?chat=${chatId}` : '/';
      return self.clients.openWindow(url);
    })
  );
});
