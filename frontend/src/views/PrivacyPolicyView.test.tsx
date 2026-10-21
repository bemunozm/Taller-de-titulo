import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@/test/renderWithProviders'
import {
  DATA_EXPORT_CONTENTS,
  DATA_EXPORT_EXCLUDED,
  DEFAULT_PRIVACY_CONTROLLER_NAME,
  MISSING_PRIVACY_CONTACT_TEXT,
  PRIVACY_POLICY_EFFECTIVE_DATE_LABEL,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
  PROFILE_PRIVACY_PATH,
  RETENTION_RULES,
  formatRetention,
} from '@/helpers/privacyPolicy'
import { PrivacyPolicyView } from './PrivacyPolicyView'

/** Nombre accesible de una fila que EMPIEZA por `text` (la celda de encabezado de la fila). */
function startsWith(text: string): (name: string) => boolean {
  return (name) => name.startsWith(text)
}

function renderPolicy() {
  return renderWithProviders(<PrivacyPolicyView />, { route: '/privacy-policy' })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('PrivacyPolicyView: estructura (§5.3)', () => {
  it('tiene las 13 secciones como encabezados, con índice y anclas', () => {
    renderPolicy()

    expect(screen.getByRole('heading', { level: 1, name: 'Política de privacidad' })).toBeInTheDocument()
    expect(PRIVACY_POLICY_SECTIONS).toHaveLength(13)

    const toc = screen.getByRole('navigation', { name: 'Índice de la política' })
    for (const section of PRIVACY_POLICY_SECTIONS) {
      const heading = screen.getByRole('heading', { level: 2, name: section.title })
      expect(heading.closest('section')).toHaveAttribute('id', section.id)
      expect(within(toc).getByRole('link', { name: section.title })).toHaveAttribute('href', `#${section.id}`)
    }
  })

  it('muestra la versión y la fecha de vigencia', () => {
    renderPolicy()

    const version = document.getElementById('version')
    expect(version).not.toBeNull()
    expect(version).toHaveTextContent(`Versión ${PRIVACY_POLICY_VERSION}`)
    expect(version).toHaveTextContent(PRIVACY_POLICY_EFFECTIVE_DATE_LABEL)
  })
})

describe('PrivacyPolicyView: contenido alineado con el sistema', () => {
  it('nombra a los encargados reales, con OpenAI en EE.UU. y su retención de 30 días', () => {
    renderPolicy()

    const processors = document.getElementById('encargados')
    expect(processors).not.toBeNull()
    const section = within(processors as HTMLElement)
    expect(section.getByText('OpenAI')).toBeInTheDocument()
    expect(section.getByText('Proveedor de correo (SMTP)')).toBeInTheDocument()
    expect(section.getByText('Cloudinary')).toBeInTheDocument()
    expect(section.getByText('Proveedor de hosting')).toBeInTheDocument()
    expect(processors).toHaveTextContent(/voz/)
    expect(processors).toHaveTextContent(/transcripción/)
    expect(processors).toHaveTextContent(/anomalías/)
    expect(processors).toHaveTextContent(/agente de texto/)
    expect(processors).toHaveTextContent('Estados Unidos')
    expect(processors).toHaveTextContent('hasta 30 días')
  })

  it('la tabla de plazos muestra cada dato con el plazo configurado', () => {
    renderPolicy()

    const table = screen.getByRole('table', { name: 'Plazos de conservación de los datos' })
    for (const rule of RETENTION_RULES) {
      const row = within(table).getByRole('row', { name: startsWith(rule.data) })
      expect(row).toHaveTextContent(formatRetention(rule.days))
    }
    // Valores por defecto del backend (P7.R).
    expect(within(table).getByRole('row', { name: startsWith('Imágenes') })).toHaveTextContent('30 días')
    expect(within(table).getByRole('row', { name: startsWith('Datos del visitante') })).toHaveTextContent('90 días')
    expect(within(table).getByRole('row', { name: startsWith('Registro de auditoría') })).toHaveTextContent('365 días')
    expect(within(table).getByRole('row', { name: startsWith('Registros técnicos') })).toHaveTextContent('30 días')
    expect(within(table).getByRole('row', { name: startsWith('Cuenta dada de baja') })).toHaveTextContent('30 días')
    expect(within(table).getByRole('row', { name: startsWith('Audio de las llamadas') })).toHaveTextContent('No se guarda')
  })

  it('no repite las afirmaciones falsas de la versión anterior', () => {
    renderPolicy()

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/2FA/)
    expect(text).not.toMatch(/dos factores/i)
    expect(text).not.toMatch(/no compartimos/i)
    expect(text).not.toMatch(/con terceros/i)
    expect(text).not.toMatch(/cifrado de datos sensibles/i)
    // Sí declara la medida real.
    expect(document.getElementById('seguridad')).toHaveTextContent('Cifrado de las credenciales de las cámaras')
  })

  it('lista los seis derechos, el plazo de respuesta y el reclamo ante la Agencia', () => {
    renderPolicy()

    const rights = document.getElementById('derechos') as HTMLElement
    for (const right of ['Acceso', 'Rectificación', 'Supresión', 'Oposición', 'Bloqueo', 'Portabilidad']) {
      expect(within(rights).getByText(right)).toBeInTheDocument()
    }
    expect(rights).toHaveTextContent('30 días corridos')
    expect(within(rights).getByRole('link', { name: 'Mi perfil' })).toHaveAttribute('href', PROFILE_PRIVACY_PATH)
    expect(rights).toHaveTextContent('Descargar mis datos')
    expect(document.getElementById('reclamo')).toHaveTextContent('Agencia de Protección de Datos Personales')
  })

  it('declara las decisiones automatizadas y la ausencia de reconocimiento facial y de voz', () => {
    renderPolicy()

    expect(document.getElementById('decisiones')).toHaveTextContent('Una negativa nunca es definitiva sin una persona')
    expect(document.getElementById('biometria')).toHaveTextContent(
      'no identifica a las personas por su rostro ni por su voz',
    )
  })
})

