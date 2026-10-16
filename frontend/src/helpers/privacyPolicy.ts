/**
 * Contenido "de datos" de la política de privacidad pública (art. 14 ter,
 * Ley 21.719) y del aviso previo al micrófono del kiosko. Contrato de
 * contenido: `docs/modulos/privacidad-ley-21719.md` (§3 plazos, §5.2 aviso
 * del kiosko, §5.3 secciones de la política).
 */

/** Ruta pública (sin sesión) de la política de privacidad. */
export const PRIVACY_POLICY_ROUTE = '/privacy-policy'

/** `/my-profile#privacidad` abre el perfil en "Privacidad y mis datos". */
export const PROFILE_PRIVACY_HASH = '#privacidad'
export const PROFILE_PRIVACY_PATH = `/my-profile${PROFILE_PRIVACY_HASH}`

export const PRIVACY_POLICY_VERSION = '2.0'
/** Fecha de vigencia de esta versión, para `<time dateTime>`. */
export const PRIVACY_POLICY_EFFECTIVE_DATE = '2026-10-09'
export const PRIVACY_POLICY_EFFECTIVE_DATE_LABEL = '9 de octubre de 2026'

/**
 * Plazos de conservación por defecto del backend (`RetentionService`, P7 ·
 * `RETENTION_*_DAYS`). Son el ÚNICO lugar del frontend con estos números: la
 * tabla de la política, el resumen y el aviso del kiosko se derivan de acá.
 * Si el backend se despliega con otros valores, se cambian aquí.
 */
export const RETENTION_DAYS = {
  /** Recortes de patente, frames del LPR y fotos de anomalías (`RETENTION_IMAGES_DAYS`). */
  images: 30,
  /** Frames en el disco del equipo del LPR (`LPR_RETENTION_DAYS`). */
  lprLocalFrames: 7,
  /** Datos del visitante en una visita terminal (`RETENTION_VISITS_DAYS`). */
  visits: 90,
  /** Sesiones terminales del conserje digital (`RETENTION_VISITS_DAYS`). */
  conciergeSessions: 90,
  /** Detecciones e intentos de acceso (`RETENTION_ACCESS_LOG_DAYS`). */
  accessLogs: 90,
  /** Anomalías (`RETENTION_ANOMALIES_DAYS`). */
  anomalies: 90,
  /** Notificaciones (`RETENTION_NOTIFICATIONS_DAYS`). */
  notifications: 90,
  /** Acciones pendientes terminales (`RETENTION_PENDING_ACTIONS_DAYS`). */
  pendingActions: 90,
  /** Auditoría (`RETENTION_AUDIT_DAYS`). */
  audit: 365,
  /** Logs del sistema (`RETENTION_SYSTEM_LOGS_DAYS`). */
  systemLogs: 30,
  /** Usuario deshabilitado → anonimizado (`RETENTION_DISABLED_USERS_DAYS`). */
  disabledUsers: 30,
} as const

export type RetentionKey = keyof typeof RETENTION_DAYS

/** Retención de los logs de monitoreo de abuso del proveedor de IA (OpenAI). */
export const AI_PROVIDER_ABUSE_LOG_DAYS = 30

/** Plazo legal de respuesta a una solicitud de derechos (días corridos, prorrogable una vez). */
export const RIGHTS_RESPONSE_DAYS = 30

export interface RetentionRule {
  key: RetentionKey | 'audio'
  data: string
  detail: string
  /** Qué pasa al vencer el plazo. */
  action: string
  /** `null`: el dato no se almacena (audio de las llamadas). */
  days: number | null
  /** Desde cuándo corre el plazo. */
  from: string
}

