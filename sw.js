self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
  if (!event.request.url.startsWith('http')) return;
  event.respondWith(
    fetch(event.request).catch(function() {
      if (event.request.mode === 'navigate') {
        return caches.match('/').then(function(cached) {
          return cached || Response.error();
        });
      }
      return Response.error();
    })
  );
});
