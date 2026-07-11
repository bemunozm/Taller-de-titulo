import { useState, useRef, useEffect, useCallback } from 'react'
import type { Camera } from '@/types/index'
import api from '@/lib/axios'
import { toast } from 'react-toastify'
import { 
  TrashIcon, 
  CheckCircleIcon, 
  ArrowPathIcon,
  XMarkIcon,
  ArrowsPointingOutIcon,
  CursorArrowRaysIcon,
  InformationCircleIcon,
  ArrowUturnLeftIcon
} from '@heroicons/react/24/outline'
import CameraPlayer from '../CameraPlayer'
import { 
  Dialog, 
  DialogTitle, 
  DialogDescription
} from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { motion, AnimatePresence } from 'motion/react'

type Point = { x: number; y: number }

type GuardianZoneEditorProps = {
  camera: Camera
  onClose: () => void
  onSaved: () => void
}

export default function GuardianZoneEditor({ camera, onClose, onSaved }: GuardianZoneEditorProps) {
  const [zones, setZones] = useState<Point[][]>(camera.guardianZones || [])
  const [currentZone, setCurrentZone] = useState<Point[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [hoveredPoint, setHoveredPoint] = useState<{ zoneIndex: number, pointIndex: number } | null>(null)
  const [draggingPoint, setDraggingPoint] = useState<{ zoneIndex: number, pointIndex: number } | null>(null)
  
  // Undo/History capability
  const [history, setHistory] = useState<Point[][][]>([])
  
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
    return {
      x: svgPoint.x / 1000,
      y: svgPoint.y / 1000
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
      
      if (zoneIndex === -1) {
        setCurrentZone(prev => prev.filter((_, i) => i !== pointIndex))
      } else {
        setZones(prev => {
          const next = [...prev]
          const zone = next[zoneIndex].filter((_, i) => i !== pointIndex)
          if (zone.length < 3) {
            toast.warning('La zona fue eliminada por tener menos de 3 puntos')
            return next.filter((_, i) => i !== zoneIndex)
          }
          next[zoneIndex] = zone
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

    if (draggingPoint.zoneIndex === -1) {
      setCurrentZone(prev => {
        const next = [...prev]
        next[draggingPoint.pointIndex] = pt
        return next
      })
    } else {
      setZones(prev => {
        const next = [...prev]
        const zone = [...next[draggingPoint.zoneIndex]]
        zone[draggingPoint.pointIndex] = pt
        next[draggingPoint.zoneIndex] = zone
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
    setCurrentZone(prev => [...prev, pt])
  }

  const handleSvgContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault()
    if (currentZone.length >= 3) {
      saveToHistory()
      setZones(prev => [...prev, currentZone])
      setCurrentZone([])
    } else if (currentZone.length > 0) {
      toast.info('Se requieren al menos 3 puntos.')
    }
  }

  const deleteZoneWithHistory = (index: number) => {
    saveToHistory()
    setZones(prev => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await api.patch(`/cameras/${camera.id}/zones`, { zones })
      toast.success('Cambios sincronizados correctamente')
      onSaved()
    } catch (err) {
      toast.error('Error al guardar')
    } finally {
      setIsSaving(false)
    }
  }

  const vw = 1000
  const vh = vw

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
                Perímetro de Seguridad <span className="text-indigo-500 ml-2 font-black">AI</span>
              </DialogTitle>
              <DialogDescription className="text-zinc-400">
                Ajustando precisión visual para <span className="text-indigo-400 font-bold">{camera.name}</span>
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
            <Button plain onClick={onClose} className="p-2 text-zinc-400 hover:text-white transition-all">
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
                      points={zone.map(p => `${p.x * vw},${p.y * vh}`).join(' ')}
                      className="fill-red-500/10 stroke-red-500/40 hover:fill-red-500/20 transition-all duration-300 cursor-pointer"
                      strokeWidth="2"
                    />
                    {zone.map((p, pIdx) => {
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
                            <circle cx={p.x * vw} cy={p.y * vh} r="18" className="fill-red-500/10 animate-pulse" />
                          )}
                          <circle
                            cx={p.x * vw}
                            cy={p.y * vh}
                            r={isDragging ? "10" : isHovered ? "9" : "6"}
                            className={`fill-white stroke-red-500 stroke-[3] transition-all duration-200 ${isDragging ? 'shadow-2xl' : ''}`}
                            style={{ filter: isHovered || isDragging ? 'drop-shadow(0 0 12px rgba(239, 68, 68, 0.6))' : 'none' }}
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
              </svg>
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
                          className="group flex items-center justify-between bg-zinc-900/40 hover:bg-zinc-900/70 p-4 rounded-[20px] border border-white/5 transition-all shadow-xl"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-2xl bg-indigo-500/5 flex items-center justify-center text-indigo-400 text-xs font-black border border-indigo-500/10">
                              {i + 1}
                            </div>
                            <div>
                              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Zona {i + 1}</p>
                              <p className="text-[9px] text-zinc-600 font-mono tracking-tighter">{z.length} puntos de interés</p>
                            </div>
                          </div>
                          <button
                            onClick={() => deleteZoneWithHistory(i)}
                            className="p-2.5 text-zinc-700 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
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
                  onClick={() => { saveToHistory(); setZones([]); setCurrentZone([]) }}
                >
                  Reiniciar Todo
                </Button>
                <Button 
                  onClick={handleSave}
                  disabled={isSaving || currentZone.length > 0}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 shadow-[0_20px_40px_-10px_rgba(79,70,229,0.3)] rounded-[20px] py-4 transition-all active:scale-95"
                >
                  {isSaving ? <ArrowPathIcon className="h-6 w-6 animate-spin text-white" /> : <CheckCircleIcon className="h-6 w-6 text-white" />}
                  <span className="font-black uppercase tracking-widest ml-2 text-[10px]">{isSaving ? 'Aplicando...' : 'Fijar Precisión'}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </Dialog>
  )
}
