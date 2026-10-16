import { useCallback, useEffect, useRef } from 'react'
import { isAxiosError } from 'axios'
import { ConciergeAPI, KioskNotPairedError } from '@/api/ConciergeAPI'
import { kioskSocket } from '@/services/KioskSocketService'
import {
  createResidentResponseWatcher,
  type ResidentResponseWatcher,
} from '@/helpers/residentResponseWatcher'
import type { KioskWaitOutcome } from '@/helpers/kioskResidentResponse'

interface UseResidentResponseWatcherOptions {
  sessionId: string | null
  /** `true` desde que se notificó al residente: habilita el polling y la espera máxima. */
  awaitingResponse: boolean
  /** Fin de la espera: respuesta del residente, sesión cerrada o sin respuesta. Se llama una vez. */
  onOutcome: (outcome: KioskWaitOutcome) => void
}

interface UseResidentResponseWatcherResult {
  /** Reinicia la espera máxima desde ahora (reenvío exitoso de la notificación). Estable. */
  restartMaxWait: () => void
}

/** 401 (credencial borrada), 403 y 404 no se arreglan reintentando. */
function isRetryablePollError(error: unknown): boolean {
  if (error instanceof KioskNotPairedError) {
    return false
  }
  if (isAxiosError(error)) {
    const status = error.response?.status
    return status !== 401 && status !== 403 && status !== 404
  }
  return true
}

/**
 * Escucha la respuesta del residente para la sesión del kiosko: socket `/hub`
 * desde que hay `sessionId`, y polling de `/status` (con espera máxima)
 * mientras se espera. La espera termina una vez; el cambio de sesión o el
 * desmontaje cancelan socket, polling y timers.
 */
export function useResidentResponseWatcher({
  sessionId,
  awaitingResponse,
  onOutcome,
}: UseResidentResponseWatcherOptions): UseResidentResponseWatcherResult {
  const onOutcomeRef = useRef(onOutcome)
  const watcherRef = useRef<ResidentResponseWatcher | null>(null)

  useEffect(() => {
    onOutcomeRef.current = onOutcome
  })

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const watcher = createResidentResponseWatcher({
      sessionId,
      subscribe: (handler) => kioskSocket.on(`visitor:response:${sessionId}`, handler),
      fetchStatus: () => ConciergeAPI.getKioskSessionStatus(sessionId),
      onResolved: (outcome) => onOutcomeRef.current(outcome),
      onClosed: () => onOutcomeRef.current('closed'),
      onTimeout: () => onOutcomeRef.current('no-response'),
      shouldRetry: isRetryablePollError,
    })
    watcherRef.current = watcher

    return () => {
      watcher.stop()
      watcherRef.current = null
    }
  }, [sessionId])

  useEffect(() => {
    if (sessionId && awaitingResponse) {
      watcherRef.current?.startPolling()
    }
  }, [sessionId, awaitingResponse])

  const restartMaxWait = useCallback(() => {
    watcherRef.current?.restartMaxWait()
  }, [])

  return { restartMaxWait }
}
