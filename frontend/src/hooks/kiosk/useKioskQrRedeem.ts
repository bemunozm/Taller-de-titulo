import { useEffect, useRef, useState, type RefObject } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { ConciergeAPI } from '@/api/ConciergeAPI'
import { isRateLimitError } from '@/helpers/httpErrors'
import { KIOSK_QR_CODE_PATTERN, outcomeFromRedeemResult, type KioskQrOutcome } from '@/helpers/kioskQr'

/** Sin ningún código en este tiempo, vuelve al inicio. */
export const KIOSK_QR_SCAN_TIMEOUT_MS = 30_000
/** Tiempo que se muestra el resultado antes de volver al inicio. */
export const KIOSK_QR_RESULT_MS = 6_000

/** Contador de lectores: el id de cada arranque es único en el documento. */
let readerCounter = 0

export type KioskQrPhase = 'starting' | 'scanning' | 'redeeming' | 'result'

interface UseKioskQrRedeemOptions {
  /**
   * Contenedor donde `html5-qrcode` dibuja la cámara. Cada arranque crea su
   * propio hijo con id único: dos arranques seguidos (StrictMode, un reintento)
   * no se pisan al limpiar.
   */
  containerRef: RefObject<HTMLElement | null>
  /** Volver al inicio: por timeout, por el fin del resultado o si el visitante cancela. */
  onExit: () => void
}

interface UseKioskQrRedeemResult {
  phase: KioskQrPhase
  outcome: KioskQrOutcome | null
}

/**
 * Modo "Tengo un código QR" del kiosko. Abre la cámara frontal, lee UN código,
 * lo canjea (`ConciergeAPI.redeemVisitQr`) y muestra el resultado.
 *
 * - Un solo canje a la vez: tras la primera lectura el escáner ignora todo lo
 *   demás (la cámara sigue entregando el mismo código varios cuadros por segundo).
 * - La cámara se libera SIEMPRE: al leer, ante un error, por timeout, al
 *   cancelar y al desmontar (también si el desmontaje llega a medio arrancar).
 * - El contenido del QR es una credencial de acceso: no se guarda ni se registra.
 */
export function useKioskQrRedeem({ containerRef, onExit }: UseKioskQrRedeemOptions): UseKioskQrRedeemResult {
  const [phase, setPhase] = useState<KioskQrPhase>('starting')
  const [outcome, setOutcome] = useState<KioskQrOutcome | null>(null)
  const onExitRef = useRef(onExit)

  useEffect(() => {
    onExitRef.current = onExit
  })

  useEffect(() => {
    const host = containerRef.current
    if (!host) {
      return
    }
    const reader = document.createElement('div')
    reader.id = `kiosk-qr-reader-${(readerCounter += 1)}`
    host.appendChild(reader)

    let disposed = false
    let handled = false
    let released = false
    let scanTimer: ReturnType<typeof setTimeout> | null = null
    let resultTimer: ReturnType<typeof setTimeout> | null = null
    let startPromise: Promise<unknown> | null = null
    const scanner = new Html5Qrcode(reader.id, false)

    const releaseCamera = () => {
      if (released) {
        return
      }
      released = true
      const stop = async () => {
        try {
          await scanner.stop()
        } catch {
          // Nunca llegó a arrancar o ya estaba detenida.
        }
        try {
          scanner.clear()
        } catch {
          // Sin nada que limpiar.
        }
        reader.remove()
      }
      // Si el desmontaje llega con la cámara arrancando, se detiene apenas arranca.
      if (startPromise) {
        void startPromise.then(stop, stop)
      } else {
        void stop()
      }
    }

    const finish = (result: KioskQrOutcome) => {
      if (disposed) {
        return
      }
      releaseCamera()
      setOutcome(result)
      setPhase('result')
      resultTimer = setTimeout(() => {
        resultTimer = null
        onExitRef.current()
      }, KIOSK_QR_RESULT_MS)
    }

    const redeem = async (code: string) => {
      try {
        const result = await ConciergeAPI.redeemVisitQr(code)
        finish(outcomeFromRedeemResult(result))
      } catch (error) {
        finish(isRateLimitError(error) ? { kind: 'rate-limited' } : { kind: 'error' })
      }
    }

    const handleDecoded = (decodedText: string) => {
      if (disposed || handled) {
        return
      }
      handled = true
      if (scanTimer !== null) {
        clearTimeout(scanTimer)
        scanTimer = null
      }
      releaseCamera()
      setPhase('redeeming')

      const code = decodedText.trim()
      if (!KIOSK_QR_CODE_PATTERN.test(code)) {
        // Un QR cualquiera (no de una visita): ni siquiera se manda al backend.
        finish({ kind: 'denied', reason: 'invalid' })
        return
      }
      void redeem(code)
    }

    scanTimer = setTimeout(() => {
      scanTimer = null
      if (!handled) {
        handled = true
        releaseCamera()
        onExitRef.current()
      }
    }, KIOSK_QR_SCAN_TIMEOUT_MS)

    startPromise = scanner
      .start(
        { facingMode: 'user' },
        {
          fps: 10,
          aspectRatio: 1,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const side = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.7)
            return { width: side, height: side }
          },
        },
        handleDecoded,
        () => undefined,
      )
      .then(() => {
        if (!disposed && !handled) {
          setPhase('scanning')
        }
      })
      .catch(() => {
        if (disposed || handled) {
          return
        }
        handled = true
        if (scanTimer !== null) {
          clearTimeout(scanTimer)
          scanTimer = null
        }
        finish({ kind: 'camera-error' })
      })

    return () => {
      disposed = true
      handled = true
      if (scanTimer !== null) {
        clearTimeout(scanTimer)
      }
      if (resultTimer !== null) {
        clearTimeout(resultTimer)
      }
      releaseCamera()
    }
  }, [containerRef])

  return { phase, outcome }
}
