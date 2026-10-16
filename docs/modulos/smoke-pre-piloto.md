# Smoke manual pre-piloto (Fase 4 · P9)

Este es un recorrido manual por los flujos que abren puertas o tocan datos personales, sobre el stack completo en un PC con Windows.

Los tests automáticos ya cubren la lógica: 2577 unit en el backend, 33 e2e de caja negra, más el hub, el frontend y el LPR. Lo que este smoke valida es lo que ningún test automático ve: el navegador real, el micrófono, el video, la voz de Sofía y el hub conectado por socket.

- Duración estimada: entre 1,5 y 2 horas.
- Contexto: [hardening-pre-piloto.md](hardening-pre-piloto.md) §7 y [privacidad-ley-21719.md](privacidad-ley-21719.md).

> **Convenciones.**
> - Los comandos son para **Git Bash** desde la raíz del repo. En PowerShell, usa `curl.exe` y ajusta las comillas del JSON.
> - Los valores entre `<...>` son tuyos y no van al repo.
> - Cada escenario termina con una casilla: márcala o anota la desviación al final, en "Registro".

---

## 0. Preparación (una vez)

### 0.1 `backend/.env`

El backend **no arranca** con el `.env` de antes de la Fase 4: `validateEnv` rechaza los placeholders y exige secretos nuevos. Compáralo con `backend/.env.example`.

| Variable | Valor |
|---|---|
| `BETTER_AUTH_SECRET` | nuevo: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `WORKER_MANAGER_SECRET` | nuevo (mismo comando); el mismo valor va en `lpr/.env` |
| `MEDIAMTX_AUTH_SECRET` | nuevo (mismo comando); **solo** en `backend/.env`, nunca en `mediamtx.yml` |
| `CAMERAS_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (invalida las URLs de cámara cifradas antes; la BD se recrea igual) |
| `FRONTEND_URL` | `http://localhost:5173` |
| `DB_SYNCHRONIZE` | sin definir o `false`: el esquema lo crean las migraciones |
| `SMTP_*` | **reales**. Las cuentas nuevas (admin del condominio, residentes, conserje) solo se activan con el link que llega por email |
| `OPENAI_API_KEY` | real (la voz de Sofía y el análisis de anomalías con foto) |
| `JWT_*` | **borrar** (el JWT legacy se retiró) |
| `TRUST_PROXY` | sin definir en local |

### 0.2 `frontend/.env`

```
VITE_API_URL=http://localhost:3000/api/v1
VITE_WS_URL=http://localhost:3000
VITE_PRIVACY_CONTROLLER_NAME=<responsable del tratamiento>
VITE_PRIVACY_CONTACT_EMAIL=<email de contacto de privacidad>
```

No debe quedar ninguna variable `VITE_KIOSK_*`: el kiosko se empareja en runtime.

### 0.3 Base de datos limpia

La BD de desarrollo tiene auditoría vieja con datos personales y un esquema anterior a la migración base, así que se recrea:

```bash
docker compose -f backend/docker-compose.yml up -d postgres
docker exec vigilia_postgres psql -U <DB_USER> -d postgres \
  -c 'DROP DATABASE IF EXISTS "developDB" WITH (FORCE);' \
  -c 'CREATE DATABASE "developDB";'
npm --prefix backend run migration:run
```

### 0.4 Arranque

1. **Backend:** `npm --prefix backend run start:dev`. El primer arranque siembra los roles y permisos. Espera a ver `Nest application successfully started`.
2. **Super admin** (única cuenta que se crea por script, porque el registro público está deshabilitado):
   ```bash
   node backend/scripts/seed-admin.js <email> '<contraseña>' "<Nombre>"
   ```
3. **Frontend:** `npm --prefix frontend run dev` → `http://localhost:5173`.
4. **MediaMTX** (en otra consola): `mediamtx/mediamtx.exe mediamtx/mediamtx.yml`, o usa `start-dev.bat`, que levanta los tres.
   - Solo escucha WebRTC en `127.0.0.1:8889`, ICE en UDP `8189` y la API en `127.0.0.1:9997`.
   - Autentica cada lectura contra el backend.

