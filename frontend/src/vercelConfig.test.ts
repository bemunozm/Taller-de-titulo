import { describe, expect, it } from 'vitest'
import vercelJsonRaw from '../vercel.json?raw'

interface VercelHeader {
  key: string
  value: string
}

interface VercelHeaderRule {
  source: string
  headers: VercelHeader[]
}

interface VercelConfig {
  rewrites: Array<{ source: string; destination: string }>
  headers: VercelHeaderRule[]
}

const config = JSON.parse(vercelJsonRaw) as VercelConfig

function globalHeaders(): Map<string, string> {
  const rule = config.headers.find((r) => r.source === '/(.*)')
  return new Map((rule?.headers ?? []).map((h) => [h.key, h.value]))
}

describe('vercel.json security headers', () => {
  it('keeps the SPA rewrite', () => {
    expect(config.rewrites).toContainEqual({ source: '/(.*)', destination: '/' })
  })

  it('applies a headers rule to every route', () => {
    expect(config.headers.some((r) => r.source === '/(.*)')).toBe(true)
  })

  it('blocks MIME sniffing and limits referrer leakage', () => {
    const headers = globalHeaders()
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })

  it('denies framing via X-Frame-Options and frame-ancestors', () => {
    const headers = globalHeaders()
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
  })

  it('does not restrict script or connect sources (would break WebRTC/WHEP)', () => {
    const csp = globalHeaders().get('Content-Security-Policy') ?? ''
    expect(csp).not.toMatch(/script-src|connect-src|default-src/)
  })

  it('allows microphone and camera for same origin only and denies the rest', () => {
    const policy = globalHeaders().get('Permissions-Policy') ?? ''
    expect(policy).toContain('microphone=(self)')
    expect(policy).toContain('camera=(self)')
    expect(policy).toContain('geolocation=()')
    expect(policy).toContain('payment=()')
    expect(policy).toContain('usb=()')
  })
})
