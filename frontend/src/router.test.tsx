import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { createTestQueryClient } from '@/test/renderWithProviders'
import Router from './router'

function httpError(status: number): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data: { message: 'Unauthorized' } }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

// Visitante sin sesión: toda llamada a la API responde 401 (`getUser` usa `api(url)`).
const axiosMock = vi.hoisted(() => {
  const reject = async () => {
    throw new Error('sin sesión')
  }
  const api = Object.assign(vi.fn(reject), { get: vi.fn(reject), post: vi.fn(reject), request: vi.fn(reject) })
  const authApi = { get: vi.fn(reject), post: vi.fn(reject) }
  return { api, authApi }
})
vi.mock('@/lib/axios', () => ({ default: axiosMock.api, authApi: axiosMock.authApi }))

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  const queryClient = createTestQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>,
  )
  return { queryClient }
}

/** Espera a que `useAuth` termine (con su reintento) y a que corran los efectos que redirigen. */
async function waitForSessionCheck(queryClient: ReturnType<typeof createTestQueryClient>): Promise<void> {
  await waitFor(() => expect(queryClient.getQueryState(['user'])?.status).toBe('error'), { timeout: 4_000 })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

beforeEach(() => {
  const unauthorized = httpError(401)
  axiosMock.api.mockRejectedValue(unauthorized)
  axiosMock.api.get.mockRejectedValue(unauthorized)
  axiosMock.api.post.mockRejectedValue(unauthorized)
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('Router: política de privacidad pública (Ley 21.719, art. 14 ter)', () => {
  it('/privacy-policy se ve sin sesión y no redirige al login', async () => {
    const { queryClient } = renderAt('/privacy-policy')

    // Se ve de inmediato, sin el "Verificando permisos..." de ProtectedRoute.
    expect(screen.getByRole('heading', { level: 1, name: 'Política de privacidad' })).toBeInTheDocument()
    expect(screen.queryByText('Verificando permisos...')).not.toBeInTheDocument()

    // Y sigue ahí cuando `useAuth` ya dio la sesión por inexistente.
    await waitForSessionCheck(queryClient)
    expect(window.location.pathname).toBe('/privacy-policy')
    expect(screen.getByRole('heading', { level: 1, name: 'Política de privacidad' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).not.toBeInTheDocument()
  })

  it('una ruta protegida sin sesión sí redirige al login (control del test anterior)', async () => {
    const { queryClient } = renderAt('/my-profile')

    await waitForSessionCheck(queryClient)
    expect(window.location.pathname).toBe('/auth/login')
  })

  it('el footer de la landing enlaza la política y ya no ofrece "Términos"', async () => {
    // Las animaciones `whileInView` de la landing usan IntersectionObserver (jsdom no lo trae).
    vi.stubGlobal(
      'IntersectionObserver',
      class IntersectionObserverStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): IntersectionObserverEntry[] {
          return []
        }
      },
    )
    renderAt('/')

    const legal = (await screen.findByRole('heading', { name: 'Legal' })).parentElement as HTMLElement
    expect(within(legal).getByRole('link', { name: 'Privacidad' })).toHaveAttribute('href', '/privacy-policy')
    expect(within(legal).getByRole('link', { name: 'Tus derechos · Ley 21.719' })).toHaveAttribute(
      'href',
      '/privacy-policy#derechos',
    )
    expect(within(legal).queryByText('Términos')).not.toBeInTheDocument()

    // Sin sellos ni cifras que el sistema no puede respaldar (y nada que contradiga la política).
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/GDPR/)
    expect(text).not.toMatch(/\bISO\b|certificad/i)
    expect(text).not.toMatch(/100\s?% segur/i)
    expect(text).not.toMatch(/99[.,]9/)
    expect(text).not.toMatch(/AES-256/)
    expect(text).not.toMatch(/grado militar|precisión militar/i)
    expect(text).not.toMatch(/ultra-seguro/i)
    expect(text).not.toMatch(/biom[eé]tric/i)
    expect(text).not.toMatch(/nunca salgan de tu red/i)
    // Funciones y cifras sin respaldo (revisión de QA de P7).
    expect(text).not.toMatch(/\+\s?420\s?%|accuracy/i)
    expect(text).not.toMatch(/24\s?\/\s?7/)
    expect(text).not.toMatch(/telegram/i)
    expect(text).not.toMatch(/API Access/i)
    expect(text).not.toMatch(/gratis|\b14 días\b/i)
    expect(text).not.toMatch(/central(es)? receptora/i)
    // Solo visible en un paso de la animación: ver también AIIntelligenceComposition.test.tsx.
    expect(text).not.toMatch(/central de seguridad/i)
    // Las funciones que sí existen siguen ofrecidas.
    expect(text).toMatch(/Notificaciones en la app y por correo/)
    expect(text).toMatch(/Registro de auditoría/)
  })

  it('el login enlaza la política', async () => {
    renderAt('/auth/login')

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Política de privacidad' })).toHaveAttribute('href', '/privacy-policy')
  })
})
