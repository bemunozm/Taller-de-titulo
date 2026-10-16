import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'
import {
  AI_PROVIDER_ABUSE_LOG_DAYS,
  DATA_EXPORT_CONTENTS,
  DATA_EXPORT_EXCLUDED,
  THIRD_PARTY_FONT_PROVIDERS,
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_EFFECTIVE_DATE_LABEL,
  PRIVACY_POLICY_VERSION,
  PROFILE_PRIVACY_PATH,
  RETENTION_DAYS,
  RETENTION_RULES,
  RIGHTS_RESPONSE_DAYS,
  MISSING_PRIVACY_CONTACT_TEXT,
  formatRetention,
  getPrivacyController,
  getPrivacySection,
  type PrivacyController,
  type PrivacySectionId,
} from '@/helpers/privacyPolicy'

interface PrivacyPolicyContentProps {
  /**
   * Dentro del kiosko (dispositivo público): sin enlaces que saquen al
   * visitante de la pantalla (`mailto:`, "Mi perfil") y con encabezados h3,
   * porque el título del diálogo ya es el h2.
   */
  embedded?: boolean
}

type HeadingTag = 'h2' | 'h3'

interface PolicySectionProps {
  id: PrivacySectionId
  headingTag: HeadingTag
  children: ReactNode
}

function PolicySection({ id, headingTag: Heading, children }: PolicySectionProps) {
  const { number, title } = getPrivacySection(id)
  const headingId = `${id}-titulo`

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="scroll-mt-24 border-t border-zinc-950/5 pt-10 first:border-t-0 first:pt-0 dark:border-white/10"
    >
      <Heading
        id={headingId}
        className={clsx(
          'flex items-baseline gap-3 font-semibold tracking-tight text-balance text-zinc-950 dark:text-white',
          // h3 = dentro del diálogo del kiosko, bajo su título.
          Heading === 'h3' ? 'text-base/7' : 'text-xl/8',
        )}
      >
        <span aria-hidden="true" className="font-mono text-sm font-medium text-indigo-600 tabular-nums dark:text-indigo-400">
          {number}
        </span>
        {title}
      </Heading>
      <div className="mt-4 space-y-4 text-base/7 text-pretty text-zinc-600 dark:text-zinc-300">{children}</div>
    </section>
  )
}

function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-zinc-950 dark:text-white">{children}</strong>
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul role="list" className="space-y-2">
      {items.map((item) => (
        <li key={item} className="relative pl-5">
          <span aria-hidden="true" className="absolute top-[0.7rem] left-0 size-1.5 rounded-full bg-indigo-500/70" />
          {item}
        </li>
      ))}
    </ul>
  )
}

function ContactValue({ controller, embedded }: { controller: PrivacyController; embedded: boolean }) {
  if (controller.contactEmail === null) {
    return <span>{MISSING_PRIVACY_CONTACT_TEXT}</span>
  }
  if (embedded) {
    return <span className="font-medium break-all text-zinc-950 dark:text-white">{controller.contactEmail}</span>
  }
  return (
    <a
      href={`mailto:${controller.contactEmail}`}
      className="font-medium break-all text-indigo-600 underline decoration-indigo-600/30 underline-offset-4 hover:decoration-indigo-600 dark:text-indigo-400 dark:decoration-indigo-400/40"
    >
      {controller.contactEmail}
    </a>
  )
}

// --- Contenido estático ---

const DATA_CATEGORIES: readonly { title: string; detail: string }[] = [
  { title: 'Identificación', detail: 'Nombre y RUT de residentes y visitantes.' },
  { title: 'Contacto', detail: 'Teléfono y correo electrónico.' },
  { title: 'Residencia', detail: 'Unidad, grupo familiar y vehículos (patente, marca, modelo y color).' },
  {
    title: 'Imagen',
    detail: 'Video de las cámaras del acceso y los espacios comunes, recortes de patentes y, si la subes, tu foto de perfil.',
  },
  {
    title: 'Voz y transcripción',
    detail: 'Lo que dices al hablar con la asistente en el citófono o el kiosko, procesado en tiempo real.',
  },
  {
    title: 'Registros de acceso',
    detail: 'Ingresos, patentes detectadas, visitas, aprobaciones y notificaciones, con su fecha y hora.',
  },
  {
    title: 'Datos técnicos de seguridad',
    detail: 'Dirección IP y navegador de quien usa la aplicación, en el registro de auditoría.',
  },
]

