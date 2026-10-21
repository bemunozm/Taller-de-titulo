import { useState } from 'react'
import { resolveDetectionImage, type DetectionImageSource } from '@/helpers/detectionImage'

interface DetectionImagesProps {
  detection: DetectionImageSource | null | undefined
  /** Hora de captura, para la etiqueta sobre el cuadro completo. */
  capturedAt?: string
  /** Mensaje cuando no hay ninguna imagen. */
  emptyMessage?: string
}

/** Cuadro completo (solo si es una URL segura) y/o recorte de la patente. */
export function DetectionImages({ detection, capturedAt, emptyMessage = 'No hay imagen disponible' }: DetectionImagesProps) {
  const { fullFrameUrl, snapshotDataUrl } = resolveDetectionImage(detection)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const loaded = fullFrameUrl !== null && loadedUrl === fullFrameUrl

  if (!fullFrameUrl && !snapshotDataUrl) {
    return (
      <div className="rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-100 p-12 text-center dark:border-zinc-700 dark:bg-zinc-800">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{emptyMessage}</p>
        <p className="text-xs text-zinc-500">La captura no pudo ser almacenada</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {fullFrameUrl && (
        <figure className="relative overflow-hidden rounded-lg border-2 border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
          <img
            src={fullFrameUrl}
            alt="Frame capturado"
            className={`h-auto w-full transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setLoadedUrl(fullFrameUrl)}
          />
          {!loaded && <figcaption className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">Cargando imagen...</figcaption>}
          {loaded && capturedAt && (
            <figcaption className="absolute right-2 top-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
              {new Date(capturedAt).toLocaleTimeString('es-CL')}
            </figcaption>
          )}
        </figure>
      )}
      {snapshotDataUrl && (
        <figure className="space-y-1">
          <img
            src={snapshotDataUrl}
            alt="Recorte de la patente"
            className="max-h-40 w-auto rounded border border-zinc-200 dark:border-zinc-700"
          />
          <figcaption className="text-xs text-zinc-500 dark:text-zinc-400">Recorte de la patente</figcaption>
        </figure>
      )}
    </div>
  )
}
