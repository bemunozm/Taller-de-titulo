/*
 * Service worker del kiosko (/digital-concierge). Escrito a mano, sin
 * dependencias, y registrado SOLO desde la vista del kiosko (alcance
 * `/digital-concierge`).
 *
 * Para qué sirve: que el kiosko pueda recargarse sin red (Fully Kiosk recarga la
 * página) y arranque igual, para mostrar su propia pantalla "sin conexión" en
 * vez del error del navegador.
 *
 * Qué guarda (todo es contenido público y estático de la propia app):
 * - la navegación al kiosko, "network-first": siempre intenta la red (con
 *   plazo) y solo si falla responde con el último HTML guardado;
 * - `/assets/*` (archivos con hash), "cache-first";
 * - el manifest y los íconos.
 *
 * Qué NO guarda, nunca: `/api`, el socket (`/socket.io`), cualquier request que
 * no sea GET del mismo origen, respuestas con redirección, con `no-store` o
 * `private`, ni nada que no sea una respuesta 200 básica. Las credenciales del
 * kiosko viajan en headers hacia el backend (otro origen o `/api`) y jamás pasan
 * por esta caché.
 *
 * Para invalidar todo, cambiar VERSION: `activate` borra las cachés viejas.
 */
'use strict'

const VERSION = 'v1'
const CACHE_PREFIX = 'vigilia-kiosk-'
const CACHE_NAME = CACHE_PREFIX + VERSION

const KIOSK_PATH = '/digital-concierge'
const STATIC_URLS = ['/kiosk.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon-64.png']
/** Plazo de la red para la navegación antes de caer a la caché (cobertura "lie-fi"). */
const NAVIGATION_NETWORK_TIMEOUT_MS = 5000
/** Tope de archivos de `/assets/`: al pasarlo se descartan los más antiguos (builds viejos). */
const MAX_CACHED_ASSETS = 80
const NEVER_CACHE_PREFIXES = ['/api', '/socket.io']

function isKioskNavigation(request, url) {
  return (
    request.mode === 'navigate' &&
    (url.pathname === KIOSK_PATH || url.pathname.startsWith(KIOSK_PATH + '/'))
  )
}

function isHtml(response) {
  const type = response.headers.get('content-type') || ''
  return type.indexOf('text/html') !== -1
}

/** Solo respuestas públicas, completas y sin redirección. */
function isCacheable(response) {
  if (!response || response.status !== 200 || response.type !== 'basic' || response.redirected) {
    return false
  }
  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase()
  return cacheControl.indexOf('no-store') === -1 && cacheControl.indexOf('private') === -1
}

function assetUrlsFrom(html) {
  const urls = []
  const pattern = /(?:src|href)=["'](\/assets\/[^"'?#]+)["']/g
  let match = pattern.exec(html)
  while (match) {
    if (urls.indexOf(match[1]) === -1) {
      urls.push(match[1])
    }
    match = pattern.exec(html)
  }
  return urls
}

async function cacheUrl(cache, url) {
  try {
    const response = await fetch(url)
    // Un asset inexistente puede devolver el index.html (rewrite de la SPA): no se guarda.
    if (isCacheable(response) && !isHtml(response)) {
      await cache.put(url, response)
    }
  } catch (error) {
    // Sin red durante la instalación: se llenará con el uso.
  }
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(KIOSK_PATH, { cache: 'reload' })
    if (isCacheable(response) && isHtml(response)) {
      const html = await response.clone().text()
      await cache.put(KIOSK_PATH, response)
      // Sin esto, la primera recarga sin red encontraría el HTML pero no sus scripts.
      await Promise.all(assetUrlsFrom(html).map((url) => cacheUrl(cache, url)))
    }
  } catch (error) {
    // Instalación sin red: no es un error, la caché se llenará en la próxima visita.
  }
  await Promise.all(STATIC_URLS.map((url) => cacheUrl(cache, url)))
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(request, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Navegación: red primero; sin red (o muy lenta), el último HTML del kiosko. */
async function navigationResponse(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetchWithTimeout(request, NAVIGATION_NETWORK_TIMEOUT_MS)
    if (isCacheable(response) && isHtml(response)) {
      // Todas las rutas del kiosko sirven el mismo index.html: una sola entrada.
      await cache.put(KIOSK_PATH, response.clone())
    }
    return response
  } catch (error) {
    const cached = await cache.match(KIOSK_PATH)
    if (cached) {
      return cached
    }
    return new Response('Sin conexión', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

async function trimAssets(cache) {
  const keys = await cache.keys()
  const assetKeys = keys.filter((key) => new URL(key.url).pathname.indexOf('/assets/') === 0)
  const excess = assetKeys.length - MAX_CACHED_ASSETS
  for (let index = 0; index < excess; index += 1) {
    await cache.delete(assetKeys[index])
  }
}

/** `/assets/*` lleva hash en el nombre: lo guardado nunca queda desactualizado. */
async function assetResponse(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) {
    return cached
  }
  const response = await fetch(request)
  if (isCacheable(response) && !isHtml(response)) {
    await cache.put(request, response.clone())
    await trimAssets(cache)
  }
  return response
}

/** Manifest e íconos: red primero, caché de respaldo. */
async function staticResponse(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (isCacheable(response) && !isHtml(response)) {
      await cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) {
      return cached
    }
    throw error
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  // Otro origen (el backend, fuentes, WebRTC): ni se toca.
  if (url.origin !== self.location.origin) {
    return
  }
  if (NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.indexOf(prefix) === 0)) {
    return
  }

  if (isKioskNavigation(request, url)) {
    event.respondWith(navigationResponse(request))
  } else if (url.pathname.indexOf('/assets/') === 0) {
    event.respondWith(assetResponse(request))
  } else if (url.pathname === '/kiosk.webmanifest' || url.pathname.indexOf('/icons/') === 0) {
    event.respondWith(staticResponse(request))
  }
})