export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    key: 'images',
    data: 'Imágenes',
    detail: 'Recortes y fotogramas del lector de patentes, y fotos de eventos de seguridad',
    action: 'Se borra la imagen; el registro queda sin foto',
    days: RETENTION_DAYS.images,
    from: 'desde la captura',
  },
  {
    key: 'lprLocalFrames',
    data: 'Fotogramas en el equipo del acceso',
    detail: 'Copia local que guarda el equipo del lector de patentes',
    action: 'Se borran',
    days: RETENTION_DAYS.lprLocalFrames,
    from: 'desde la captura',
  },
  {
    key: 'visits',
    data: 'Datos del visitante',
    detail: 'Nombre, RUT, teléfono, patente, motivo y código QR de la visita',
    action: 'Se anonimizan',
    days: RETENTION_DAYS.visits,
    from: 'desde que la visita termina',
  },
  {
    key: 'conciergeSessions',
    data: 'Llamadas con la asistente',
    detail: 'Datos del visitante y registro de la conversación con el conserje digital',
    action: 'Se anonimizan',
    days: RETENTION_DAYS.conciergeSessions,
    from: 'desde que termina la llamada',
  },
  {
    key: 'accessLogs',
    data: 'Registros de acceso',
    detail: 'Patentes detectadas, intentos de ingreso y su motivo',
    action: 'Se anonimizan; quedan solo estadísticas',
    days: RETENTION_DAYS.accessLogs,
    from: 'desde el registro',
  },
  {
    key: 'anomalies',
    data: 'Eventos de seguridad',
    detail: 'Anomalías detectadas por las cámaras y su análisis',
    action: 'Se borran',
    days: RETENTION_DAYS.anomalies,
    from: 'desde el evento',
  },
  {
    key: 'notifications',
    data: 'Notificaciones',
    detail: 'Avisos enviados a residentes, que incluyen datos del visitante',
    action: 'Se borran',
    days: RETENTION_DAYS.notifications,
    from: 'desde el envío',
  },
  {
    key: 'pendingActions',
    data: 'Solicitudes de aprobación',
    detail: 'Acciones de la asistente que esperaban la decisión de una persona',
    action: 'Se borran, salvo las que siguen pendientes',
    days: RETENTION_DAYS.pendingActions,
    from: 'desde que se crean',
  },
  {
    key: 'audit',
    data: 'Registro de auditoría',
    detail:
      'Quién hizo cada acción, con su dirección IP y su navegador, con fines de seguridad; los demás datos personales de los cambios van ocultos',
    action: 'Se borra',
    days: RETENTION_DAYS.audit,
    from: 'desde el registro',
  },
  {
    key: 'systemLogs',
    data: 'Registros técnicos del servidor',
    detail: 'Errores y eventos de funcionamiento, con teléfonos y patentes enmascarados',
    action: 'Se borran',
    days: RETENTION_DAYS.systemLogs,
    from: 'desde el registro',
  },
  {
    key: 'disabledUsers',
    data: 'Cuenta dada de baja',
    detail: 'Nombre, correo, RUT, teléfono y foto de perfil, y los vehículos de la cuenta',
    action: 'Se anonimiza la cuenta y se borran sus vehículos',
    days: RETENTION_DAYS.disabledUsers,
    from: 'desde la baja',
  },
  {
    key: 'audio',
    data: 'Audio de las llamadas',
    detail: 'Tu voz en el citófono o el kiosko',
    action: 'Se procesa en tiempo real y no se guarda',
    days: null,
    from: 'nunca se almacena',
  },
]

/**
 * Qué entrega "Descargar mis datos" (`GET /auth/me/data-export`, P7.R). Lo
 * demás (registros de acceso, llamadas, imágenes, auditoría) se pide por correo.
 */
export const DATA_EXPORT_CONTENTS: readonly string[] = [
  'Tu perfil: nombre, RUT, correo y teléfono',
  'Tu grupo familiar y tu unidad',
  'Tus vehículos',
  'Las visitas que creaste',
  'Tus notificaciones',
]

/** Lo que "Descargar mis datos" no incluye y se pide al correo de contacto. */
export const DATA_EXPORT_EXCLUDED =
  'registros de acceso y de patentes, llamadas con la asistente, imágenes de las cámaras y registros de auditoría'

/**
 * Terceros que reciben la dirección IP del visitante al cargar la aplicación
 * (fuentes tipográficas: `index.html` y `src/index.css`). Un test verifica que
 * todo host externo que carga el frontend esté declarado aquí; si se dejan
 * de cargar (fuentes propias), se quitan de la lista y de la política.
 */
export const THIRD_PARTY_FONT_PROVIDERS: readonly { name: string; hosts: readonly string[]; detail: string }[] = [
  {
    name: 'Google Fonts',
    hosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
    detail: 'fuentes Outfit y Geist Mono',
  },
  {
    name: 'rsms.me',
    hosts: ['rsms.me'],
    detail: 'fuente Inter',
  },
]