**Login por curl** (lo usan varios pasos). Hay que mandar `Origin` = `FRONTEND_URL`, igual que el navegador.

```bash
API=http://localhost:3000
ORIGIN="Origin: http://localhost:5173"
curl -s -c sa.jar -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"email":"<email super admin>","password":"<contraseña>"}' \
  $API/api/auth/sign-in/email
```

El rate limit del login es de 5 por minuto por IP. Si te equivocas varias veces, espera un minuto.

### 0.5 Datos del escenario

Se crean por endpoints o por la UI, nunca con SQL a mano.

1. **Condominio + su Administrador** (super admin; no hay UI para esto):
   ```bash
   curl -s -b sa.jar -H "$ORIGIN" -H 'Content-Type: application/json' \
     -d '{"name":"Condominio Smoke","admin":{"rut":"<rut>","name":"<nombre>","email":"<email admin>","phone":"+569XXXXXXXX"}}' \
     $API/api/v1/onboarding/condominiums
   ```
   Guarda el `id` del condominio (`<ORG_ID>`). El admin recibe un email: abre el link (`/auth/new-password`) y define su contraseña.
2. **Como Administrador**, en la UI (`/settings`):
   - **Unidad:** `/settings/units`, por ejemplo número `101`.
   - **Familia:** `/settings/families`, asociada a la unidad 101.
   - **Usuarios:** en `/settings/users`, crea dos residentes y un conserje.
     - **Residente A** (rol Residente, familia de la 101).
     - **Residente B** (rol Residente, otra unidad o familia; es el "vecino no notificado").
     - **Conserje** (rol Conserje).
   - Cada uno activa su cuenta desde el email.
3. **Kiosko y hub físico simulado** (super admin; no hay UI de hubs). Crea uno de cada tipo:
   ```bash
   curl -s -b sa.jar -H "$ORIGIN" -H 'Content-Type: application/json' \
     -d '{"hubId":"kiosko-smoke","location":"Acceso principal","organizationId":"<ORG_ID>","type":"web-kiosk"}' \
     $API/api/v1/hubs
   curl -s -b sa.jar -H "$ORIGIN" -H 'Content-Type: application/json' \
     -d '{"hubId":"porton-smoke","location":"Portón vehicular","organizationId":"<ORG_ID>","type":"physical-hub"}' \
     $API/api/v1/hubs
   ```
   Cada respuesta trae su `secret` **una sola vez**. Guárdalos. Si pierdes uno, usa `POST /api/v1/hubs/<hubId>/rotate-secret`.
4. **API key del LPR** (como Administrador, sin UI):
   - Haz login por curl con su cuenta en `adm.jar`.
   - Llama:
     ```bash
     curl -s -b adm.jar -H "$ORIGIN" -H 'Content-Type: application/json' \
       -d '{"name":"lpr-smoke"}' $API/api/v1/auth/service-api-keys
     ```
   - La `key` aparece una sola vez: guárdala como `<LPR_KEY>`. La key queda ligada al condominio de quien la emite.
5. **Cámara falsa** (con el servidor RTSP de prueba, solo en loopback):
   ```powershell
   # PowerShell, consola 1
   cd rtsp-simple-server; .\start-server.ps1        # imprime la URL con la clave aleatoria
   # PowerShell, consola 2
   cd rtsp-simple-server; .\publish-test.ps1 -Url 'rtsp://devlocal:<clave>@127.0.0.1:8556/porton'
   ```
   - Crea la cámara como Administrador en `/settings/cameras`:
     - `sourceUrl` = la URL de arriba.
     - **Roles que pueden verla:** Administrador y Conserje. Sin roles, nadie ve el stream (403).
     - Activa **LPR**.
   - Guarda su `id` como `<CAM_ID>`.
   - Cada vez que reinicies `start-server.ps1` cambia la clave, así que hay que editar la `sourceUrl`.