const PURPOSES: readonly { purpose: string; basis: string }[] = [
  {
    purpose: 'Administrar residentes, familias, unidades y vehículos',
    basis: 'Ejecución del contrato de administración del condominio (art. 13 c).',
  },
  {
    purpose: 'Abrir el acceso a los vehículos de residentes por su patente',
    basis: 'Ejecución del contrato e interés legítimo en la seguridad (art. 13 c y d).',
  },
  {
    purpose: 'Leer la patente de los vehículos de visitantes',
    basis: 'Interés legítimo en el control de acceso, con aviso visible en el acceso (art. 13 d).',
  },
  {
    purpose: 'Atender a visitantes con la asistente de voz y registrar la visita',
    basis:
      'Interés legítimo en operar el control de acceso, con aviso antes de la conversación (art. 13 d). La voz no se graba para otros fines.',
  },
  {
    purpose: 'Videovigilancia de espacios comunes y detección de situaciones de riesgo',
    basis: 'Interés legítimo en la seguridad del condominio, con una ponderación documentada (art. 13 d).',
  },
  {
    purpose: 'Avisar al residente que llegó una visita (aplicación o correo)',
    basis: 'Ejecución del contrato: es parte del servicio (art. 13 c).',
  },
  {
    purpose: 'Registro de auditoría y seguridad del sistema',
    basis: 'Interés legítimo en la seguridad y la trazabilidad del sistema (art. 13 d).',
  },
]

interface Processor {
  name: string
  location: string
  service: string
  data: string
  note?: string
}

const PROCESSORS: readonly Processor[] = [
  {
    name: 'OpenAI',
    location: 'Estados Unidos',
    service:
      'Procesa en tiempo real la voz de la conversación con la asistente y su transcripción, analiza imágenes de las cámaras para detectar anomalías y opera el agente de texto del sistema.',
    data: 'Voz, transcripción, datos que entrega el visitante e imágenes de las cámaras.',
    note: `Conserva sus registros de monitoreo de abuso hasta ${AI_PROVIDER_ABUSE_LOG_DAYS} días. Su servicio de voz en tiempo real no admite retención cero.`,
  },
  {
    name: 'Proveedor de correo (SMTP)',
    location: 'Según el proveedor contratado',
    service: 'Envía correos del sistema, como los avisos a residentes y la recuperación de contraseña.',
    data: 'Correo electrónico, nombre y datos de la visita.',
    note: 'El envío del código QR al visitante por SMS no está activo.',
  },
  {
    name: 'Cloudinary',
    location: 'Servicio en la nube, puede estar fuera de Chile',
    service: 'Almacena las fotos de perfil y, si la administración lo activa, las imágenes del lector de patentes.',
    data: 'Fotos de perfil e imágenes de vehículos en el acceso.',
  },
  {
    name: 'Proveedor de hosting',
    location: 'Según el despliegue del condominio',
    service: 'Aloja el servidor, la base de datos y esta aplicación.',
    data: 'Los datos del sistema, con conexiones cifradas.',
  },
]

