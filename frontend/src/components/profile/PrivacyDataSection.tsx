import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowDownTrayIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/Button'
import { DATA_EXPORT_ERROR_MESSAGE, downloadMyDataExport, type DataExportFile } from '@/api/PrivacyAPI'
import { saveBlobAsFile } from '@/helpers/download'
import {
  DATA_EXPORT_CONTENTS,
  DATA_EXPORT_EXCLUDED,
  MISSING_PRIVACY_CONTACT_TEXT,
  PRIVACY_POLICY_ROUTE,
  RIGHTS_RESPONSE_DAYS,
  getPrivacyController,
} from '@/helpers/privacyPolicy'

/**
 * Derechos del titular desde su perfil (Ley 21.719): "Descargar mis datos"
 * (`GET /auth/me/data-export`, acceso y portabilidad) y cómo ejercer el resto.
 */
export function PrivacyDataSection() {
  const controller = getPrivacyController()
  const [downloadedFile, setDownloadedFile] = useState<string | null>(null)

  const { mutate, isPending, error } = useMutation<DataExportFile, Error>({
    mutationFn: () => downloadMyDataExport(),
    onMutate: () => {
      setDownloadedFile(null)
    },
    onSuccess: ({ blob, filename }) => {
      saveBlobAsFile(blob, filename)
      setDownloadedFile(filename)
    },
  })

  const errorMessage = error ? error.message || DATA_EXPORT_ERROR_MESSAGE : null

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Privacidad y mis datos</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tus derechos sobre los datos personales que guarda el sistema.
        </p>
      </div>

      <section
        aria-labelledby="descargar-mis-datos"
        className="rounded-lg bg-zinc-50 p-5 dark:bg-zinc-900"
      >
        <h4 id="descargar-mis-datos" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Descargar mis datos
        </h4>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Obtén una copia en un archivo JSON, que puedes guardar o llevar a otro servicio (derechos de acceso y
          portabilidad). Incluye:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          {DATA_EXPORT_CONTENTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          No incluye {DATA_EXPORT_EXCLUDED}: esos datos se piden por correo (ver "Otros derechos").
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Button color="indigo" onClick={() => mutate()} disabled={isPending}>
            <ArrowDownTrayIcon data-slot="icon" aria-hidden="true" />
            {isPending ? 'Preparando archivo…' : 'Descargar mis datos'}
          </Button>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Por seguridad, la descarga está limitada a unas pocas veces por hora.
          </p>
        </div>

        <div aria-live="polite">
          {downloadedFile !== null && !isPending && (
            <p role="status" className="mt-4 flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircleIcon aria-hidden="true" className="mt-0.5 size-4 flex-none" />
              <span>
                Descarga lista: <span className="font-mono break-all">{downloadedFile}</span>. Guárdalo en un lugar
                seguro: contiene tus datos personales.
              </span>
            </p>
          )}
        </div>
        {errorMessage !== null && !isPending && (
          <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
            <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 size-4 flex-none" />
            <span>{errorMessage}</span>
          </p>
        )}
      </section>

      <section aria-labelledby="otros-derechos" className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-700">
        <h4 id="otros-derechos" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Otros derechos
        </h4>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Para corregir tus datos usa <span className="font-medium">Información personal</span>. Para pedir una copia de
          lo que no incluye la descarga, o la supresión, la oposición o el bloqueo de tus datos, escribe{' '}
          {controller.contactEmail === null ? (
            <>al correo de contacto de la administración</>
          ) : (
            <>
              a{' '}
              <a
                href={`mailto:${controller.contactEmail}`}
                className="font-medium break-all text-indigo-600 underline underline-offset-2 dark:text-indigo-400"
              >
                {controller.contactEmail}
              </a>
            </>
          )}
          . La respuesta llega en {RIGHTS_RESPONSE_DAYS} días corridos.
        </p>
        {controller.contactEmail === null && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{MISSING_PRIVACY_CONTACT_TEXT}</p>
        )}
        <Link
          to={`${PRIVACY_POLICY_ROUTE}#derechos`}
          className="mt-3 inline-block text-sm font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-500 dark:text-indigo-400"
        >
          Leer la política de privacidad
        </Link>
      </section>
    </div>
  )
}
