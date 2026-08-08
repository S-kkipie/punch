const CACHE_NAME = "punch-shell-v1";
const SHELL_URLS = [
    "/offline",
    "/manifest.webmanifest",
    "/icons/punch-192.svg",
    "/icons/punch-512.svg",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)),
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter(
                            (key) =>
                                key.startsWith("punch-shell-") &&
                                key !== CACHE_NAME,
                        )
                        .map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== self.location.origin)
        return;
    if (url.pathname.startsWith("/api/")) return;
    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request).catch(() => caches.match("/offline")),
        );
        return;
    }
    event.respondWith(
        caches.match(event.request).then((hit) => hit ?? fetch(event.request)),
    );
});
