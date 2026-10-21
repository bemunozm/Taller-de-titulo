import type { AttemptPassage } from '@/types/passage'
import { getDirectionSourceLabel, getPassageDirectionLabel, resolveCameraName, sightingImageSource, sortedSightings } from '@/helpers/passage'
import { DetectionImages } from './DetectionImages'

type CameraRef = { id: string; name?: string | null; location?: string | null }

interface PassageDirectionProps {
  passage: AttemptPassage | null | undefined
}

/** "Entrada · por cruce de línea". Sin pasada (datos antiguos) no muestra nada. */
export function PassageDirection({ passage }: PassageDirectionProps) {
  if (!passage) return null
  // Sin dirección no hay fuente que explicar ("Sin determinar · sin determinar" sobraría).
  if (passage.direction === 'unknown' && passage.directionSource === 'none') {
    return <span className="font-medium">{getPassageDirectionLabel('unknown')}</span>
  }
  return (
    <span>
      <span className="font-medium">{getPassageDirectionLabel(passage.direction)}</span>
      <span className="text-zinc-500 dark:text-zinc-400"> · {getDirectionSourceLabel(passage.directionSource)}</span>
    </span>
  )
}

interface PassageSightingsProps {
  passage: AttemptPassage | null | undefined
  cameras: ReadonlyArray<CameraRef>
}

/** "Cámaras que vieron este paso": un avistamiento por cámara con su imagen y dirección. */
export function PassageSightings({ passage, cameras }: PassageSightingsProps) {
  if (!passage) return null
  const sightings = sortedSightings(passage)

  return (
    <section aria-labelledby="passage-sightings-heading" className="space-y-3">
      <h4 id="passage-sightings-heading" className="font-medium text-zinc-900 dark:text-white">
        Cámaras que vieron este paso
      </h4>
      {sightings.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Sin avistamientos registrados.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sightings.map((sighting) => {
            const cameraName = resolveCameraName(sighting.cameraId, cameras)
            return (
              <li
                key={sighting.detectionId}
                className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{cameraName}</span>
                  <time dateTime={sighting.at} className="text-xs text-zinc-500 dark:text-zinc-400">
                    {new Date(sighting.at).toLocaleTimeString('es-CL')}
                  </time>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-300">
                  <PassageDirection passage={{ ...passage, direction: sighting.direction, directionSource: sighting.directionSource }} />
                </p>
                <DetectionImages
                  detection={sightingImageSource(sighting)}
                  capturedAt={sighting.at}
                  emptyMessage="Sin imagen de esta cámara"
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