describe('PrivacyPolicyView: correcciones de la revisión de P7 (ciberseguridad y QA)', () => {
  it('(a) la auditoría conserva IP y navegador 365 días con fines de seguridad', () => {
    renderPolicy()

    const table = screen.getByRole('table', { name: 'Plazos de conservación de los datos' })
    const auditRow = within(table).getByRole('row', { name: startsWith('Registro de auditoría') })
    expect(auditRow).toHaveTextContent('dirección IP y su navegador')
    expect(auditRow).toHaveTextContent('365 días')
    expect(document.getElementById('seguridad')).toHaveTextContent(
      'su dirección IP y su navegador durante 365 días, con fines de seguridad',
    )
    // Ya no afirma que TODO dato personal de la auditoría va oculto.
    expect(document.body).not.toHaveTextContent(/acciones relevantes, con los datos personales ocultos/)
  })

  it('(b) declara las fuentes tipográficas externas que reciben la IP', () => {
    renderPolicy()

    const processors = document.getElementById('encargados') as HTMLElement
    expect(processors).toHaveTextContent('Google Fonts')
    expect(processors).toHaveTextContent('rsms.me')
    expect(processors).toHaveTextContent('reciben tu dirección IP')
  })

  it('(c) las solicitudes de aprobación cuentan el plazo desde que se crean', () => {
    renderPolicy()

    const table = screen.getByRole('table', { name: 'Plazos de conservación de los datos' })
    expect(within(table).getByRole('row', { name: startsWith('Solicitudes de aprobación') })).toHaveTextContent(
      'desde que se crean',
    )
  })

  it('(d) detalla qué incluye "Descargar mis datos" y que el resto se pide por correo', () => {
    renderPolicy()

    const rights = document.getElementById('derechos') as HTMLElement
    for (const item of DATA_EXPORT_CONTENTS) {
      expect(within(rights).getByText(item)).toBeInTheDocument()
    }
    expect(rights).toHaveTextContent('Las visitas que creaste')
    expect(rights).toHaveTextContent(`No incluye ${DATA_EXPORT_EXCLUDED}: esos datos se piden por correo`)
  })

  it('(e) aclara que el QR no se envía por SMS', () => {
    renderPolicy()

    expect(document.getElementById('encargados')).toHaveTextContent(
      'El envío del código QR al visitante por SMS no está activo.',
    )
  })

  it('una cuenta dada de baja se anonimiza a los 30 días y sus vehículos se borran', () => {
    renderPolicy()

    const table = screen.getByRole('table', { name: 'Plazos de conservación de los datos' })
    const row = within(table).getByRole('row', { name: startsWith('Cuenta dada de baja') })
    expect(row).toHaveTextContent('los vehículos de la cuenta')
    expect(row).toHaveTextContent('se borran sus vehículos')
    expect(row).toHaveTextContent('30 días')
  })

  it('(f) los registros técnicos del servidor se conservan 30 días', () => {
    renderPolicy()

    const table = screen.getByRole('table', { name: 'Plazos de conservación de los datos' })
    expect(within(table).getByRole('row', { name: startsWith('Registros técnicos del servidor') })).toHaveTextContent(
      '30 días',
    )
    expect(document.getElementById('seguridad')).toHaveTextContent('se borran a los 30 días')
  })
})

describe('PrivacyPolicyView: responsable y contacto configurables', () => {
  it('usa VITE_PRIVACY_CONTROLLER_NAME y VITE_PRIVACY_CONTACT_EMAIL', () => {
    vi.stubEnv('VITE_PRIVACY_CONTROLLER_NAME', 'Comunidad Condominio San Lorenzo')
    vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', 'privacidad@sanlorenzo.cl')
    renderPolicy()

    const controller = document.getElementById('responsable') as HTMLElement
    expect(controller).toHaveTextContent('Comunidad Condominio San Lorenzo')
    expect(within(controller).getByRole('link', { name: 'privacidad@sanlorenzo.cl' })).toHaveAttribute(
      'href',
      'mailto:privacidad@sanlorenzo.cl',
    )
    expect(within(document.getElementById('derechos') as HTMLElement).getByRole('link', {
      name: 'privacidad@sanlorenzo.cl',
    })).toBeInTheDocument()
    expect(screen.queryByText(MISSING_PRIVACY_CONTACT_TEXT)).not.toBeInTheDocument()
  })

  it('sin variables muestra textos de respaldo claros', () => {
    vi.stubEnv('VITE_PRIVACY_CONTROLLER_NAME', '')
    vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', '')
    renderPolicy()

    const controller = document.getElementById('responsable') as HTMLElement
    expect(controller).toHaveTextContent(DEFAULT_PRIVACY_CONTROLLER_NAME)
    expect(controller).toHaveTextContent(MISSING_PRIVACY_CONTACT_TEXT)
    expect(screen.queryByRole('link', { name: /@/ })).not.toBeInTheDocument()
  })

  it('un correo con formato inválido cuenta como faltante', () => {
    vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', 'no-es-un-correo')
    renderPolicy()

    expect(document.getElementById('responsable')).toHaveTextContent(MISSING_PRIVACY_CONTACT_TEXT)
    expect(screen.queryByText('no-es-un-correo')).not.toBeInTheDocument()
  })
})
