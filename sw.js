const CACHE_NAME = "cadenza-cache-v20.2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/config.js",
  "./js/ui.js",
  "./js/admin.js",
  "./js/polls.js",
  "./js/agenda.js",
  "./js/ensemble.js",
  "./js/app.js"
];

// Installation et mise en cache de l'interface
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Nettoyage des anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie Network-First avec repli hors-ligne
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});

// Réception des notifications Push serveur (FCM / Web Push) même app fermée
self.addEventListener("push", (event) => {
  let title = "Cadenza";
  let body = "Nouvelle activité dans votre ensemble.";
  let url = "./";

  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.notification?.title || payload.data?.title || title;
      body = payload.notification?.body || payload.data?.body || body;
      url = payload.data?.url || url;
    } catch (_) {
      body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: "cadenza-push",
      renotify: true,
      data: { url }
    })
  );
});

// Ouverture directe de l'application au clic sur la notification
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
