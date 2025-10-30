import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listAccessAttempts, type AccessAttempt } from '@/api/DetectionsAPI'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { DescriptionList, DescriptionTerm, DescriptionDetails } from '@/components/ui/DescriptionList'
import { Heading, Subheading } from '@/components/ui/Heading'
import { useState } from 'react'

function prettyJSON(obj: any) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

export default function TraceabilityDetailView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [showRawMeta, setShowRawMeta] = useState(false)

  // fetch all attempts then find the id (backend doesn't provide single attempt endpoint)
  const { data = [] as AccessAttempt[] } = useQuery({ queryKey: ['detections', 'attempts'], queryFn: () => listAccessAttempts() })
  const attempt = (data || []).find((a: AccessAttempt) => a.id === id) as AccessAttempt | undefined

  if (!attempt) {
    return (
      <div className="p-6">
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow p-4">
          <div className="text-sm text-zinc-500">Intento no encontrado</div>
          <div className="mt-3">
            <Button onClick={() => navigate(-1)}>Volver</Button>
          </div>
        </div>
      </div>
    )
  }

  const det = attempt.detection
  const meta = det?.meta || {}

  const decisionColor = attempt.decision === 'allow' ? 'green' : attempt.decision === 'deny' ? 'red' : 'zinc'

  return (
    <div className="p-6">
      <div className="mx-auto max-w-6xl">
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <Heading className="mb-1">Detalle de intento</Heading>
              <div className="flex items-center gap-3">
                <div className="text-sm text-zinc-600 dark:text-zinc-400">{new Date(attempt.createdAt).toLocaleString()}</div>
                <Badge color={decisionColor}>{attempt.decision}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => navigate(-1)} plain>Volver</Button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded p-4">
                <Subheading className="mb-2">Resumen</Subheading>
                <DescriptionList>
                  <DescriptionTerm>ID</DescriptionTerm>
                  <DescriptionDetails>{attempt.id}</DescriptionDetails>

                  <DescriptionTerm>Residente</DescriptionTerm>
                  <DescriptionDetails>{attempt.residente ? attempt.residente.name ?? attempt.residente.id : '-'}</DescriptionDetails>

                  <DescriptionTerm>Método</DescriptionTerm>
                  <DescriptionDetails>{attempt.method ?? '-'}</DescriptionDetails>

                  <DescriptionTerm>Razón</DescriptionTerm>
                  <DescriptionDetails>{attempt.reason ?? '-'}</DescriptionDetails>
                </DescriptionList>
              </div>

              <div className="mt-4 bg-zinc-50 dark:bg-zinc-800 rounded p-4">
                <Subheading className="mb-2">Detección asociada</Subheading>
                <DescriptionList>
                  <DescriptionTerm>Patente</DescriptionTerm>
                  <DescriptionDetails>{det?.plate ?? '-'}</DescriptionDetails>

                  <DescriptionTerm>Patente raw</DescriptionTerm>
                  <DescriptionDetails>{det?.plate_raw ?? '-'}</DescriptionDetails>

                  <DescriptionTerm>Cámara</DescriptionTerm>
                  <DescriptionDetails>{det?.cameraId ?? '-'}</DescriptionDetails>

                  <DescriptionTerm>Conf. OCR</DescriptionTerm>
                  <DescriptionDetails>{det?.ocr_confidence ?? '-'}</DescriptionDetails>

                  <DescriptionTerm>Conf. Det.</DescriptionTerm>
                  <DescriptionDetails>{det?.det_confidence ?? '-'}</DescriptionDetails>

                  <DescriptionTerm>Creada</DescriptionTerm>
                  <DescriptionDetails>{det?.createdAt ? new Date(det.createdAt).toLocaleString() : '-'}</DescriptionDetails>
                </DescriptionList>

                <div className="mt-4">
                  {det?.full_frame_path ? (
                    <div>
                      <div className="text-sm text-zinc-500">Full frame</div>
                      <div className="mt-2">
                        <img src={det.full_frame_path} alt="full-frame" className="max-w-full rounded shadow" />
                      </div>
                      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Path: {det.full_frame_path}</div>
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-500">No hay imagen de frame completo</div>
                  )}
                </div>
              </div>
            </div>

            <aside className="lg:col-span-1">
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded p-4">
                <Subheading className="mb-2">Meta</Subheading>
                <div className="text-sm text-zinc-800 dark:text-zinc-200">
                  {meta && Object.keys(meta).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(meta).map(([k, v]) => (
                        <div key={k}>
                          <div className="text-xs text-zinc-500">{k}</div>
                          <div className="text-sm break-words bg-white dark:bg-zinc-900 p-2 rounded mt-1">{typeof v === 'string' && v.length > 200 ? v.substring(0, 200) + '…' : prettyJSON(v)}</div>
                        </div>
                      ))}

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button onClick={() => setShowRawMeta(s => !s)} plain>
                          {showRawMeta ? 'Ocultar JSON' : 'Ver JSON raw'}
                        </Button>
                        <Button onClick={() => {
                          // download raw json
                          const blob = new Blob([prettyJSON(meta)], { type: 'application/json' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `detection-${det.id}-meta.json`
                          a.click()
                          URL.revokeObjectURL(url)
                        }} plain>
                          Descargar JSON
                        </Button>
                      </div>

                      {showRawMeta && (
                        <pre className="mt-3 text-xs overflow-auto max-h-60 bg-white dark:bg-zinc-900 p-3 rounded">{prettyJSON(meta)}</pre>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-500">No hay meta disponible</div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
