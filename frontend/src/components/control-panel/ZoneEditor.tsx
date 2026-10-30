import { useState, useRef, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  DIRECTION_LINE_MIN_LENGTH,
  LOITER_SECONDS,
  ZONE_LIMITS,
  clampLoiterSeconds,
  type Camera,
  type DirectionLine,
  type GuardianZone,
  type GuardianZoneType,
  type LprExitSide,
  type ZonePoint,
} from '@/types/index'
import { getUserFacingErrorMessage } from '@/helpers/httpErrors'
import { toast } from 'react-toastify'
import {
  TrashIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  XMarkIcon,
  ArrowsPointingOutIcon,
  CursorArrowRaysIcon,
  InformationCircleIcon,
  ArrowUturnLeftIcon,
  ArrowsRightLeftIcon
} from '@heroicons/react/24/outline'
import CameraPlayer from '../CameraPlayer'
import {
  Dialog,
  DialogTitle,
  DialogDescription
} from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Description, Field, Label } from '@/components/ui/Fieldset'
import { Radio, RadioField, RadioGroup } from '@/components/ui/Radio'
import { motion, AnimatePresence } from 'motion/react'
import {
  DEFAULT_VIDEO_ASPECT,
  DIRECTION_ARROW_HELP,
  TRAVEL_MEANING_CHOICE_LABELS,
  TRAVEL_MEANING_LABELS,
  arrowSideFor,
  describeDirectionLine,
  directionLineLength,
  exitSideFor,
  flipExitSide,
  getArrowTowards,
  meaningForRole,
  type CameraRole,
  type TravelMeaning,
} from '@/helpers/directionLine'

type Point = ZonePoint

/** Herramienta activa del lienzo: dibujar zonas o la línea de dirección (solo LPR). */
export type ZoneEditorTool = 'zone' | 'line'

// Índices reservados de `zoneIndex` para los puntos en edición.
const CURRENT_ZONE_INDEX = -1
const DIRECTION_LINE_INDEX = -2

/** Paleta del lienzo: `guardian` (rojo, zonas de alarma) o `lpr` (verde, zona de detección). */
export type ZoneEditorTone = 'guardian' | 'lpr'

interface ToneClasses {
  polygon: string
  halo: string
  point: string
  glow: string
}

// Clases literales (no interpoladas) para que Tailwind las detecte.
const TONES: Record<ZoneEditorTone, ToneClasses> = {
  guardian: {
    polygon: 'fill-red-500/10 stroke-red-500/40 hover:fill-red-500/20',
    halo: 'fill-red-500/10',
    point: 'stroke-red-500',
    glow: 'rgba(239, 68, 68, 0.6)',
  },
  lpr: {
    polygon: 'fill-emerald-500/10 stroke-emerald-400/60 hover:fill-emerald-500/20',
    halo: 'fill-emerald-500/10',
    point: 'stroke-emerald-500',
    glow: 'rgba(16, 185, 129, 0.6)',
  },
}

// Zonas de merodeo del Guardián: ámbar, para distinguirlas de las de intrusión (rojo).
const GUARDIAN_LOITERING_TONE: ToneClasses = {
  polygon: 'fill-amber-500/10 stroke-amber-400/60 hover:fill-amber-500/20',
  halo: 'fill-amber-500/10',
  point: 'stroke-amber-400',
  glow: 'rgba(245, 158, 11, 0.6)',
}

/** Polígono del lienzo con su tipo. Solo el tono `guardian` lo expone; en LPR siempre es `intrusion` y no se guarda. */
interface EditorZone {
  points: Point[]
  type: GuardianZoneType
  loiterSeconds: number
}

/** Tipo y segundos de una zona que ya existía (misma posición que en `initialZones`). */
export type ZoneSetting = Pick<GuardianZone, 'type' | 'loiterSeconds'>

const GUARDIAN_TYPE_LABELS: Record<GuardianZoneType, string> = {
  intrusion: 'Intrusión',
  loitering: 'Merodeo',
}

export interface ZoneEditorBaseProps {
  /** Cámara cuyo video en vivo se muestra de fondo. */
  camera: Pick<Camera, 'id' | 'name' | 'mountPath'>
  /** Polígonos normalizados (0 a 1) con los que arranca el lienzo. */
  initialZones: Point[][]
  /** Solo `guardian`: tipo y segundos de cada zona de `initialZones` (mismo orden). Sin esto todas arrancan como intrusión. */
  initialZoneSettings?: ReadonlyArray<ZoneSetting>
  title: ReactNode
  description: ReactNode
  /** Texto del botón de guardado. */
  saveLabel?: string
  /** Mensaje de éxito tras `onSave`. */
  successMessage?: string
  tone?: ZoneEditorTone
  /**
   * Habilita la herramienta "Línea de dirección" (solo LPR). Sin ella `onSave`
   * recibe únicamente las zonas, como siempre.
   */
  enableDirectionLine?: boolean
  /** Línea con la que arranca el lienzo (solo con `enableDirectionLine`). */
  initialDirectionLine?: DirectionLine | null
  /** Herramienta activa al abrir (solo con `enableDirectionLine`). */
  initialTool?: ZoneEditorTool
  /** Rol de la cámara ("Dirección" del diálogo LPR): fija qué representa la flecha. Con "Ambas" o sin definir se elige en el editor. */
  cameraRole?: CameraRole
  onClose: () => void
}

