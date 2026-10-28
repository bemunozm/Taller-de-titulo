import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import swSource from '../public/kiosk-sw.js?raw'
import webManifestRaw from '../public/kiosk.webmanifest?raw'

const ORIGIN = 'https://kiosk.test'
const CACHE_NAME = 'vigilia-kiosk-v1'

interface FakeResponse {
  status: number
  type: string
  redirected: boolean
  headers: { get: (name: string) => string | null }
  body: string
  clone: () => FakeResponse
  text: () => Promise<string>
}

interface FakeResponseInit {
  status?: number
  type?: string
  redirected?: boolean
  headers?: Record<string, string>
  body?: string
}

function makeResponse({ status = 200, type = 'basic', redirected = false, headers = {}, body = '' }: FakeResponseInit = {}): FakeResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  const response: FakeResponse = {
    status,
    type,
    redirected,
    body,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    clone: () => makeResponse({ status, type, redirected, headers, body }),
    text: async () => body,
  }
  return response
}

const html = (body = '') => makeResponse({ headers: { 'content-type': 'text/html; charset=utf-8' }, body })
const js = () => makeResponse({ headers: { 'content-type': 'text/javascript' }, body: 'console.log(1)' })

const INDEX_HTML = `<!doctype html><html><head>
  <script type="module" crossorigin src="/assets/index-abc123.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/vendor-def456.js">
  <link rel="stylesheet" crossorigin href="/assets/index-789xyz.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit">
  <script src="/other/not-an-asset.js"></script>
</head></html>`

class FakeCache {
  readonly store = new Map<string, FakeResponse>()

  private keyOf(request: unknown): string {
    if (typeof request === 'string') {
      return request.startsWith('/') ? ORIGIN + request : request
    }
    return (request as { url: string }).url
  }

  async put(request: unknown, response: FakeResponse): Promise<void> {
    this.store.set(this.keyOf(request), response)
  }

  async match(request: unknown): Promise<FakeResponse | undefined> {
    return this.store.get(this.keyOf(request))
  }

  async keys(): Promise<Array<{ url: string }>> {
    return Array.from(this.store.keys()).map((url) => ({ url }))
  }

  async delete(request: unknown): Promise<boolean> {
    return this.store.delete(this.keyOf(request))
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name)
    if (!cache) {
      cache = new FakeCache()
      this.caches.set(name, cache)
    }
    return cache
  }

  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys())
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }
}

interface FakeRequest {
  method: string
  url: string
  mode: string
}

type Listener = (event: unknown) => void

function request(path: string, init: Partial<FakeRequest> = {}): FakeRequest {
  return { method: 'GET', url: path.startsWith('http') ? path : ORIGIN + path, mode: 'cors', ...init }
}

function setup(fetchImpl: (input: unknown, init?: { signal?: AbortSignal }) => Promise<FakeResponse>) {
  const listeners = new Map<string, Listener>()
  const storage = new FakeCacheStorage()
  const fetchMock = vi.fn(fetchImpl)
  const swSelf = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener)
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  }
  class FakeSwResponse {
    readonly body: string
    readonly status: number

    constructor(body: string, init: { status: number }) {
      this.body = body
      this.status = init.status
    }
  }

  new Function('self', 'caches', 'fetch', 'Response', swSource)(swSelf, storage, fetchMock, FakeSwResponse)

  async function runLifecycle(type: 'install' | 'activate'): Promise<void> {
    let pending: Promise<unknown> = Promise.resolve()
    listeners.get(type)?.({
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise
      },
    })
    await pending
  }

  /** `null` si el SW no interceptó la request (el navegador la maneja por su cuenta). */
  async function dispatchFetch(req: FakeRequest): Promise<FakeResponse | { status: number } | null> {
    let responded: Promise<FakeResponse> | null = null
    listeners.get('fetch')?.({
      request: req,
      respondWith: (promise: Promise<FakeResponse>) => {
        responded = promise
      },
    })
    return responded ? await responded : null
  }

  return { swSelf, storage, fetchMock, runLifecycle, dispatchFetch }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('kiosk-sw.js: instalación', () => {
  it('guarda el shell del kiosko y los assets que referencia, y toma el control enseguida', async () => {
    const harness = setup(async (input) => {
      const url = String(input)
      if (url === '/digital-concierge') return html(INDEX_HTML)
      if (url.startsWith('/assets/') || url.startsWith('/icons/') || url === '/kiosk.webmanifest') return js()
      throw new Error('inesperado ' + url)
    })

    await harness.runLifecycle('install')

    const cache = await harness.storage.open(CACHE_NAME)
    expect(Array.from(cache.store.keys()).sort()).toEqual(
      [
        '/digital-concierge',
        '/assets/index-abc123.js',
        '/assets/vendor-def456.js',
        '/assets/index-789xyz.css',
        '/kiosk.webmanifest',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/icons/favicon-64.png',
      ]
        .map((path) => ORIGIN + path)
        .sort(),
    )
    expect(harness.swSelf.skipWaiting).toHaveBeenCalled()
    // Solo lo propio: ni la fuente externa ni scripts fuera de /assets/.
    const requested = harness.fetchMock.mock.calls.map(([input]) => String(input))
    expect(requested.some((url) => url.includes('googleapis'))).toBe(false)
    expect(requested).not.toContain('/other/not-an-asset.js')
  })

  it('instalar sin red no falla: la caché se llena después con el uso', async () => {
    const harness = setup(async () => {
      throw new Error('Network Error')
    })

    await expect(harness.runLifecycle('install')).resolves.toBeUndefined()

    expect(harness.swSelf.skipWaiting).toHaveBeenCalled()
  })

  it('un asset inexistente que la SPA responde con index.html no se guarda', async () => {
    const harness = setup(async (input) => (String(input) === '/digital-concierge' ? html(INDEX_HTML) : html('<!doctype html>')))

    await harness.runLifecycle('install')

    const cache = await harness.storage.open(CACHE_NAME)
    expect(Array.from(cache.store.keys())).toEqual([ORIGIN + '/digital-concierge'])
  })
})