const SECURITY_MEASURES: readonly string[] = [
  'Control de acceso por rol y por condominio: cada persona ve y hace solo lo que su rol permite, y solo en su condominio.',
  'Cifrado de las credenciales de las cámaras guardadas en el sistema.',
  'Conexiones cifradas (HTTPS/TLS).',
  `Registro de auditoría de las acciones relevantes: guarda quién actuó, su dirección IP y su navegador durante ${RETENTION_DAYS.audit} días, con fines de seguridad; los demás datos personales de los cambios se ocultan.`,
  'Límite de intentos en el inicio de sesión y en los servicios públicos, para frenar abusos.',
  `Registros técnicos del servidor con teléfonos enmascarados y patentes parciales, sin nombres ni RUT, que se borran a los ${RETENTION_DAYS.systemLogs} días.`,
  'Borrado y anonimización automáticos según los plazos de esta política.',
]

const RIGHTS: readonly { name: string; detail: string }[] = [
  { name: 'Acceso', detail: 'Saber qué datos tuyos se tratan, para qué y con quién se comparten.' },
  { name: 'Rectificación', detail: 'Corregir datos inexactos, desactualizados o incompletos.' },
  {
    name: 'Supresión',
    detail: 'Pedir que se borren tus datos cuando ya no son necesarios o no hay una base legal para tratarlos.',
  },
  { name: 'Oposición', detail: 'Oponerte a un tratamiento basado en el interés legítimo, por motivos de tu situación.' },
  { name: 'Bloqueo', detail: 'Pedir que se suspenda el tratamiento mientras se resuelve una solicitud tuya.' },
  {
    name: 'Portabilidad',
    detail: 'Recibir tus datos en un formato estructurado y de uso común, para llevarlos a otro servicio.',
  },
]

const SOURCES: readonly string[] = [
  'Tú: al crear tu cuenta, registrar tus vehículos o hablar con la asistente en el acceso.',
  'El residente que registra tu visita: tu nombre, RUT, teléfono o patente.',
  'La administración del condominio, al dar de alta a residentes y unidades.',
  'Las cámaras y el lector de patentes del acceso.',
]

const AUTOMATED_DECISIONS: readonly string[] = [
  'El lector de patentes abre el acceso de forma automática solo a vehículos registrados y autorizados.',
  'Si no reconoce un vehículo, no lo rechaza de forma definitiva: avisa a un residente o a la conserjería, que decide.',
  'La asistente de voz no aprueba ni niega visitas por su cuenta: avisa al residente, que es quien decide. Si no puede resolver, te deriva a una persona.',
  'Puedes pedir que una persona revise cualquier decisión, dar tu punto de vista y pedir una explicación.',
]

function RetentionBar({ days }: { days: number }) {
  const percent = Math.max(2, Math.min(100, (days / RETENTION_DAYS.audit) * 100))
  return (
    <span aria-hidden="true" className="mt-2 ml-auto block h-1 w-20 overflow-hidden rounded-full bg-zinc-950/5 dark:bg-white/10">
      <span className="block h-full rounded-full bg-indigo-500 dark:bg-indigo-400" style={{ width: `${percent}%` }} />
    </span>
  )
}

