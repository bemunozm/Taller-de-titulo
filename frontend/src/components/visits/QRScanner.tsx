import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface QRScannerProps {
  onScan: (data: string) => void
  onError?: (error: string) => void
  isScanning: boolean
}

export function QRScanner({ onScan, onError, isScanning }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [selectedCamera, setSelectedCamera] = useState<string>('')
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string>('')
  const hasScannedRef = useRef(false) // Para evitar múltiples escaneos

  // Los callbacks viven en refs: si el padre pasa funciones nuevas en cada
  // render, la cámara no se reinicia (antes eran dependencias del efecto).
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onScanRef.current = onScan
    onErrorRef.current = onError
  }, [onScan, onError])

  useEffect(() => {
    // Obtener cámaras disponibles
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (devices && devices.length > 0) {
          setCameras(
            devices.map((device) => ({
              id: device.id,
              label: device.label || `Cámara ${device.id}`,
            }))
          )
          // Seleccionar cámara trasera por defecto (si está disponible)
          const backCamera = devices.find(
            (device) =>
              device.label.toLowerCase().includes('back') ||
              device.label.toLowerCase().includes('rear') ||
              device.label.toLowerCase().includes('trasera')
          )
          setSelectedCamera(backCamera?.id || devices[0].id)
        } else {
          setError('No se encontraron cámaras disponibles')
          onErrorRef.current?.('No se encontraron cámaras disponibles')
        }
      })
      .catch(() => {
        // El error se informa en pantalla y vía `onError`; no se escribe en consola.
        setError('Error al acceder a las cámaras')
        onErrorRef.current?.('Error al acceder a las cámaras')
      })

    return () => {
      // Limpiar al desmontar
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => {
            scannerRef.current?.clear()
          })
          .catch(() => {
            // Ya estaba detenido: nada que limpiar.
          })
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedCamera || !isScanning) {
      // Si dejamos de escanear, detener el scanner. `getState` funciona aunque
      // nunca haya arrancado (devuelve NOT_STARTED), así que no hace falta
      // consultar `isInitialized` (que además reiniciaría el efecto).
      const stopScanner = async () => {
        if (scannerRef.current) {
          try {
            const state = await scannerRef.current.getState()
            if (state === 2) { // 2 = SCANNING
              await scannerRef.current.stop()
              scannerRef.current.clear()
            }
          } catch {
            // Ya estaba detenido: nada que hacer.
          } finally {
            setIsInitialized(false)
          }
        }
      }
      stopScanner()
      return
    }

    const startScanner = async () => {
      try {
        // Resetear flag de escaneo
        hasScannedRef.current = false
        
        // Crear instancia del escáner
        scannerRef.current = new Html5Qrcode('qr-reader')

        // Configuración del escáner
        const config = {
          fps: 10, // Frames por segundo
          qrbox: { width: 250, height: 250 }, // Área de escaneo
          aspectRatio: 1.0,
        }

        // Iniciar escaneo
        await scannerRef.current.start(
          selectedCamera,
          config,
          (decodedText) => {
            // El contenido del QR es una credencial de acceso: se entrega al
            // callback y nunca se escribe en consola.

            // Evitar múltiples llamadas al callback
            if (hasScannedRef.current) return
            hasScannedRef.current = true

            // Llamar al callback
            onScanRef.current(decodedText)

            // Detener el escáner después de un escaneo exitoso
            setTimeout(async () => {
              if (scannerRef.current) {
                try {
                  const state = await scannerRef.current.getState()
                  if (state === 2) { // 2 = SCANNING
                    await scannerRef.current.stop()
                    scannerRef.current.clear()
                    setIsInitialized(false)
                  }
                } catch {
                  // Ya estaba detenido: solo se refleja en el estado.
                  setIsInitialized(false)
                }
              }
            }, 100)
          },
          () => {
            // Error de escaneo (normal durante el proceso)
            // No hacer nada, es normal que ocurran errores mientras busca QR
          }
        )

        setIsInitialized(true)
        setError('')
      } catch {
        // El error se informa en pantalla y vía `onError`; no se escribe en consola.
        setError('Error al iniciar la cámara')
        onErrorRef.current?.('Error al iniciar la cámara')
      }
    }

    startScanner()

    return () => {
      // Cleanup
      const cleanup = async () => {
        if (scannerRef.current) {
          try {
            const state = await scannerRef.current.getState()
            if (state === 2) { // 2 = SCANNING
              await scannerRef.current.stop()
              scannerRef.current.clear()
            }
          } catch {
            // Ya estaba detenido: nada que hacer.
          } finally {
            setIsInitialized(false)
          }
        }
      }
      cleanup()
    }
  }, [selectedCamera, isScanning])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-red-50 dark:bg-red-900/20 rounded-lg border-2 border-red-200 dark:border-red-800">
        <XMarkIcon className="w-12 h-12 text-red-600 dark:text-red-400 mb-4" />
        <p className="text-red-800 dark:text-red-300 text-center font-medium">
          {error}
        </p>
        <p className="text-red-600 dark:text-red-400 text-sm text-center mt-2">
          Asegúrate de haber dado permisos de cámara al navegador
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Selector de cámara */}
      {cameras.length > 1 && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="camera-select"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Seleccionar Cámara:
          </label>
          <select
            id="camera-select"
            value={selectedCamera}
            onChange={(e) => setSelectedCamera(e.target.value)}
            className="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isScanning && isInitialized}
          >
            {cameras.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Área de escaneo */}
      <div className="relative rounded-lg overflow-hidden bg-black">
        <div
          id="qr-reader"
          className="w-full"
          style={{ minHeight: '300px' }}
        />
        
        {/* Overlay con instrucciones */}
        {!isInitialized && isScanning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-white text-center p-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
              <p className="font-medium">Iniciando cámara...</p>
            </div>
          </div>
        )}
      </div>

      {/* Instrucciones */}
      {isInitialized && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-800 dark:text-blue-300 text-center">
            📱 Coloca el código QR dentro del área marcada para escanearlo
          </p>
        </div>
      )}
    </div>
  )
}