6. **Hub físico simulado**: un script que se conecta como el portón y muestra lo que recibe. Guárdalo **fuera del repo**, por ejemplo como `%TEMP%\smoke-hub.cjs`:
   ```js
   // Uso: NODE_PATH="<repo>/frontend/node_modules" node smoke-hub.cjs http://localhost:3000 porton-smoke <secret>
   const { io } = require('socket.io-client');
   const [url, hubId, hubSecret] = process.argv.slice(2);
   const socket = io(`${url}/hub`, { auth: { hubId, hubSecret }, transports: ['websocket'] });
   socket.on('connect', () => console.log('conectado', socket.id));
   socket.on('hub:connected', (d) => console.log('hub:connected', d));
   socket.on('hub:door_open', (d) => console.log('>>> APERTURA', JSON.stringify(d)));
   socket.on('connect_error', (e) => console.log('connect_error:', e.message));
   socket.on('disconnect', (r) => console.log('desconectado:', r));
   setInterval(() => socket.emit('hub:heartbeat', { uptime: Math.round(process.uptime() * 1000), timestamp: Date.now(), status: 'active' }), 30000);
   ```
   Déjalo corriendo en su propia consola durante los escenarios 3 y 4.

---

## 1. Emparejamiento del kiosko

1. Abre `http://localhost:5173/digital-concierge`. Aparece la pantalla de emparejamiento (ID + secreto del dispositivo).
2. Prueba los tres casos:
   - **Secreto incorrecto** → "Credencial inválida", sin emparejar.
   - **Credencial del hub físico** (`porton-smoke`) → lo rechaza por ser de un hub físico.
   - **Credencial correcta** (`kiosko-smoke`) → muestra el teclado, con el ID del dispositivo enmascarado.
3. Recarga la página: sigue emparejado (la credencial vive en `localStorage`).
4. **Desemparejar:** mantén presionado unos 3 s el texto "Dispositivo …", ingresa el secreto y vuelve a la pantalla de emparejamiento. Empareja de nuevo para el siguiente escenario.
5. Rotación: `POST /api/v1/hubs/kiosko-smoke/rotate-secret` (super admin). En la siguiente llamada, el kiosko vuelve solo a la pantalla de emparejamiento, con un aviso. Empareja con el secreto nuevo.

- [ ] El kiosko solo se empareja con una credencial `web-kiosk` válida, y un 401 lo desempareja.

## 2. Aviso de IA y saludo de Sofía

1. En el kiosko, marca `101`.
2. **Antes** de que el navegador pida el micrófono debe aparecer el aviso: "Vas a hablar con Sofía, una asistente de inteligencia artificial…". Debe incluir el proveedor (OpenAI, EE.UU.), los datos que se registran y el plazo, un QR o link a `/privacy-policy`, y los botones Cancelar y Continuar.
3. **Cancelar** → no se pide el micrófono. **Continuar** → recién ahí aparece el permiso del micrófono.
4. Sofía debe presentarse como asistente virtual con IA, decir que la conversación se transcribe y preguntar el nombre. **Punto a observar:** el kiosko no envía un disparador explícito para que Sofía hable primero, y esto viene de antes de la Fase 4. Si Sofía espera a que el visitante hable, anótalo en el Registro: es un follow-up, no un bloqueante, porque el aviso legal ya lo cubre la pantalla del punto 2.
5. Sofía **nunca** dice el nombre de un residente; solo habla de "la casa 101".

- [ ] El aviso aparece antes del micrófono y Sofía se identifica como IA, sin nombrar residentes.

## 3. Aprobación desde el teléfono

Usa como "teléfono" una segunda ventana del navegador en incógnito, con el modo móvil de DevTools, con la sesión del **Residente A**. En una tercera ventana, opcional, abre la sesión del **Residente B**. El hub físico simulado debe estar conectado (sección 0.5, paso 6).