function RetentionTable() {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-zinc-950/10 dark:ring-white/10">
      <table className="w-full text-left text-sm/6">
        <caption className="sr-only">Plazos de conservación de los datos</caption>
        <thead className="bg-zinc-50 text-xs font-medium tracking-wide text-zinc-500 uppercase dark:bg-white/5 dark:text-zinc-400">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Dato
            </th>
            <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
              Al vencer el plazo
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Plazo
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-950/5 dark:divide-white/5">
          {RETENTION_RULES.map((rule) => (
            <tr key={rule.key} className="align-top">
              <th scope="row" className="px-4 py-4 font-normal">
                <span className="block font-medium text-zinc-950 dark:text-white">{rule.data}</span>
                <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">{rule.detail}</span>
                <span className="mt-1 block text-zinc-700 md:hidden dark:text-zinc-300">{rule.action}</span>
              </th>
              <td className="hidden px-4 py-4 text-zinc-700 md:table-cell dark:text-zinc-300">{rule.action}</td>
              <td className="px-4 py-4 text-right">
                <span className="block font-mono text-base font-semibold whitespace-nowrap text-zinc-950 tabular-nums dark:text-white">
                  {formatRetention(rule.days)}
                </span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{rule.from}</span>
                {rule.days !== null && <RetentionBar days={rule.days} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Las 13 secciones de la política (§5.3 de `docs/modulos/privacidad-ley-21719.md`).
 * La usan la página pública y el diálogo del kiosko.
 */
export function PrivacyPolicyContent({ embedded = false }: PrivacyPolicyContentProps) {
  const controller = getPrivacyController()
  const headingTag: HeadingTag = embedded ? 'h3' : 'h2'

  return (
    <div className="space-y-10">
      <PolicySection id="responsable" headingTag={headingTag}>
        <p>
          Esta política explica cómo se tratan los datos personales en el control de acceso del condominio, que funciona
          con Vigilia: la asistente de voz del citófono y del kiosko, las cámaras y el lector de patentes. Se rige por la
          Ley 19.628, modificada por la Ley 21.719.
        </p>
        <dl className="divide-y divide-zinc-950/5 rounded-xl bg-zinc-50 px-5 dark:divide-white/5 dark:bg-white/5">
          <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
            <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Responsable del tratamiento</dt>
            <dd className="font-medium text-zinc-950 dark:text-white">{controller.name}</dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
            <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Contacto de privacidad</dt>
            <dd>
              <ContactValue controller={controller} embedded={embedded} />
            </dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
            <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Rol de Vigilia</dt>
            <dd>
              Encargado del tratamiento: es la plataforma tecnológica que usa la administración y trata los datos por
              cuenta de ella y según sus instrucciones.
            </dd>
          </div>
        </dl>
      </PolicySection>

      <PolicySection id="datos" headingTag={headingTag}>
        <ul role="list" className="grid gap-3 sm:grid-cols-2">
          {DATA_CATEGORIES.map((category) => (
            <li key={category.title} className="rounded-xl p-4 ring-1 ring-zinc-950/5 dark:ring-white/10">
              <p className="font-semibold text-zinc-950 dark:text-white">{category.title}</p>
              <p className="mt-1 text-sm/6">{category.detail}</p>
            </li>
          ))}
        </ul>
        <p>
          Son datos personales comunes. No se tratan datos sensibles: la imagen y la voz no se usan para identificar a
          nadie (ver la sección 12).
        </p>
      </PolicySection>

      <PolicySection id="finalidades" headingTag={headingTag}>
        <p>Cada uso de los datos tiene una base de licitud del artículo 13 de la ley:</p>
        <dl className="divide-y divide-zinc-950/5 border-y border-zinc-950/5 dark:divide-white/5 dark:border-white/5">
          {PURPOSES.map((item) => (
            <div key={item.purpose} className="grid gap-1 py-4 md:grid-cols-2 md:gap-6">
              <dt className="font-medium text-zinc-950 dark:text-white">{item.purpose}</dt>
              <dd className="text-sm/6">{item.basis}</dd>
            </div>
          ))}
        </dl>
        <p>Los datos no se usan para publicidad ni para fines distintos de los descritos.</p>
      </PolicySection>

      <PolicySection id="encargados" headingTag={headingTag}>
        <p>
          Estos proveedores tratan datos por encargo, solo para prestar su servicio. Fuera de ellos, los datos se
          comunican a una autoridad solo cuando una ley o un tribunal lo exige.
        </p>
        <ul role="list" className="grid gap-4 md:grid-cols-2">
          {PROCESSORS.map((processor) => (
            <li
              key={processor.name}
              className="flex flex-col rounded-xl p-5 ring-1 ring-zinc-950/10 dark:ring-white/10"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-semibold text-zinc-950 dark:text-white">{processor.name}</p>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{processor.location}</p>
              </div>
              <p className="mt-2 text-sm/6">{processor.service}</p>
              <p className="mt-2 text-sm/6">
                <Strong>Datos:</Strong> {processor.data}
              </p>
              {processor.note && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm/6 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
                  {processor.note}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="rounded-xl bg-zinc-50 p-5 dark:bg-white/5">
          <p className="font-semibold text-zinc-950 dark:text-white">Otros terceros: fuentes tipográficas</p>
          <p className="mt-1 text-sm/6">
            Al abrir la aplicación o esta página, tu navegador descarga las fuentes tipográficas desde servidores
            externos, que reciben tu dirección IP y datos técnicos del navegador:
          </p>
          <ul role="list" className="mt-2 space-y-1 text-sm/6">
            {THIRD_PARTY_FONT_PROVIDERS.map((provider) => (
              <li key={provider.name}>
                <Strong>{provider.name}</Strong> ({provider.detail}; {provider.hosts.join(', ')}).
              </li>
            ))}
          </ul>
        </div>
      </PolicySection>

      <PolicySection id="transferencias" headingTag={headingTag}>
        <p>
          Algunos datos salen de Chile. La voz, la transcripción y las imágenes que procesa <Strong>OpenAI</Strong> se
          tratan en <Strong>Estados Unidos</Strong>, bajo su acuerdo de tratamiento de datos (DPA). Las fotos que guarda
          Cloudinary y el hosting también pueden estar fuera de Chile, igual que los servidores de las fuentes
          tipográficas, que reciben tu dirección IP.
        </p>
        <p>
          La Agencia de Protección de Datos Personales aún no publica la lista de países con un nivel de protección
          adecuado. Cuando lo haga, se revisará este sustento y se actualizará esta sección.
        </p>
      </PolicySection>

      <PolicySection id="conservacion" headingTag={headingTag}>
        <p>
          Los datos se guardan solo el tiempo necesario. Al vencer cada plazo, el sistema los borra o los anonimiza de forma
          automática; los registros en curso, como una visita activa, no se tocan hasta que terminan.
        </p>
        <RetentionTable />
        <p className="text-sm/6">
          Tus datos de residente (perfil, familia y vehículos) se conservan mientras tu cuenta esté activa. Además, OpenAI
          conserva sus propios registros de monitoreo de abuso hasta {AI_PROVIDER_ABUSE_LOG_DAYS} días.
        </p>
      </PolicySection>

      <PolicySection id="seguridad" headingTag={headingTag}>
        <BulletList items={SECURITY_MEASURES} />
        <p>
          Ningún sistema es infalible. Si ocurre una brecha que pueda afectar tus datos, la administración la informará a
          la Agencia de Protección de Datos Personales y, cuando corresponda, a las personas afectadas.
        </p>
      </PolicySection>

      <PolicySection id="derechos" headingTag={headingTag}>
        <ul role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RIGHTS.map((right) => (
            <li key={right.name} className="rounded-xl bg-zinc-50 p-4 dark:bg-white/5">
              <p className="font-semibold text-zinc-950 dark:text-white">{right.name}</p>
              <p className="mt-1 text-sm/6">{right.detail}</p>
            </li>
          ))}
        </ul>

        <div>
          <p className="font-semibold text-zinc-950 dark:text-white">Cómo ejercerlos</p>
          <ol className="mt-3 space-y-3">
            <li className="grid grid-cols-[1.75rem_1fr] gap-2">
              <span aria-hidden="true" className="font-mono text-sm text-indigo-600 dark:text-indigo-400">1.</span>
              <span>
                {controller.contactEmail === null ? (
                  <>
                    Escribe al correo de contacto de la administración; si no lo tienes, pídelo en la administración o en
                    la conserjería del condominio.
                  </>
                ) : (
                  <>
                    Escribe a <ContactValue controller={controller} embedded={embedded} />.
                  </>
                )}{' '}
                Indica tu nombre, el derecho que quieres ejercer y un dato que permita encontrar tus registros, como tu
                RUT o una patente.
              </span>
            </li>
            <li className="grid grid-cols-[1.75rem_1fr] gap-2">
              <span aria-hidden="true" className="font-mono text-sm text-indigo-600 dark:text-indigo-400">2.</span>
              <span>Se te puede pedir que acredites tu identidad, para no entregar tus datos a otra persona.</span>
            </li>
            <li className="grid grid-cols-[1.75rem_1fr] gap-2">
              <span aria-hidden="true" className="font-mono text-sm text-indigo-600 dark:text-indigo-400">3.</span>
              <span>
                La respuesta llega en un plazo de <Strong>{RIGHTS_RESPONSE_DAYS} días corridos</Strong>, prorrogable una
                vez por otros {RIGHTS_RESPONSE_DAYS} días. Si se prorroga, se te avisa.
              </span>
            </li>
            <li className="grid grid-cols-[1.75rem_1fr] gap-2">
              <span aria-hidden="true" className="font-mono text-sm text-indigo-600 dark:text-indigo-400">4.</span>
              <span>Ejercer tus derechos es gratuito.</span>
            </li>
          </ol>
        </div>

        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-400/20 dark:bg-indigo-400/10">
          <p className="font-semibold text-indigo-950 dark:text-indigo-100">¿Tienes cuenta de residente?</p>
          <p className="mt-1 text-sm/6 text-indigo-900 dark:text-indigo-200">
            Puedes descargar tus datos cuando quieras desde{' '}
            {embedded ? (
              <Strong>Mi perfil</Strong>
            ) : (
              <Link
                to={PROFILE_PRIVACY_PATH}
                className="font-medium underline decoration-indigo-600/40 underline-offset-4 hover:decoration-indigo-600"
              >
                Mi perfil
              </Link>
            )}
            , en <Strong>Privacidad y mis datos → Descargar mis datos</Strong> (acceso y portabilidad), y corregir tus
            datos de contacto en Información personal. El archivo incluye:
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm/6 text-indigo-900 dark:text-indigo-200">
            {DATA_EXPORT_CONTENTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm/6 text-indigo-900 dark:text-indigo-200">
            No incluye {DATA_EXPORT_EXCLUDED}: esos datos se piden por correo, como se indica arriba.
          </p>
        </div>

        <p className="text-sm/6">
          Si pides una copia de imágenes de las cámaras, se entrega con las demás personas difuminadas.
        </p>
      </PolicySection>

      <PolicySection id="reclamo" headingTag={headingTag}>
        <p>
          Si no recibes respuesta dentro del plazo o no estás de acuerdo con ella, puedes presentar un reclamo ante la{' '}
          <Strong>Agencia de Protección de Datos Personales</Strong>.
        </p>
      </PolicySection>

      <PolicySection id="fuentes" headingTag={headingTag}>
        <BulletList items={SOURCES} />
      </PolicySection>

      <PolicySection id="decisiones" headingTag={headingTag}>
        <BulletList items={AUTOMATED_DECISIONS} />
        <p>
          <Strong>Una negativa nunca es definitiva sin una persona:</Strong> el residente o la conserjería tienen la
          última palabra.
        </p>
      </PolicySection>

      <PolicySection id="biometria" headingTag={headingTag}>
        <p>
          Vigilia <Strong>no identifica a las personas por su rostro ni por su voz</Strong>. Las cámaras ayudan a detectar
          situaciones de riesgo sin reconocer quién aparece en ellas, y la voz se usa solo para conversar contigo durante la
          llamada. El audio no se guarda.
        </p>
      </PolicySection>

      <PolicySection id="version" headingTag={headingTag}>
        <p>
          Versión <Strong>{PRIVACY_POLICY_VERSION}</Strong>, vigente desde el{' '}
          <time dateTime={PRIVACY_POLICY_EFFECTIVE_DATE}>{PRIVACY_POLICY_EFFECTIVE_DATE_LABEL}</time>.
        </p>
        <p>
          Si esta política cambia, la nueva versión se publica en esta página con su fecha. Si el cambio es relevante,
          también se avisa por los canales del condominio.
        </p>
      </PolicySection>
    </div>
  )
}
