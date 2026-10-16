# rtsp-simple-server (LEGACY, solo desarrollo)

> **No usar en el piloto ni en ningún despliegue.** Esta carpeta es un servidor
> de medios de **prueba** para publicar un stream sintético en el propio equipo
> del desarrollador. El servidor de medios de Vigilia es `mediamtx/`
> (`mediamtx.yml`, con autenticación contra el backend).

Se conserva por compatibilidad con pruebas antiguas. Contiene:

- `mediamtx.exe`: binario de MediaMTX (v1.15.2; el nombre de la carpeta es el
  del proyecto antes de que se renombrara).
- `rtsp-simple.yml`: configuración de prueba.
- `start-server.ps1`: arranca el servidor con esa configuración.
- `publish-test.ps1`: publica un stream sintético con `ffmpeg`.

## Endurecimiento (Fase 4 · P6.M)

Antes tenía los defaults de MediaMTX: el usuario anónimo `any` con permiso de
publicar y leer desde cualquier IP, y todos los servidores (RTSP, HLS, WebRTC,
SRT) escuchando en todas las interfaces. Ahora:

- **Solo loopback:** cada listener está en `127.0.0.1` (RTSP solo por TCP, sin
  UDP ni multicast; sin STUN externo).
- **Sin usuario anónimo:** un único usuario `devlocal`, solo desde loopback,
  con permiso de publicar y leer.
- **Sin contraseña en el repo:** el yml trae el hash de un valor aleatorio
  descartado (si se ejecuta el binario a mano, nadie puede entrar).
  `start-server.ps1` genera una contraseña aleatoria en cada ejecución, la pasa
  por el entorno (`MTX_AUTHINTERNALUSERS_0_*`: MediaMTX reemplaza el elemento
  completo de la lista, así que se pasan usuario, clave, IPs y permisos) y la
  imprime en la consola.
- `start-server.ps1` no arranca sin `rtsp-simple.yml` (los defaults de MediaMTX
  abren todo).

## Uso

```powershell
cd rtsp-simple-server
.\start-server.ps1
# En otra consola, con la URL que imprimió el script:
.\publish-test.ps1 -Url 'rtsp://devlocal:<clave>@127.0.0.1:8556/mystream'
```

Puertos de prueba (solo `127.0.0.1`): RTSP 8556, HLS 18888, WebRTC 18889 + ICE
UDP 8199, SRT 8899. No chocan con los de `mediamtx/` (8889, 8189, 9997).