/**
 * Cómo se persisten las zonas: EXACTAMENTE una de las dos vías (unión
 * discriminada, así el tipo impide un editor sin forma de guardar).
 */
export interface ZoneEditorSavePlain {
  /**
   * Persiste (o encola) las zonas. Con `enableDirectionLine` recibe además la
   * línea (`null` = sin línea). Si rechaza, el editor sigue abierto y avisa
   * con un toast; si resuelve, avisa y se cierra con `onClose`.
   */
  onSave: (zones: Point[][], directionLine?: DirectionLine | null) => Promise<void>
  onSaveZones?: never
}

export interface ZoneEditorSaveTyped {
  /** Solo `guardian`: recibe cada zona con su tipo (`intrusion` | `loitering`) y los segundos de merodeo. */
  onSaveZones: (zones: GuardianZone[]) => Promise<void>
  onSave?: never
}

export type ZoneEditorProps = ZoneEditorBaseProps & (ZoneEditorSavePlain | ZoneEditorSaveTyped)

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

const GUARDIAN_ZONE_TYPE_OPTIONS: ReadonlyArray<GuardianZoneType> = ['intrusion', 'loitering']

interface LoiterSecondsInputProps {
  zoneNumber: number
  value: number
  onCommit: (seconds: number) => void
}

/**
 * Segundos de permanencia (5 a 600) de una zona de merodeo. Mientras se escribe
 * el texto es libre; al salir del campo (o con Enter) se ajusta al rango.
 */
function LoiterSecondsInput({ zoneNumber, value, onCommit }: LoiterSecondsInputProps) {
  const [draft, setDraft] = useState(String(value))

  // Deshacer o cargar otra zona cambia `value` desde afuera.
  useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const parsed = Number(draft)
    const seconds = draft.trim() === '' || !Number.isFinite(parsed) ? value : clampLoiterSeconds(parsed)
    setDraft(String(seconds))
    if (seconds !== value) onCommit(seconds)
  }

  return (
    <label className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-wider text-amber-300">
      <span>Segundos en la zona</span>
      <input
        type="number"
        inputMode="numeric"
        min={LOITER_SECONDS.min}
        max={LOITER_SECONDS.max}
        step={1}
        aria-label={`Segundos de merodeo de la zona ${zoneNumber}`}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
        className="w-20 rounded-lg border border-white/10 bg-zinc-900 px-2 py-1 text-right font-mono text-xs text-white focus:border-amber-400/60 focus:outline-none"
      />
    </label>
  )
}

