// Self-destructing service worker.
//
// An earlier version of this app shipped a caching service worker. On devices
// that installed it, that old worker can keep replaying stale pages (including
// old 500 error responses) even after the server is fixed. Browsers re-fetch
// the service-worker script itself from the network during their periodic
// update check, so shipping this kill-switch at the same /sw.js path lets every
// affected device pick it up and clean itself out. Nothing registers a service
// worker anymore, so fresh devices are unaffected.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      } catch {
        /* ignore */
      }
      try {
        await self.registration.unregister()
      } catch {
        /* ignore */
      }
      // Reload any open tabs so they re-fetch from the (now healthy) network.
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        try {
          client.navigate(client.url)
        } catch {
          /* ignore */
        }
      }
    })()
  )
})

// Pass everything straight to the network — never serve from cache.
self.addEventListener('fetch', () => {})