/** "30 días" / "No se guarda". */
export function formatRetention(days: number | null): string {
  if (days === null) {
    return 'No se guarda'
  }
  return days === 1 ? '1 día' : `${days} días`
}

/** Las 13 secciones del §5.3, en orden: índice, anclas y numeración. */
export const PRIVACY_POLICY_SECTIONS = [
  { id: 'responsable', title: 'Responsable y contacto' },
  { id: 'datos', title: 'Datos que tratamos' },
  { id: 'finalidades', title: 'Para qué los usamos y con qué base legal' },
  { id: 'encargados', title: 'Proveedores que tratan datos por encargo' },
  { id: 'transferencias', title: 'Transferencias internacionales' },
  { id: 'conservacion', title: 'Cuánto tiempo conservamos los datos' },
  { id: 'seguridad', title: 'Medidas de seguridad' },
  { id: 'derechos', title: 'Tus derechos y cómo ejercerlos' },
  { id: 'reclamo', title: 'Reclamo ante la Agencia' },
  { id: 'fuentes', title: 'De dónde obtenemos los datos' },
  { id: 'decisiones', title: 'Decisiones automatizadas' },
  { id: 'biometria', title: 'Sin reconocimiento facial ni de voz' },
  { id: 'version', title: 'Versión y cambios' },
] as const

export type PrivacySectionId = (typeof PRIVACY_POLICY_SECTIONS)[number]['id']

export interface PrivacySection {
  id: PrivacySectionId
  title: string
  /** "01" … "13". */
  number: string
}

export function getPrivacySection(id: PrivacySectionId): PrivacySection {
  const index = PRIVACY_POLICY_SECTIONS.findIndex((section) => section.id === id)
  return {
    id,
    title: PRIVACY_POLICY_SECTIONS[index].title,
    number: String(index + 1).padStart(2, '0'),
  }
}

// --- Responsable del tratamiento (configurable por env) ---

export const DEFAULT_PRIVACY_CONTROLLER_NAME = 'La administración del condominio'
/** Respaldo visible cuando `VITE_PRIVACY_CONTACT_EMAIL` falta o no es un correo. */
export const MISSING_PRIVACY_CONTACT_TEXT =
  'Pide el correo de contacto a la administración o a la conserjería del condominio.'

export interface PrivacyController {
  name: string
  /** `null` si `VITE_PRIVACY_CONTACT_EMAIL` falta o no es un correo válido. */
  contactEmail: string | null
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function readEnvString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Responsable (la administración del condominio) y su correo de contacto,
 * desde `VITE_PRIVACY_CONTROLLER_NAME` / `VITE_PRIVACY_CONTACT_EMAIL`. Se lee
 * en cada llamada (no al cargar el módulo) para que un cambio de env aplique.
 */
export function getPrivacyController(env: Record<string, unknown> = import.meta.env): PrivacyController {
  const email = readEnvString(env.VITE_PRIVACY_CONTACT_EMAIL)
  return {
    name: readEnvString(env.VITE_PRIVACY_CONTROLLER_NAME) ?? DEFAULT_PRIVACY_CONTROLLER_NAME,
    contactEmail: email !== null && EMAIL_PATTERN.test(email) ? email : null,
  }
}

// --- Kiosko: aviso previo al micrófono (§5.2) ---

/** El texto del §5.2, por oraciones (el kiosko las muestra con un ícono cada una). */
export const KIOSK_PRIVACY_NOTICE_PARTS = [
  'Vas a hablar con Sofía, una asistente de inteligencia artificial.',
  'Para gestionar tu visita, tu voz se procesa en tiempo real con un proveedor de IA (OpenAI, EE.UU.).',
  `Registramos tu nombre, RUT, teléfono, patente y motivo, que se conservan ${RETENTION_DAYS.visits} días.`,
] as const

export const KIOSK_PRIVACY_NOTICE = KIOSK_PRIVACY_NOTICE_PARTS.join(' ')

/** URL absoluta de la política, para el QR del kiosko. */
export function getPrivacyPolicyUrl(origin: string = window.location.origin): string {
  return new URL(PRIVACY_POLICY_ROUTE, origin).toString()
}

/** URL corta y legible ("condominio.cl/privacy-policy") para escribirla a mano. */
export function getPrivacyPolicyDisplayUrl(origin: string = window.location.origin): string {
  const { host } = new URL(origin)
  return `${host}${PRIVACY_POLICY_ROUTE}`
}
