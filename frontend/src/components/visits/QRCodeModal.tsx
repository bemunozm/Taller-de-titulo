import { Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { XMarkIcon, ArrowDownTrayIcon, ShareIcon } from '@heroicons/react/24/outline'
import { QRCodeSVG } from 'qrcode.react'
import type { Visit } from '@/types/index'

interface QRCodeModalProps {
  isOpen: boolean
  onClose: () => void
  visit: Visit | null
}

export function QRCodeModal({ isOpen, onClose, visit }: QRCodeModalProps) {
  if (!visit || !visit.qrCode) return null

  const handleDownload = () => {
    const svg = document.getElementById('qr-code-svg')
    if (!svg) return

    // Convertir SVG a PNG
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    
    img.onload = () => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      
      // Descargar
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `visita-${visit.id}-qr.png`
        a.click()
        URL.revokeObjectURL(url)
      })
    }
    
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    img.src = url
  }

  const handleShare = async () => {
    const svg = document.getElementById('qr-code-svg')
    if (!svg) return

    try {
      // Convertir SVG a Blob
      const svgData = new XMLSerializer().serializeToString(svg)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const img = new Image()
      
      img.onload = async () => {
        canvas.width = img.width
        canvas.height = img.height
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        
        canvas.toBlob(async (blob) => {
          if (!blob) return
          
          const file = new File([blob], `visita-${visit.id}-qr.png`, { type: 'image/png' })
          
          if (navigator.share && navigator.canShare({ files: [file] })) {
            try {
              await navigator.share({
                title: 'Código QR de Visita',
                text: `Código QR para visita de ${visit.visitorName}`,
                files: [file],
              })
            } catch (error) {
              if ((error as Error).name !== 'AbortError') {
                console.error('Error compartiendo:', error)
                fallbackCopyToClipboard()
              }
            }
          } else {
            fallbackCopyToClipboard()
          }
        })
      }
      
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)
      img.src = url
    } catch (error) {
      console.error('Error al compartir:', error)
      fallbackCopyToClipboard()
    }
  }

  const fallbackCopyToClipboard = async () => {
    const svg = document.getElementById('qr-code-svg')
    if (!svg) return

    try {
      // Convertir SVG a Blob
      const svgData = new XMLSerializer().serializeToString(svg)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const img = new Image()
      
      img.onload = async () => {
        canvas.width = img.width
        canvas.height = img.height
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        
        // Intentar copiar al portapapeles
        canvas.toBlob(async (blob) => {
          if (!blob) return
          
          try {
            if (navigator.clipboard && navigator.clipboard.write) {
              // API moderna de portapapeles (Clipboard API)
              const item = new ClipboardItem({ 'image/png': blob })
              await navigator.clipboard.write([item])
              alert('Imagen QR copiada al portapapeles')
            } else {
              // Fallback: descargar la imagen si no se puede copiar
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `visita-${visit.id}-qr.png`
              a.click()
              URL.revokeObjectURL(url)
              alert('Imagen descargada (no se pudo copiar al portapapeles)')
            }
          } catch (error) {
            console.error('Error al copiar al portapapeles:', error)
            // Fallback final: descargar
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `visita-${visit.id}-qr.png`
            a.click()
            URL.revokeObjectURL(url)
            alert('Imagen descargada (no se pudo copiar al portapapeles)')
          }
        })
      }
      
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)
      img.src = url
    } catch (error) {
      console.error('Error al procesar la imagen:', error)
      alert('No se pudo procesar la imagen QR')
    }
  }

  const getVisitTypeLabel = () => {
    return visit.type === 'vehicular' ? 'Vehicular' : 'Peatonal'
  }

  const getVisitDetails = () => {
    if (visit.type === 'vehicular' && visit.vehicle) {
      return `${visit.vehicle.plate} - ${visit.vehicle.brand || ''} ${visit.vehicle.model || ''}`.trim()
    }
    return 'Visita Peatonal'
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-zinc-800 p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-start justify-between mb-4">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-semibold leading-6 text-zinc-900 dark:text-zinc-100"
                  >
                    Código QR de Visita
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-md text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 focus:outline-none"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Información de la visita */}
                  <div className="bg-zinc-50 dark:bg-zinc-700/50 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Visitante:
                      </span>
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {visit.visitorName}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Tipo:
                      </span>
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {getVisitTypeLabel()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Detalles:
                      </span>
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {getVisitDetails()}
                      </span>
                    </div>
                    {visit.maxUses !== null && visit.maxUses !== undefined && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          Usos:
                        </span>
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {visit.usedCount || 0} / {visit.maxUses}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Código QR */}
                  <div className="flex flex-col items-center justify-center bg-white dark:bg-zinc-900 rounded-lg p-6 border-2 border-zinc-200 dark:border-zinc-700">
                    <QRCodeSVG
                      id="qr-code-svg"
                      value={visit.qrCode}
                      size={256}
                      level="H"
                      includeMargin={true}
                      className="rounded-lg"
                    />
                    <p className="mt-4 text-xs text-center text-zinc-500 dark:text-zinc-400 font-mono break-all">
                      {visit.qrCode}
                    </p>
                  </div>

                  {/* Información adicional */}
                  {visit.type === 'vehicular' && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                      <p className="text-xs text-blue-800 dark:text-blue-300">
                        <strong>💡 Respaldo LPR:</strong> Este código QR funciona como respaldo en caso de que el sistema de reconocimiento de patentes no detecte correctamente el vehículo.
                      </p>
                    </div>
                  )}

                  {/* Botones de acción */}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-800 transition-colors"
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" />
                      Descargar
                    </button>
                    <button
                      type="button"
                      onClick={handleShare}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-800 transition-colors"
                    >
                      <ShareIcon className="h-5 w-5" />
                      Compartir
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