describe('kiosk-sw.js: activación (versionado de caché)', () => {
  it('borra las cachés viejas del kiosko, deja las ajenas y reclama los clientes', async () => {
    const harness = setup(async () => html())
    await harness.storage.open('vigilia-kiosk-v0')
    await harness.storage.open('vigilia-kiosk-v0-beta')
    await harness.storage.open(CACHE_NAME)
    await harness.storage.open('otra-app-cache')

    await harness.runLifecycle('activate')

    expect(await harness.storage.keys()).toEqual([CACHE_NAME, 'otra-app-cache'])
    expect(harness.swSelf.clients.claim).toHaveBeenCalled()
  })
})

describe('kiosk-sw.js: navegación (network-first)', () => {
  it('con red responde lo de la red y guarda el HTML como respaldo', async () => {
    const network = html('<p>nuevo</p>')
    const harness = setup(async () => network)

    const response = await harness.dispatchFetch(request('/digital-concierge', { mode: 'navigate' }))

    expect(response).toBe(network)
    const cache = await harness.storage.open(CACHE_NAME)
    expect((await cache.match('/digital-concierge'))?.body).toBe('<p>nuevo</p>')
  })

  it('las subrutas del kiosko también se guardan bajo la misma entrada', async () => {
    const harness = setup(async () => html('<p>spa</p>'))

    await harness.dispatchFetch(request('/digital-concierge/otra', { mode: 'navigate' }))

    const cache = await harness.storage.open(CACHE_NAME)
    expect(Array.from(cache.store.keys())).toEqual([ORIGIN + '/digital-concierge'])
  })

  it('sin red responde el último HTML guardado (la pantalla "sin conexión" carga)', async () => {
    let online = true
    const harness = setup(async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return html('<p>guardado</p>')
    })
    await harness.dispatchFetch(request('/digital-concierge', { mode: 'navigate' }))

    online = false
    const response = await harness.dispatchFetch(request('/digital-concierge', { mode: 'navigate' }))

    expect((response as FakeResponse).body).toBe('<p>guardado</p>')
  })

  it('sin red y sin nada guardado responde 503 en vez de colgarse', async () => {
    const harness = setup(async () => {
      throw new TypeError('Failed to fetch')
    })

    const response = await harness.dispatchFetch(request('/digital-concierge', { mode: 'navigate' }))

    expect(response?.status).toBe(503)
  })

  it('con red lenta (lie-fi) cae a la caché a los 5 s en vez de esperar sin fin', async () => {
    let hang = false
    const harness = setup(
      (_input, init) =>
        hang
          ? new Promise<FakeResponse>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
            })
          : Promise.resolve(html('<p>guardado</p>')),
    )
    await harness.dispatchFetch(request('/digital-concierge', { mode: 'navigate' }))

    hang = true
    const pending = harness.dispatchFetch(request('/digital-concierge', { mode: 'navigate' }))
    await vi.advanceTimersByTimeAsync(5_000)
    const response = await pending

    expect((response as FakeResponse).body).toBe('<p>guardado</p>')
  })

  it('una navegación fuera del kiosko no se intercepta', async () => {
    const harness = setup(async () => html())

    expect(await harness.dispatchFetch(request('/dashboard', { mode: 'navigate' }))).toBeNull()
    expect(await harness.dispatchFetch(request('/digital-concierge-otra', { mode: 'navigate' }))).toBeNull()
  })
})