1. En el kiosko, completa la conversación: nombre, RUT, teléfono, patente (por ejemplo `SMKE11`) y motivo. Sofía notifica a la casa.
2. **Residente A:** aparece el diálogo de aprobación. **Residente B:** no aparece nada.
3. **Aislamiento de la respuesta.** Mientras la visita espera, intenta responder como Residente B por curl (login en `b.jar`). Toma `<SESSION_ID>` y `<VISIT_ID>` de la notificación o de los logs del backend:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -b b.jar -H "$ORIGIN" -H 'Content-Type: application/json' \
     -d '{"approved":true,"visitId":"<VISIT_ID>"}' $API/api/v1/concierge/session/<SESSION_ID>/respond
   ```
   Esperado: `403`.
4. **Residente A aprueba.** Pasan tres cosas:
   - La consola del hub simulado muestra `>>> APERTURA`.
   - El kiosko recibe la respuesta: Sofía da la bienvenida y cierra.
   - La visita queda con ingreso registrado.
5. **Doble respuesta:** repite el curl del paso 3 con la sesión del Residente A. Esperado: `409`.
6. **Sin hub físico.** Detén el script del hub y repite el flujo. Al aprobar **no hay apertura**: el kiosko dice que se avisó a conserjería y los conserjes reciben una alerta. Es el comportamiento esperado (`entryRegistered:false`).

- [ ] Solo el residente notificado aprueba, la apertura llega al hub físico (nunca al kiosko), y la doble respuesta da 409.

## 4. LPR (portón vehicular)

El worker real (`lpr/`) no se puede instalar hoy con `requirements.txt` (conflicto entre numpy y ultralytics, follow-up de la Fase 5). La decisión del backend se prueba **simulando la ingesta** con la key del LPR, exactamente como lo haría el worker.

```bash
plate() {
  curl -s -H "x-api-key: <LPR_KEY>" -H 'Content-Type: application/json' \
    -d "{\"cameraId\":\"<CAM_ID>\",\"plate\":\"$1\"}" $API/api/v1/detections/plates; echo
}
```

1. **Patente desconocida:** `plate ZZZZ99`. Esperado: `"decision":"Pendiente"` y `requiresApproval:true`, el conserje recibe una notificación de vehículo desconocido y **no** hay apertura en el hub.
2. **Visita esperando aprobación:** inicia en el kiosko una visita con patente `SMKE22` y **no** la apruebes. Luego `plate SMKE22`. Esperado: `Pendiente`, sin apertura, y la visita sigue en `awaiting_approval`.
3. **Visita aprobada:** aprueba esa visita como Residente A. Al aprobar se abre y queda registrado el ingreso (check-in), así que la visita pasa a `active`.
   - Repite `plate SMKE22` **antes de 5 minutos**. Esperado: `Duplicado`, sin efectos y **sin** una segunda apertura. Esa espera es `VISIT_EXIT_COOLDOWN_MINUTES`, con default 5.
   - Repítelo **pasados los 5 minutos**. Esperado: salida (check-out) con apertura.
4. **Vehículo de residente:** el Residente A registra un vehículo propio (patente `RSDT33`) desde la UI. Luego `plate RSDT33`. Esperado: `"decision":"Permitido"` y `>>> APERTURA` en el hub físico.
5. **Credenciales inválidas:**
   - `x-api-key: a` → `401`.
   - Cámara de otro condominio, o un `cameraId` inexistente → `403`.
6. **Límite de body:**
   - Un JSON de más de 100 kb **sin** key, contra cualquier ruta → `413`.
   - El mismo JSON contra `/api/v1/detections/plates` con `x-api-key: a` (inválida) → `401`. El body grande no se procesa.
7. **Desactivar el vehículo:** desactiva `RSDT33` y repite. Esperado: ya no da `Permitido`. Así se revoca un vehículo.

- [ ] El LPR solo abre con un vehículo de residente activo o una visita aprobada (entrada y salida, respetando la espera); todo lo demás escala al conserje.

## 5. Stream de cámara

1. Con MediaMTX y la cámara falsa arriba, espera hasta 30 s: el backend registra el path solo (`MediamtxSyncService`).
2. **Administrador o Conserje:** abre la vista de cámaras. Se ve el video de prueba (`testsrc`).
3. **Residente:** no tiene el rol en la cámara, así que no ve el stream (403 o la cámara no aparece).
4. **Cierra sesión** y abre la URL de la vista: no hay stream.
5. **MediaMTX directo sin credenciales:**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8889/<mountPath>/whep
   ```
   Esperado: `401`. El navegador solo ve video a través de `POST /api/v1/streams/whep`.
