/* Service worker mínimo: hace que el panel se pueda instalar como app.
   No guarda nada en caché a propósito: el panel siempre carga la versión más
   nueva y los pedidos al servidor (PIN, canjes, QR) nunca pasan por una copia vieja. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function () { /* sin caché: la red responde directo */ });