describe('kiosk-sw.js: /assets/* (cache-first)', () => {
  it('lo guardado se sirve sin tocar la red', async () => {
    const cached = js()
    const harness = setup(async () => {
      throw new Error('no debería usar la red')
    })
    const cache = await harness.storage.open(CACHE_NAME)
    await cache.put('/assets/app-1.js', cached)

    const response = await harness.dispatchFetch(request('/assets/app-1.js'))

    expect(response).toBe(cached)
    expect(harness.fetchMock).not.toHaveBeenCalled()
  })

  it('lo que no está se pide a la red y se guarda', async () => {
    const harness = setup(async () => js())

    await harness.dispatchFetch(request('/assets/app-2.js'))

    const cache = await harness.storage.open(CACHE_NAME)
    expect(await cache.match('/assets/app-2.js')).toBeDefined()
  })

  it('sin red y sin copia, el error llega al navegador (no se inventa una respuesta)', async () => {
    const harness = setup(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(harness.dispatchFetch(request('/assets/nuevo.js'))).rejects.toThrow('Failed to fetch')
  })

  it('un HTML bajo /assets/ (rewrite de la SPA) no se guarda', async () => {
    const harness = setup(async () => html('<!doctype html>'))

    await harness.dispatchFetch(request('/assets/viejo.js'))

    const cache = await harness.storage.open(CACHE_NAME)
    expect(cache.store.size).toBe(0)
  })

  it('la caché de assets tiene tope: descarta los más antiguos', async () => {
    const harness = setup(async () => js())

    for (let index = 0; index < 85; index += 1) {
      await harness.dispatchFetch(request(`/assets/chunk-${index}.js`))
    }

    const cache = await harness.storage.open(CACHE_NAME)
    expect(cache.store.size).toBe(80)
    expect(cache.store.has(ORIGIN + '/assets/chunk-0.js')).toBe(false)
    expect(cache.store.has(ORIGIN + '/assets/chunk-84.js')).toBe(true)
  })
})

describe('kiosk-sw.js: lo que NUNCA se cachea ni se intercepta', () => {
  it.each([
    ['/api/v1/concierge/session/start'],
    ['/api/auth/get-session'],
    ['/socket.io/?EIO=4&transport=websocket'],
    ['/concierge/device'],
    ['/visits'],
  ])('%s no pasa por el service worker', async (path) => {
    const harness = setup(async () => html())

    expect(await harness.dispatchFetch(request(path))).toBeNull()
    expect(harness.fetchMock).not.toHaveBeenCalled()
  })

  it('los métodos que no son GET (POST con credenciales) no se interceptan', async () => {
    const harness = setup(async () => html())

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(await harness.dispatchFetch(request('/digital-concierge', { method, mode: 'navigate' }))).toBeNull()
      expect(await harness.dispatchFetch(request('/assets/app.js', { method }))).toBeNull()
    }
  })

  it('otro origen (el backend, fuentes) no se intercepta', async () => {
    const harness = setup(async () => html())

    expect(await harness.dispatchFetch(request('https://api.vigilia.example/api/v1/concierge/device'))).toBeNull()
    expect(await harness.dispatchFetch(request('https://fonts.googleapis.com/css2'))).toBeNull()
    expect(await harness.dispatchFetch(request('https://kiosk.test.evil.example/assets/app.js'))).toBeNull()
  })

  it.each<[string, FakeResponseInit]>([
    ['con redirección', { redirected: true }],
    ['con error del servidor', { status: 500 }],
    ['con "Cache-Control: no-store"', { headers: { 'cache-control': 'no-store' } }],
    ['con "Cache-Control: private"', { headers: { 'cache-control': 'private, max-age=60' } }],
    ['opaca o de otro tipo (cors)', { type: 'cors' }],
  ])('una respuesta %s no se guarda', async (_label, init) => {
    const harness = setup(async () => makeResponse({ ...init, headers: { 'content-type': 'text/html', ...(init.headers ?? {}) } }))

    await harness.dispatchFetch(request('/digital-concierge', { mode: 'navigate' }))
    await harness.dispatchFetch(request('/assets/app.js'))

    const cache = await harness.storage.open(CACHE_NAME)
    expect(cache.store.size).toBe(0)
  })

  it('tras servir todo un recorrido, la caché solo contiene el shell y /assets/ (nada de /api ni sockets)', async () => {
    const harness = setup(async () => js())
    const paths = ['/api/v1/concierge/device', '/socket.io/?x=1', '/assets/a.js', '/kiosk.webmanifest', '/icons/icon-192.png']

    for (const path of paths) {
      await harness.dispatchFetch(request(path))
    }
    await harness.dispatchFetch(request('/digital-concierge', { mode: 'navigate' }))

    const cache = await harness.storage.open(CACHE_NAME)
    for (const key of cache.store.keys()) {
      expect(new URL(key).pathname).toMatch(/^\/(assets\/|icons\/|kiosk\.webmanifest$|digital-concierge$)/)
    }
  })
})

describe('kiosk.webmanifest', () => {
  const manifest = JSON.parse(webManifestRaw) as Record<string, unknown>

  it('limita la app al kiosko, a pantalla completa y vertical', () => {
    expect(manifest.start_url).toBe('/digital-concierge')
    expect(manifest.scope).toBe('/digital-concierge')
    expect(manifest.display).toBe('fullscreen')
    expect(manifest.orientation).toBe('portrait')
    expect(manifest.background_color).toBe('#000000')
  })

  it('declara íconos de 192 y 512', () => {
    const icons = manifest.icons as Array<{ src: string; sizes: string; type: string }>
    expect(icons.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512'])
    for (const icon of icons) {
      expect(icon.type).toBe('image/png')
      expect(icon.src.startsWith('/icons/')).toBe(true)
    }
  })
})
