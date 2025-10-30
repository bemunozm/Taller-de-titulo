import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify'
import api from '@/lib/axios';

type Props = {
  cameraId: string;
};

export default function CameraPlayer({ cameraId }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [connected, setConnected] = useState(false);
  const [hasStream, setHasStream] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const maxRetries = 3;

  useEffect(() => {
    let mounted = true;
    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

    const clearRetryTimer = () => {
      try {
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current as any);
          retryTimerRef.current = null;
        }
      } catch {}
    }

  const attemptReconnect = async () => {
      if (!mounted) return;
      retryRef.current += 1;
      setRetries(retryRef.current);
      if (retryRef.current > maxRetries) {
        setError('No se pudo reconectar después de varios intentos');
        setLoading(false);
        return;
      }

      const backoff = 1500 * Math.pow(2, retryRef.current - 1);
      setError(null);
      setLoading(true);
      // wait before retrying
      await delay(backoff);
      if (!mounted) return;
      // close existing pc before retrying
      try {
        if (pcRef.current) {
          pcRef.current.close();
          pcRef.current = null;
        }
      } catch {}

      // call start again
      start();
    }

    const start = async () => {
  const token = localStorage.getItem('AUTH_TOKEN');
  const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;

      pc.ontrack = (ev) => {
        if (!mounted) return;
        if (videoRef.current) {
          videoRef.current.srcObject = ev.streams[0];
          // mark that we have an active stream
          try { setHasStream(true); } catch {}
        }
      };

      // no-op: we rely on waiting for ICE to finish via events/timeouts

      pc.onconnectionstatechange = () => {
        if (!pc) return;
        const st = pc.connectionState as unknown as string;
        setConnected(['connected', 'completed'].includes(st));
        // if connection lost, consider stream not present
        if (['disconnected', 'failed', 'closed'].includes(st)) {
          try { setHasStream(false); } catch {}
        }
        // When connection lost, try to reconnect
        if (mounted && ['disconnected', 'failed', 'closed'].includes(st)) {
          // if we still have attempts left, schedule reconnect
          if (!['connected', 'completed'].includes(st)) {
            // start reconnection attempts
            // small timeout to allow state updates
            retryTimerRef.current = window.setTimeout(() => {
              attemptReconnect();
            }, 250);
          }
        }
      };

  // create data channel to ensure negotiation if needed
        try {
        // Ensure the offer contains media sections and ICE credentials by
        // adding recvonly transceivers for video and audio.
        try {
          pc.addTransceiver('video', { direction: 'recvonly' });
        } catch (e) {
          console.debug('addTransceiver not supported or failed', e);
        }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

        // Wait briefly for ICE candidates (timeout fallback)
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === 'complete') return resolve();
          const onIce = (ev: RTCPeerConnectionIceEvent) => {
            if ((ev?.candidate) === null) {
              try { pc.removeEventListener('icecandidate', onIce as any); } catch {}
              console.debug('[CameraPlayer] ice end detected via event');
              return resolve();
            }
          };
          pc.addEventListener('icecandidate', onIce as any);
          setTimeout(() => {
            try { pc.removeEventListener('icecandidate', onIce as any); } catch {}
            resolve();
          }, 3000);
        });

        const localSdp = pc.localDescription?.sdp ?? offer.sdp;
        const url = `/streams/whep`;
  // send cameraMount (could be mountPath or id) to backend
  const resp = await api.post(url, { offer: localSdp, cameraMount: cameraId }, config);
  const answerSdp = resp.data?.answer ?? resp.data;
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp } as RTCSessionDescriptionInit);
        // Remote description applied — negotiation finished (may still be connecting)
        setLoading(false);
        // reset retry counters on successful negotiation
        retryRef.current = 0;
        setRetries(0);
        setError(null);
      } catch (err: any) {
        console.error('WHEP negotiation failed', err?.message ?? err);
        const msg = err?.response?.data?.message ?? err?.message ?? String(err);
        setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
        attemptReconnect();
      }
    };
    start();

    return () => {
      mounted = false;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      try { setHasStream(false); } catch {}
      clearRetryTimer();
      retryRef.current = 0;
      setRetries(0);
    };
  }, [cameraId]);

  return (
    <div className="relative h-full">
      {/* Screenshot button (bottom-right) — mostrarse solo si hay stream activo */}
      {hasStream && (
        <div className="absolute right-3 bottom-3 z-40">
          <button
            type="button"
            aria-label="Tomar screenshot"
            onClick={async () => {
              try {
                const v = videoRef.current
                if (!v) {
                  toast.error('Video no disponible para capturar')
                  return
                }
                const width = v.videoWidth || v.clientWidth
                const height = v.videoHeight || v.clientHeight
                if (!width || !height) {
                  toast.error('No hay frame disponible para capturar')
                  return
                }
                const canvas = document.createElement('canvas')
                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext('2d')
                if (!ctx) {
                  toast.error('No fue posible crear canvas')
                  return
                }
                ctx.drawImage(v, 0, 0, width, height)
                // convert to blob and download
                canvas.toBlob((blob) => {
                  if (!blob) {
                    toast.error('No fue posible generar la imagen')
                    return
                  }
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  const safeId = (cameraId || 'camera').toString().replace(/[^a-z0-9-_]/gi, '_')
                  a.download = `${safeId}-${Date.now()}.png`
                  document.body.appendChild(a)
                  a.click()
                  a.remove()
                  setTimeout(() => URL.revokeObjectURL(url), 5000)
                  toast.success('Captura descargada')
                }, 'image/png')
              } catch (err: any) {
                console.error('Screenshot failed', err)
                try { toast.error(err?.message || 'Error al capturar') } catch {}
              }
            }}
            className="rounded-full bg-black/50 p-3 hover:bg-black/70 text-white shadow-md sm:p-2"
          >
            <svg className="h-5 w-5 sm:h-4 sm:w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M3 7h3l2-2h8l2 2h3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls={connected}
        className="w-full h-full object-cover bg-black"
      />

      {/* Badge de estado en esquina superior derecha */}
      <div className="absolute right-4 top-4 z-30">
        {loading ? (
          // Small circular indicator when loading/reconnecting (no text)
          <div className="h-3 w-3 rounded-full bg-yellow-500 shadow-md" aria-hidden />
        ) : (
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium text-white shadow-sm 
              ${error ? 'bg-red-600' : connected ? 'bg-green-600' : 'bg-zinc-600'}`}
          >
            {(!loading && retries > 0 && !error) ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : null}
            <span>
              {error ? 'Error' : connected ? 'Conectado' : 'Desconectado'}
            </span>
          </div>
        )}
      </div>

      {/* Overlay centrado de carga (solo cuando loading y sin error) */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white p-4 z-20">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-black/60 px-6 py-4">
            <svg className="h-8 w-8 animate-spin" viewBox="0 0 24 24" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <div className="text-sm font-medium">
              {retries > 0 && !connected ? `Reconectando… (intento ${retries}/${maxRetries})` : 'Detectando…'}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white p-4 z-30">
          <div className="max-w-md text-center rounded-lg bg-black/50 p-4">
            <div className="font-semibold">Error al cargar la cámara</div>
            <div className="text-sm mt-2">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
}