6. **Puertos** (PowerShell): `netstat -ano | findstr "LISTENING" | findstr ":8554 :1935 :8888 :8890"`. Esperado: **sin resultados**. Los únicos de MediaMTX deben ser `8889`, `9997` y UDP `8189`.
7. **Reinicio de MediaMTX:** ciérralo y vuelve a abrirlo. En menos de 1 minuto el video vuelve sin tocar nada.

- [ ] Solo los roles asignados ven la cámara, y MediaMTX no sirve nada sin la autorización del backend.

## 6. Modal de anomalía

Ten abiertas las sesiones del **Conserje** (o del Administrador) y del **Residente A**.

```bash
curl -s -H "x-api-key: <LPR_KEY>" -H 'Content-Type: application/json' \
  -d '{"cameraId":"<CAM_ID>","anomalyType":"loitering","confidence":0.9}' \
  $API/api/v1/anomalies; echo
```

1. **Conserje y Administrador:** aparece el modal de alerta de seguridad, con severidad MEDIUM porque va sin foto.
2. **Residente A:** no ve nada.
3. **Super admin:** no ve nada (no pertenece a ningún condominio).
4. Con el condominio de otra key (si creaste un segundo condominio) → `403`.

- [ ] La alerta llega solo al personal de seguridad del condominio.

## 7. Socket anónimo rechazado

Guarda este script fuera del repo, por ejemplo como `%TEMP%\smoke-anon.cjs`, y ejecútalo con `NODE_PATH="<repo>/frontend/node_modules" node smoke-anon.cjs`:

```js
const { io } = require('socket.io-client');
const API = 'http://localhost:3000';
const probe = (label, url, opts) => new Promise((resolve) => {
  const s = io(url, { transports: ['websocket'], reconnection: false, ...opts });
  s.on('connect', () => { console.log(label, '→ CONECTÓ (MAL)'); s.close(); resolve(); });
  s.on('connect_error', (e) => { console.log(label, '→', e.message); s.close(); resolve(); });
});
(async () => {
  await probe('raíz sin cookie', API, {});
  await probe('/hub sin credencial', `${API}/hub`, {});
  await probe('/hub con secreto falso', `${API}/hub`, { auth: { hubId: 'porton-smoke', hubSecret: 'x'.repeat(40) } });
  await probe('origen ajeno', API, { extraHeaders: { Origin: 'https://evil.example' } });
})();
```

Esperado:
- los tres primeros → `unauthorized`;
- el origen ajeno → error de handshake (`origin not allowed` o un error de websocket);
- **ninguno** imprime `CONECTÓ`.

- [ ] Ningún socket se conecta sin sesión o credencial válida.

## 8. Privacidad

1. **Exportación de datos propios:** como Residente A, `GET /api/v1/auth/me/data-export` (con su `.jar`). Devuelve un JSON solo con sus datos.
2. **Política:** `http://localhost:5173/privacy-policy` muestra el responsable y el contacto de `VITE_PRIVACY_*`, los plazos (imágenes 30 d, visitas 90 d, auditoría 365 d), la IA y los encargados.
3. **Retención en dry-run:** `node backend/scripts/retention-run.js`. Imprime conteos por categoría y **no** borra nada. No uses `--apply` en esta etapa.

- [ ] Los derechos y la retención funcionan, y la política refleja los plazos reales.

## 9. Cierre

- Detén el backend, el frontend, MediaMTX, `start-server.ps1`, `publish-test.ps1` y los scripts de prueba (no dejes procesos huérfanos).
- Opcional: `docker compose -f backend/docker-compose.yml stop` y cerrar Docker Desktop.
- Borra `*.jar` y los scripts de `%TEMP%`. Contienen sesiones y secretos.

---

## Registro

| # | Escenario | Resultado | Observación |
|---|---|---|---|
| 1 | Emparejamiento del kiosko | | |
| 2 | Aviso de IA y saludo | | |
| 3 | Aprobación desde el teléfono | | |
| 4 | LPR | | |
| 5 | Stream | | |
| 6 | Anomalía | | |
| 7 | Socket anónimo | | |
| 8 | Privacidad | | |

Cualquier desviación en los escenarios 3, 4, 5 o 7 (apertura, video o acceso) **bloquea el piloto** hasta corregirla. Las desviaciones de UX o de texto pasan a follow-up.
