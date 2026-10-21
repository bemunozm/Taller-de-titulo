import { describe, expect, it } from 'vitest'
import indexHtml from '../../index.html?raw'
import indexCss from '../index.css?raw'
import {
  THIRD_PARTY_FONT_PROVIDERS,
  DEFAULT_PRIVACY_CONTROLLER_NAME,
  KIOSK_PRIVACY_NOTICE,
  PRIVACY_POLICY_SECTIONS,
  RETENTION_DAYS,
  RETENTION_RULES,
  formatRetention,
  getPrivacyController,
  getPrivacyPolicyDisplayUrl,
  getPrivacyPolicyUrl,
  getPrivacySection,
} from './privacyPolicy'

describe('getPrivacyController', () => {
  it('lee el responsable y el correo de las variables de entorno', () => {
    expect(
      getPrivacyController({
        VITE_PRIVACY_CONTROLLER_NAME: '  Comunidad San Lorenzo ',
        VITE_PRIVACY_CONTACT_EMAIL: ' privacidad@sanlorenzo.cl ',
      }),
    ).toEqual({ name: 'Comunidad San Lorenzo', contactEmail: 'privacidad@sanlorenzo.cl' })
  })

  it('sin variables usa el respaldo y deja el correo en null', () => {
    expect(getPrivacyController({})).toEqual({ name: DEFAULT_PRIVACY_CONTROLLER_NAME, contactEmail: null })
    expect(getPrivacyController({ VITE_PRIVACY_CONTROLLER_NAME: '   ', VITE_PRIVACY_CONTACT_EMAIL: '' })).toEqual({
      name: DEFAULT_PRIVACY_CONTROLLER_NAME,
      contactEmail: null,
    })
  })

  it('un correo inválido o un valor que no es texto cuenta como faltante', () => {
    expect(getPrivacyController({ VITE_PRIVACY_CONTACT_EMAIL: 'admin' }).contactEmail).toBeNull()
    expect(getPrivacyController({ VITE_PRIVACY_CONTACT_EMAIL: 'a b@c.cl' }).contactEmail).toBeNull()
    expect(getPrivacyController({ VITE_PRIVACY_CONTACT_EMAIL: 42 }).contactEmail).toBeNull()
  })
})

describe('plazos de conservación (fuente única)', () => {
  it('coinciden con los valores por defecto del backend (P7.R)', () => {
    expect(RETENTION_DAYS).toMatchObject({
      images: 30,
      visits: 90,
      conciergeSessions: 90,
      accessLogs: 90,
      anomalies: 90,
      notifications: 90,
      audit: 365,
      systemLogs: 30,
      disabledUsers: 30,
    })
  })

  it('cada fila de la tabla toma su plazo de RETENTION_DAYS', () => {
    for (const rule of RETENTION_RULES) {
      if (rule.key === 'audio') {
        expect(rule.days).toBeNull()
      } else {
        expect(rule.days).toBe(RETENTION_DAYS[rule.key])
      }
    }
    // Todos los plazos configurables aparecen en la tabla.
    const keys = new Set(RETENTION_RULES.map((rule) => rule.key))
    for (const key of Object.keys(RETENTION_DAYS)) {
      expect(keys.has(key as keyof typeof RETENTION_DAYS)).toBe(true)
    }
  })

  it('el aviso del kiosko usa el plazo de visitas', () => {
    expect(KIOSK_PRIVACY_NOTICE).toContain(`se conservan ${RETENTION_DAYS.visits} días`)
    expect(KIOSK_PRIVACY_NOTICE).toBe(
      'Vas a hablar con Sofía, una asistente de inteligencia artificial. Para gestionar tu visita, tu voz se ' +
        'procesa en tiempo real con un proveedor de IA (OpenAI, EE.UU.). Registramos tu nombre, RUT, teléfono, ' +
        'patente y motivo, que se conservan 90 días.',
    )
  })

  it('formatRetention', () => {
    expect(formatRetention(30)).toBe('30 días')
    expect(formatRetention(1)).toBe('1 día')
    expect(formatRetention(null)).toBe('No se guarda')
  })
})

describe('terceros que reciben la IP al cargar la app (fuentes)', () => {
  /** Hosts externos que el frontend carga de verdad: <link>/<script> del HTML y @import/url() del CSS. */
  function loadedExternalHosts(): string[] {
    const urls = [
      ...Array.from(indexHtml.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g), (match) => match[1]),
      ...Array.from(indexCss.matchAll(/url\(\s*["']?(https?:\/\/[^"')\s]+)/g), (match) => match[1]),
    ]
    return [...new Set(urls.map((url) => new URL(url).host))]
  }

  it('todo host externo que carga el frontend está declarado en la política', () => {
    const declared = new Set(THIRD_PARTY_FONT_PROVIDERS.flatMap((provider) => provider.hosts))
    const loaded = loadedExternalHosts()

    // Hoy: Inter desde rsms.me (index.html) y Outfit/Geist Mono desde Google Fonts (index.css).
    expect(loaded).toEqual(expect.arrayContaining(['rsms.me', 'fonts.googleapis.com']))
    for (const host of loaded) {
      expect(declared.has(host), `${host} no está declarado en THIRD_PARTY_FONT_PROVIDERS`).toBe(true)
    }
  })
})

describe('secciones y URLs', () => {
  it('numera las 13 secciones en orden', () => {
    expect(PRIVACY_POLICY_SECTIONS).toHaveLength(13)
    expect(getPrivacySection('responsable')).toMatchObject({ number: '01', title: 'Responsable y contacto' })
    expect(getPrivacySection('version').number).toBe('13')
  })

  it('arma la URL absoluta (QR) y la corta legible de la política', () => {
    expect(getPrivacyPolicyUrl('https://vigilia.example.cl')).toBe('https://vigilia.example.cl/privacy-policy')
    expect(getPrivacyPolicyDisplayUrl('https://vigilia.example.cl')).toBe('vigilia.example.cl/privacy-policy')
  })
})
