# Taller de Titulo - Desarrollo (Mini guía)

Este README rápido describe cómo levantar el entorno de desarrollo local mínimo para probar la transmisión de cámaras con MediaMTX, backend NestJS y frontend React.

Requisitos:
- Node.js (16+)
- npm
- PowerShell (Windows)

Archivos importantes:
- `start-dev.bat` — script que abre 3 ventanas de PowerShell: backend, frontend y MediaMTX (binario). Coloca `mediamtx.exe` y `mediamtx.yml` en `./mediamtx` antes de ejecutar.
- `backend/mediamtx.yml` — configuración de MediaMTX (dev).
- `frontend/src/components/CameraPlayer.tsx` — player WHEP mínimo.
- `backend/src/streams` — endpoint `/streams/whep` que reenvía la oferta SDP a MediaMTX.

Pasos para ejecutar (Windows):

1. Copia `mediamtx.exe` en la carpeta `mediamtx` (ya debe contener `mediamtx.yml`).
2. Desde la raíz del repo ejecutar:
```
start-dev.bat
```
Esto abrirá 3 ventanas: backend (puerto 3000), frontend (Vite por defecto 5173) y MediaMTX.

3. Publicar un stream (ejemplo con ffmpeg desde la máquina host):
```
ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=25 -f lavfi -i sine=frequency=1000 -c:v libx264 -preset veryfast -tune zerolatency -c:a aac -f rtsp rtsp://localhost:8554/live/cam1
```

4. Abrir el frontend (`http://localhost:5173`) y navegar a la vista Demo Cámara. Escribe `live/cam1` y debería verse el vídeo.

Notas de debugging:
- Si ves `ICE failed` en la consola del navegador, considera añadir un servidor TURN o ejecutar MediaMTX en el host (como se hace aquí).
- Para producción elimina el usuario `any` en `mediamtx.yml` y configura autenticación y TURN seguros.

Si quieres que haga commit de estos cambios y prepare un PR, dímelo y lo hago.