export function ZoneEditor({
  camera,
  initialZones,
  initialZoneSettings,
  title,
  description,
  saveLabel = 'Fijar Precisión',
  successMessage = 'Cambios sincronizados correctamente',
  tone = 'guardian',
  enableDirectionLine = false,
  initialDirectionLine = null,
  cameraRole,
  initialTool = 'zone',
  onSave,
  onSaveZones,
  onClose,
}: ZoneEditorProps) {
  const isGuardian = tone === 'guardian'
  const toneClasses = TONES[tone]
  const toneFor = (zone: EditorZone): ToneClasses =>
    isGuardian && zone.type === 'loitering' ? GUARDIAN_LOITERING_TONE : toneClasses
  const [zones, setZones] = useState<EditorZone[]>(() =>
    initialZones.map((points, index) => {
      const setting = isGuardian ? initialZoneSettings?.[index] : undefined
      return {
        points,
        type: setting?.type ?? 'intrusion',
        loiterSeconds: clampLoiterSeconds(setting?.loiterSeconds ?? LOITER_SECONDS.default),
      }
    }),
  )
  const [currentZone, setCurrentZone] = useState<Point[]>([])
  const [tool, setTool] = useState<ZoneEditorTool>(enableDirectionLine ? initialTool : 'zone')
  const [directionLine, setDirectionLine] = useState<DirectionLine | null>(
    enableDirectionLine ? initialDirectionLine : null,
  )
  // La flecha muestra hacia dónde se mueve el auto en el evento del rol de la cámara
  // (entrada o salida). Lo que se guarda sigue siendo `exitSide`, derivado del lado de
  // la flecha y de ese significado. Con rol "Ambas" el significado lo elige la persona.
  const [chosenMeaning, setChosenMeaning] = useState<TravelMeaning>('exiting')
  const meaning: TravelMeaning = meaningForRole(cameraRole) ?? chosenMeaning
  const [arrowSide, setArrowSide] = useState<LprExitSide>(
    initialDirectionLine ? arrowSideFor(initialDirectionLine.exitSide, meaning) : 'left',
  )
  // Primer clic de la línea, a la espera del segundo.
  const [lineStart, setLineStart] = useState<Point | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [hoveredPoint, setHoveredPoint] = useState<{ zoneIndex: number, pointIndex: number } | null>(null)
  const [draggingPoint, setDraggingPoint] = useState<{ zoneIndex: number, pointIndex: number } | null>(null)
  
  // Undo/History capability
  const [history, setHistory] = useState<EditorZone[][]>([])
  
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [videoRect, setVideoRect] = useState<{ left: number, top: number, width: number, height: number } | null>(null)

  const didDragRef = useRef(false)
  const lastInteractionTimeRef = useRef(0)

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (svgRef.current?.contains(e.target as Node)) e.preventDefault()
    }
    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [])

  const updateVideoRect = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const video = container.querySelector('video')
    if (!video || !video.videoWidth) return

    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight
    const videoRatio = video.videoWidth / video.videoHeight
    const containerRatio = containerWidth / containerHeight

    let width, height, left, top

    if (containerRatio > videoRatio) {
      height = containerHeight
      width = containerHeight * videoRatio
      top = 0
      left = (containerWidth - width) / 2
    } else {
      width = containerWidth
      height = containerWidth / videoRatio
      left = 0
      top = (containerHeight - height) / 2
    }

    setVideoRect({ left, top, width, height })
  }, [])

  useEffect(() => {
    const timer = setInterval(updateVideoRect, 1000)
    window.addEventListener('resize', updateVideoRect)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', updateVideoRect)
    }
  }, [updateVideoRect])

  // Sub-pixel precision coordinate mapping using matrixTransform
  const getRelativeCoords = (e: React.MouseEvent | MouseEvent): Point | null => {
    if (!svgRef.current) return null
    
    // Create an SVG point and set it to the screen mouse coordinates
    const pt = svgRef.current.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    
    // Transform the screen point to the SVG coordinate system
    const matrix = svgRef.current.getScreenCTM()
    if (!matrix) return null
    const svgPoint = pt.matrixTransform(matrix.inverse())
    
    // Convert back to normalized 0-1 based on expected 1000x1000 viewBox
    // Arrastrar fuera del video daría valores fuera de 0..1, que el backend/zod rechazan.
    return {
      x: clamp01(svgPoint.x / 1000),
      y: clamp01(svgPoint.y / 1000)
    }
  }

  const saveToHistory = useCallback(() => {
    setHistory(prev => {
      const next = [...prev, JSON.parse(JSON.stringify(zones))]
      return next.slice(-20) // Keep last 20 states
    })
  }, [zones])

  const undo = useCallback(() => {
    if (history.length === 0) return
    const previous = history[history.length - 1]
    setZones(previous)
    setHistory(prev => prev.slice(0, -1))
    toast.info('Cambio revertido')
  }, [history])

  // Ctrl + Z keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo])

  const handleMouseDown = (e: React.MouseEvent, zoneIndex: number, pointIndex: number) => {
    e.stopPropagation()
    
    // Alt + Click to delete point
    if (e.altKey) {
      saveToHistory()
      didDragRef.current = true // Suppress follow-up click
      lastInteractionTimeRef.current = Date.now()

      if (zoneIndex === DIRECTION_LINE_INDEX) {
        // Quitar un extremo equivale a borrar la línea entera.
        setDirectionLine(null)
      } else if (zoneIndex === CURRENT_ZONE_INDEX) {
        setCurrentZone(prev => prev.filter((_, i) => i !== pointIndex))
      } else {
        setZones(prev => {
          const next = [...prev]
          const zone = next[zoneIndex].points.filter((_, i) => i !== pointIndex)
          if (zone.length < 3) {
            toast.warning('La zona fue eliminada por tener menos de 3 puntos')
            return next.filter((_, i) => i !== zoneIndex)
          }
          next[zoneIndex] = { ...next[zoneIndex], points: zone }
          return next
        })
      }
      return
    }

    didDragRef.current = false
    setDraggingPoint({ zoneIndex, pointIndex })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingPoint) return
    
    if (!didDragRef.current) {
        saveToHistory() // Start of a real drag
        didDragRef.current = true
    }
    
    const pt = getRelativeCoords(e)
    if (!pt) return

    if (draggingPoint.zoneIndex === DIRECTION_LINE_INDEX) {
      setDirectionLine(prev => {
        if (!prev) return prev
        return draggingPoint.pointIndex === 0 ? { ...prev, from: pt } : { ...prev, to: pt }
      })
      return
    }

    if (draggingPoint.zoneIndex === CURRENT_ZONE_INDEX) {
      setCurrentZone(prev => {
        const next = [...prev]
        next[draggingPoint.pointIndex] = pt
        return next
      })
    } else {
      setZones(prev => {
        const next = [...prev]
        const zone = [...next[draggingPoint.zoneIndex].points]
        zone[draggingPoint.pointIndex] = pt
        next[draggingPoint.zoneIndex] = { ...next[draggingPoint.zoneIndex], points: zone }
        return next
      })
    }
  }, [draggingPoint, saveToHistory])

  const handleMouseUp = useCallback(() => {
    if (draggingPoint) {
      setDraggingPoint(null)
      lastInteractionTimeRef.current = Date.now()
    }
  }, [draggingPoint])

  useEffect(() => {
    if (draggingPoint) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    } else {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggingPoint, handleMouseMove, handleMouseUp])

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // If we were dragging or just finished a drag, ignore the click
    if (didDragRef.current || (Date.now() - lastInteractionTimeRef.current < 150)) {
      didDragRef.current = false
      return
    }

    const pt = getRelativeCoords(e)
    if (!pt) return
    if (tool === 'line') {
      handleLineClick(pt)
      return
    }
    if (currentZone.length >= ZONE_LIMITS.maxPoints) {
      toast.warning(`Una zona admite como máximo ${ZONE_LIMITS.maxPoints} puntos`)
      return
    }
    setCurrentZone(prev => [...prev, pt])
  }

  // Dos clics definen la línea (`from` y luego `to`).
  const handleLineClick = (pt: Point) => {
    if (directionLine) {
      toast.info('Ya hay una línea: arrastra sus extremos o bórrala para dibujar otra')
      return
    }
    if (!lineStart) {
      setLineStart(pt)
      return
    }
    if (Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y) < DIRECTION_LINE_MIN_LENGTH) {
      toast.warning('La línea es demasiado corta: marca el segundo punto más lejos del primero')
      return
    }
    setArrowSide('left')
    setDirectionLine({ from: lineStart, to: pt, exitSide: exitSideFor('left', meaning) })
    setLineStart(null)
    setTool('zone')
  }

  const selectTool = (next: ZoneEditorTool) => {
    setTool(next)
    setLineStart(null)
  }

  const handleSvgContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault()
    if (tool === 'line') {
      // Clic derecho cancela un primer punto ya marcado.
      setLineStart(null)
      return
    }
    if (currentZone.length >= ZONE_LIMITS.minPoints) {
      if (zones.length >= ZONE_LIMITS.maxZones) {
        toast.warning(`Se admiten como máximo ${ZONE_LIMITS.maxZones} zonas`)
        return
      }
      saveToHistory()
      setZones(prev => [...prev, { points: currentZone, type: 'intrusion', loiterSeconds: LOITER_SECONDS.default }])
      setCurrentZone([])
    } else if (currentZone.length > 0) {
      toast.info('Se requieren al menos 3 puntos.')
    }
  }

  const updateZone = (index: number, patch: Partial<Pick<EditorZone, 'type' | 'loiterSeconds'>>) => {
    saveToHistory()
    setZones(prev => prev.map((zone, i) => (i === index ? { ...zone, ...patch } : zone)))
  }

  const deleteZoneWithHistory = (index: number) => {
    saveToHistory()
    setZones(prev => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (enableDirectionLine && directionLine && directionLineLength(directionLine) < DIRECTION_LINE_MIN_LENGTH) {
      toast.error('La línea de dirección es demasiado corta: alárgala o bórrala')
      return
    }
    setIsSaving(true)
    try {
      if (onSaveZones) {
        await onSaveZones(
          zones.map((zone): GuardianZone =>
            zone.type === 'loitering'
              ? { points: zone.points, type: 'loitering', loiterSeconds: clampLoiterSeconds(zone.loiterSeconds) }
              : { points: zone.points, type: 'intrusion' },
          ),
        )
      } else if (onSave && enableDirectionLine) await onSave(zones.map(zone => zone.points), directionLine)
      else if (onSave) await onSave(zones.map(zone => zone.points))
      else throw new Error('El editor no tiene cómo guardar las zonas')
      toast.success(successMessage)
      onClose()
    } catch (err) {
      toast.error(getUserFacingErrorMessage(err, 'Error al guardar'))
    } finally {
      setIsSaving(false)
    }
  }

  const vw = 1000
  const vh = vw

  // Relación ancho/alto del video en pantalla (para que la flecha sea perpendicular a la vista).
  const aspect = videoRect && videoRect.width > 0 && videoRect.height > 0
    ? videoRect.width / videoRect.height
    : DEFAULT_VIDEO_ASPECT
  const arrow = directionLine ? getArrowTowards(directionLine, arrowSide, aspect) : null

  // Elegir el significado (rol "Ambas") no mueve la flecha: solo recalcula `exitSide`.
  const chooseMeaning = (next: TravelMeaning) => {
    setChosenMeaning(next)
    setDirectionLine(prev => (prev ? { ...prev, exitSide: exitSideFor(arrowSide, next) } : prev))
  }
  // Invertir mueve la flecha y conserva el significado elegido.
  const flipArrow = () => {
    const next = flipExitSide(arrowSide)
    setArrowSide(next)
    setDirectionLine(prev => (prev ? { ...prev, exitSide: exitSideFor(next, meaning) } : prev))
  }

  return (
    <Dialog open={true} onClose={onClose} size="5xl" className="!p-0 overflow-hidden bg-black/40 backdrop-blur-xl border border-white/10 shadow-2xl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="flex flex-col h-[85vh] md:h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 bg-white/5 backdrop-blur-md border-b border-white/10">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
              <ArrowsPointingOutIcon className="h-6 w-6 text-indigo-400" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold text-white uppercase tracking-tighter">
                {title}
              </DialogTitle>
              <DialogDescription className="text-zinc-400">
                {description}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AnimatePresence>
                {history.length > 0 && (
                    <motion.button
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        onClick={undo}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] text-zinc-400 font-black uppercase tracking-widest transition-all"
                    >
                        <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                        Deshacer
                    </motion.button>
                )}
            </AnimatePresence>
            <Button plain onClick={onClose} aria-label="Cerrar editor de zonas" className="p-2 text-zinc-400 hover:text-white transition-all">
                <XMarkIcon className="h-6 w-6" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Main Canvas Area */}
          <div ref={containerRef} className="relative flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 opacity-90 transition-opacity">
               <CameraPlayer cameraId={camera.mountPath ?? camera.id} objectFit="contain" minimal={true} />
            </div>

            {videoRect && (
              <svg
                ref={svgRef}
                viewBox={`0 0 ${vw} ${vh}`}
                preserveAspectRatio="none"
                style={{
                  position: 'absolute',
                  left: videoRect.left,
                  top: videoRect.top,
                  width: videoRect.width,
                  height: videoRect.height,
                }}
                className={`z-10 cursor-crosshair touch-none select-none ${draggingPoint ? 'cursor-grabbing' : ''}`}
                onClick={handleSvgClick}
                onContextMenu={handleSvgContextMenu}
              >
                {/* Saved Zones Rendering */}
                {zones.map((zone, zIdx) => (
                  <g key={`gz-${zIdx}`}>
                    <polygon
                      points={zone.points.map(p => `${p.x * vw},${p.y * vh}`).join(' ')}
                      className={`${toneFor(zone).polygon} transition-all duration-300 cursor-pointer`}
                      strokeWidth="2"
                    />
                    {zone.points.map((p, pIdx) => {
                      const isHovered = hoveredPoint?.zoneIndex === zIdx && hoveredPoint?.pointIndex === pIdx
                      const isDragging = draggingPoint?.zoneIndex === zIdx && draggingPoint?.pointIndex === pIdx
                      
                      return (
                        <g 
                          key={`gz-pt-${zIdx}-${pIdx}`}
                          onMouseEnter={() => setHoveredPoint({ zoneIndex: zIdx, pointIndex: pIdx })}
                          onMouseLeave={() => setHoveredPoint(null)}
                          onMouseDown={(e) => handleMouseDown(e, zIdx, pIdx)}
                          className="cursor-move"
                        >
                          <circle cx={p.x * vw} cy={p.y * vh} r="25" fill="transparent" />
                          {(isHovered || isDragging) && (
                            <circle cx={p.x * vw} cy={p.y * vh} r="18" className={`${toneFor(zone).halo} animate-pulse`} />
                          )}
                          <circle
                            cx={p.x * vw}
                            cy={p.y * vh}
                            r={isDragging ? "10" : isHovered ? "9" : "6"}
                            className={`fill-white ${toneFor(zone).point} stroke-[3] transition-all duration-200 ${isDragging ? 'shadow-2xl' : ''}`}
                            style={{ filter: isHovered || isDragging ? `drop-shadow(0 0 12px ${toneFor(zone).glow})` : 'none' }}
                          />
                        </g>
                      )
                    })}
                  </g>
                ))}

                {/* Construction Zone Rendering */}
                {currentZone.length > 0 && (
                  <g>
                    <polygon
                      points={currentZone.map(p => `${p.x * vw},${p.y * vh}`).join(' ')}
                      className="fill-indigo-500/15 stroke-indigo-400 stroke-[2.5]"
                      strokeDasharray="8,5"
                    />
                    {currentZone.map((p, pIdx) => {
                      const isHovered = hoveredPoint?.zoneIndex === -1 && hoveredPoint?.pointIndex === pIdx
                      const isDragging = draggingPoint?.zoneIndex === -1 && draggingPoint?.pointIndex === pIdx

                      return (
                        <g 
                          key={`cz-pt-${pIdx}`}
                          onMouseEnter={() => setHoveredPoint({ zoneIndex: -1, pointIndex: pIdx })}
                          onMouseLeave={() => setHoveredPoint(null)}
                          onMouseDown={(e) => handleMouseDown(e, -1, pIdx)}
                          className="cursor-move"
                        >
                          <circle cx={p.x * vw} cy={p.y * vh} r="25" fill="transparent" />
                          {(isHovered || isDragging) && (
                            <circle cx={p.x * vw} cy={p.y * vh} r="18" className="fill-indigo-500/20 animate-pulse" />
                          )}
                          <circle
                            cx={p.x * vw}
                            cy={p.y * vh}
                            r={isDragging ? "10" : isHovered ? "9" : "6"}
                            className="fill-white stroke-indigo-500 stroke-[3] transition-all"
                            style={{ filter: isHovered || isDragging ? 'drop-shadow(0 0 15px rgba(99, 102, 241, 0.7))' : 'none' }}
                          />
                        </g>
                      )
                    })}
                  </g>
                )}

                {/* Direction line (solo LPR) */}
                {enableDirectionLine && lineStart && (
                  <circle
                    data-testid="direction-line-start"
                    cx={lineStart.x * vw}
                    cy={lineStart.y * vh}
                    r="9"
                    className="fill-amber-400 stroke-white stroke-[3] animate-pulse"
                  />
                )}
                {enableDirectionLine && directionLine && arrow && (
                  <g data-testid="direction-line" data-exit-side={directionLine.exitSide} data-arrow-side={arrowSide}>
                    <line
                      x1={directionLine.from.x * vw}
                      y1={directionLine.from.y * vh}
                      x2={directionLine.to.x * vw}
                      y2={directionLine.to.y * vh}
                      className="stroke-amber-400"
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                    <line
                      data-testid="direction-arrow"
                      x1={arrow.base.x * vw}
                      y1={arrow.base.y * vh}
                      x2={arrow.tip.x * vw}
                      y2={arrow.tip.y * vh}
                      className="stroke-amber-300"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    <polygon
                      points={[arrow.tip, ...arrow.barbs].map(p => `${p.x * vw},${p.y * vh}`).join(' ')}
                      className="fill-amber-300 stroke-amber-300"
                      strokeWidth="3"
                      strokeLinejoin="round"
                    />
                    {[directionLine.from, directionLine.to].map((p, pIdx) => {
                      const isHovered = hoveredPoint?.zoneIndex === DIRECTION_LINE_INDEX && hoveredPoint?.pointIndex === pIdx
                      const isDragging = draggingPoint?.zoneIndex === DIRECTION_LINE_INDEX && draggingPoint?.pointIndex === pIdx
                      return (
                        <g
                          key={`dl-pt-${pIdx}`}
                          onMouseEnter={() => setHoveredPoint({ zoneIndex: DIRECTION_LINE_INDEX, pointIndex: pIdx })}
                          onMouseLeave={() => setHoveredPoint(null)}
                          onMouseDown={(e) => handleMouseDown(e, DIRECTION_LINE_INDEX, pIdx)}
                          className="cursor-move"
                        >
                          <circle cx={p.x * vw} cy={p.y * vh} r="25" fill="transparent" />
                          <circle
                            cx={p.x * vw}
                            cy={p.y * vh}
                            r={isDragging ? '10' : isHovered ? '9' : '7'}
                            className="fill-white stroke-amber-500 stroke-[3] transition-all"
                          />
                        </g>
                      )
                    })}
                  </g>
                )}
              </svg>
            )}

            {/* Etiqueta de la flecha: HTML sobre el video para que el texto no se estire con el lienzo */}
            {videoRect && enableDirectionLine && directionLine && arrow && (
              <div
                className="pointer-events-none absolute z-20"
                style={{ left: videoRect.left, top: videoRect.top, width: videoRect.width, height: videoRect.height }}
              >
                <span
                  data-testid="direction-arrow-label"
                  className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-zinc-950 shadow-lg"
                  style={{
                    left: `${clamp01(arrow.tip.x + (arrow.tip.x - arrow.base.x) * 0.5) * 100}%`,
                    top: `${clamp01(arrow.tip.y + (arrow.tip.y - arrow.base.y) * 0.5) * 100}%`,
                  }}
                >
                  {TRAVEL_MEANING_LABELS[meaning]} →
                </span>
              </div>
            )}

            {/* Float HUD */}
            <div className="absolute bottom-8 left-8 z-20 space-y-3 pointer-events-none">
              <motion.div 
                layout
                className="px-5 py-2.5 bg-zinc-950/80 backdrop-blur-2xl rounded-2xl border border-white/10 text-[10px] text-zinc-300 uppercase tracking-[0.2em] font-black flex items-center gap-4 shadow-2xl"
              >
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)]" />
                Motor de Precisión 1.0 (Sin Drift)
              </motion.div>
            </div>
          </div>

          {/* Controls & Sidebar */}
          <div className="w-full md:w-80 bg-zinc-950/90 backdrop-blur-3xl border-l border-white/5 flex flex-col overflow-y-auto">
            
            {/* Control Guide Section */}
            <div className="p-6 border-b border-white/5 bg-white/[0.02]">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-4 flex items-center gap-2">
                <InformationCircleIcon className="h-4 w-4" />
                Interacciones Maestra
              </h3>
              <div className="grid grid-cols-1 gap-2">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
                  <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Añadir Punto</span>
                  <kbd className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] font-mono whitespace-nowrap">L-CLICK</kbd>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10 shadow-inner">
                  <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Ajustar Vértice</span>
                  <kbd className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] font-mono whitespace-nowrap">DRAG</kbd>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
                  <span className="text-[9px] text-indigo-400 font-black uppercase tracking-wider">Cerrar Área</span>
                  <kbd className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] font-mono whitespace-nowrap">R-CLICK</kbd>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-red-500/5 border border-red-500/10">
                  <span className="text-[9px] text-red-500 font-black uppercase tracking-wider">Borrar Nodo</span>
                  <div className="flex gap-1">
                    <kbd className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] font-mono whitespace-nowrap uppercase">Alt</kbd>
                    <span className="text-[9px] text-zinc-600 self-center">+</span>
                    <kbd className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] font-mono whitespace-nowrap uppercase">Click</kbd>
                  </div>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-800/20 border border-white/5 shadow-inner">
                  <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Deshacer</span>
                  <div className="flex gap-1">
                    <kbd className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] font-mono whitespace-nowrap uppercase">Ctrl</kbd>
                    <span className="text-[9px] text-zinc-600 self-center">+</span>
                    <kbd className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] font-mono whitespace-nowrap uppercase">Z</kbd>
                  </div>
                </div>
              </div>
            </div>

            {enableDirectionLine && (
              <section aria-labelledby="direction-line-heading" className="p-6 border-b border-white/5 space-y-4">
                <h3 id="direction-line-heading" className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                  Línea de dirección
                </h3>
                <div role="group" aria-label="Herramienta del lienzo" className="grid grid-cols-2 gap-2">
                  {([['zone', 'Zona'], ['line', 'Línea de dirección']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={tool === value}
                      onClick={() => selectTool(value)}
                      className={`rounded-xl border px-2 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${
                        tool === value
                          ? 'border-amber-400/60 bg-amber-400/15 text-amber-300'
                          : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Field>
                  <Description className="!text-xs !text-zinc-400">
El cruce de la línea manda sobre la dirección fija de la cámara. {DIRECTION_ARROW_HELP}
                  </Description>
                </Field>
                <p role="status" className="text-xs font-semibold text-amber-300">
                  {directionLine
                    ? describeDirectionLine(directionLine, meaning)
                    : lineStart
                      ? 'Marca el segundo punto de la línea (clic derecho cancela).'
                      : describeDirectionLine(null)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    outline
                    type="button"
                    disabled={!directionLine}
                    onClick={flipArrow}
                  >
                    <ArrowsRightLeftIcon className="h-4 w-4" />
                    Invertir sentido
                  </Button>
                  <Button
                    outline
                    type="button"
                    disabled={!directionLine && !lineStart}
                    onClick={() => {
                      setDirectionLine(null)
                      setLineStart(null)
                    }}
                  >
                    <TrashIcon className="h-4 w-4" />
                    Borrar línea
                  </Button>
                </div>
                {directionLine && meaningForRole(cameraRole) === null && (
                  <RadioGroup
                    aria-label="El sentido de la flecha es"
                    value={meaning}
                    onChange={(value: string) => chooseMeaning(value === 'entering' ? 'entering' : 'exiting')}
                    className="!space-y-2"
                  >
                    <p className="text-xs font-semibold text-zinc-300">El sentido de la flecha es:</p>
                    {(['entering', 'exiting'] as const).map(value => (
                      <RadioField key={value}>
                        <Radio value={value} />
                        <Label className="!text-zinc-200">{TRAVEL_MEANING_CHOICE_LABELS[value]}</Label>
                      </RadioField>
                    ))}
                  </RadioGroup>
                )}
              </section>
            )}

            <div className="p-8 flex-1 flex flex-col">
              <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600 mb-6 text-center">Configuraciones Guardadas</h3>
              
              <div className="flex-1 space-y-4">
                <AnimatePresence mode="popLayout">
                  {zones.length === 0 && currentZone.length === 0 ? (
                    <motion.div 
                      key="empty-state"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center justify-center py-20 px-6 text-center border-2 border-dashed border-zinc-900 rounded-[32px] bg-white/[0.01]"
                    >
                      <CursorArrowRaysIcon className="h-10 w-10 text-zinc-800 mb-4" />
                      <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-black">Área sin perímetros</p>
                    </motion.div>
                  ) : (
                    <div className="space-y-3">
                      {zones.map((z, i) => (
                        <motion.div 
                          key={`saved-zone-${i}`}
                          layout
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="group flex flex-wrap items-center justify-between bg-zinc-900/40 hover:bg-zinc-900/70 p-4 rounded-[20px] border border-white/5 transition-all shadow-xl"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-2xl bg-indigo-500/5 flex items-center justify-center text-indigo-400 text-xs font-black border border-indigo-500/10">
                              {i + 1}
                            </div>
                            <div>
                              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Zona {i + 1}</p>
                              <p className="text-[9px] text-zinc-600 font-mono tracking-tighter">{z.points.length} puntos de interés</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-label={`Eliminar zona ${i + 1}`}
                            onClick={() => deleteZoneWithHistory(i)}
                            className="p-2.5 text-zinc-700 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                          {isGuardian && (
                            <div className="mt-3 w-full space-y-2">
                              <div role="group" aria-label={`Tipo de la zona ${i + 1}`} className="grid grid-cols-2 gap-2">
                                {GUARDIAN_ZONE_TYPE_OPTIONS.map(option => (
                                  <button
                                    key={option}
                                    type="button"
                                    aria-pressed={z.type === option}
                                    onClick={() => updateZone(i, { type: option })}
                                    className={`rounded-xl border px-2 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                                      z.type === option
                                        ? option === 'loitering'
                                          ? 'border-amber-400/60 bg-amber-400/15 text-amber-300'
                                          : 'border-red-500/60 bg-red-500/15 text-red-300'
                                        : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10'
                                    }`}
                                  >
                                    {GUARDIAN_TYPE_LABELS[option]}
                                  </button>
                                ))}
                              </div>
                              {z.type === 'loitering' && (
                                <LoiterSecondsInput
                                  zoneNumber={i + 1}
                                  value={z.loiterSeconds}
                                  onCommit={seconds => updateZone(i, { loiterSeconds: seconds })}
                                />
                              )}
                            </div>
                          )}
                        </motion.div>
                      ))}

                      {currentZone.length > 0 && (
                        <motion.div 
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-5 bg-indigo-600/5 border border-indigo-600/20 rounded-[24px] border-dashed animate-pulse my-4"
                        >
                          <div className="flex items-center gap-4 text-indigo-400 font-black text-[9px] uppercase tracking-[0.2em]">
                            <ArrowPathIcon className="h-4 w-4 animate-spin" />
                            Nuevo Trazado ({currentZone.length})
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}
                </AnimatePresence>
              </div>

              <div className="mt-8 space-y-3">
                <Button 
                  outline 
                  className="w-full !border-zinc-900 text-zinc-700 hover:text-white rounded-[20px] py-4 text-[10px] font-black uppercase tracking-widest transition-all"
                  onClick={() => { saveToHistory(); setZones([]); setCurrentZone([]); setDirectionLine(null); setLineStart(null) }}
                >
                  Reiniciar Todo
                </Button>
                <Button 
                  onClick={handleSave}
                  disabled={isSaving || currentZone.length > 0 || lineStart !== null}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 shadow-[0_20px_40px_-10px_rgba(79,70,229,0.3)] rounded-[20px] py-4 transition-all active:scale-95"
                >
                  {isSaving ? <ArrowPathIcon className="h-6 w-6 animate-spin text-white" /> : <CheckCircleIcon className="h-6 w-6 text-white" />}
                  <span className="font-black uppercase tracking-widest ml-2 text-[10px]">{isSaving ? 'Aplicando...' : saveLabel}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </Dialog>
  )
}
