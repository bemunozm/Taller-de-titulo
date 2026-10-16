# Fase 4 — Hardening pre-piloto: diseño

> Estado: 🟡 en progreso · Rama: `feature/fase-4-hardening` · Plan aprobado el 2026-10-08.
> Origen: auditoría integral del 2026-10-08, con cuatro frentes: estado por subsistema, builds/tests, seguridad y fuentes de video. Ver [04-plan-por-fases.md](../04-plan-por-fases.md#fase-4--hardening-pre-piloto-seguridad-base-de-producción-y-privacidad-).

## 1. Problema

Vigilia abre puertas físicas y guarda datos personales. La auditoría lo declaró **no apto para un piloto con personas reales**:

- **Caminos de apertura sin aprobación:**
  - `notifyResident` crea la visita en `PENDING` con la patente que dicta el visitante, y el LPR acepta `PENDING`.
  - `/respond` no controla quién aprueba.
  - El secret del kiosko viaja en el bundle público.
  - El LPR decide "Permitido" antes de revisar el estado de la visita (`detections.service.ts:139,184`) y deja pasar vehículos "sin tipo" (`:169-173`).
- **Fugas entre condominios:** usuarios, unidades, detecciones, cámaras (autorizadas solo por rol global) y WebSocket (anónimo, con broadcast global de imágenes).
- **Escalada de roles:** un admin de condominio puede asignarse "Super Administrador"; los roles de sistema se pueden editar o borrar, y los roles son globales.
- **Sin base de producción:**
  - Sin migración base (`synchronize`), y la migración 1707 está rota.
  - Se aceptan los secretos placeholder.
  - JWT legacy de 365 días.
  - 67+3 tests rojos.
  - Sin CI.
- **Privacidad (Ley 21.719, vigente el 1-dic-2026):**
  - Sin aviso de IA.
  - Sin retención de datos.
  - Imágenes persistidas.
  - Política de privacidad que no coincide con el código.

## 2. Decisiones

| # | Decisión | Razón |
|---|---|---|
| D1 | **Migración base consolidada (P2):** esquema actual + tablas de better-auth (SQL de su CLI) + `pgcrypto`. Las 8 migraciones viejas pasan a `migrations/legacy/`. Los cambios posteriores son migraciones incrementales. Las BD de desarrollo se recrean. | No hay producción. La migración 1707 está rota (snake_case vs. camelCase, `uuid_generate_v4` sin extensión). CI detecta drift. |
| D2 | **Estado `AWAITING_APPROVAL`** y máquina de estados explícita (`visits/visit-state-machine.ts`). Aprobar y denegar son transiciones con *claim* condicional. | Separa "solicitada" de "aprobada" sin cambiar el significado de `PENDING`. |
| D3 | **`validateAccess` con lista blanca.** `checkIn` solo desde `PENDING` o `READY_FOR_REENTRY`. `status` sale de los DTO públicos. | Con la lista negra actual, el QR del estado nuevo validaría. Hoy `checkIn` acepta DENIED/COMPLETED. |
| D4 | **LPR fail-closed:** "Permitido" solo en las ramas explícitas de entrada y salida; el vehículo sin tipo escala al conserje. Enum en vez de literales. | Fail-open actual. |
| D5 | **`/respond`:** solo sesión humana. Autoriza si `req.user.id ∈ residentsNotified` o si el usuario tiene `digital-concierge.manage`. DTO `@IsBoolean`. Sin `residentId` en el body. Claim `respondedById/respondedAt`; 409 si se repite. | El Residente no tiene permisos de conserje: la autorización correcta es la pertenencia a `residentsNotified`. |
| D6 | **Kiosko con credencial de dispositivo provisionada en runtime** (emparejamiento → `localStorage`). Se eliminan `VITE_KIOSK_*`. `Hub.type` se propaga a `AuthenticatedHub`, `AuthorizedContext.channel` y `ConnectedHubInfo`. | Nada de secretos en el bundle; limitar lo que puede hacer un kiosko. |
| D7 | **`hub:door_open` solo a hubs físicos** (`sendDoorOpen`); `visitor:response` solo al hub dueño de la sesión. El kiosko se conecta a `/hub`. | Hoy el kiosko no recibe la respuesta. Si se conectara sin este cambio, la apertura le llegaría a él y no al portón. |
| D8 | **Tools por canal:** `consultar_*` requieren `digital-concierge.manage`; `allowedChannels` en `VigiliaTool`; `agent-config` filtrado por canal. | El prompt de voz no usa `consultar_*`. |
| D9 | **Throttling:** un throttler `default`, `@RateLimit('<política>')`, `VigiliaThrottlerGuard` (contador por hub, usuario o IP) y `TRUST_PROXY`. | Hoy cada ruta hereda los 3 límites (el real es 5/min). |
| D10 | **Roles:** solo el super-admin modifica roles y permisos. `RoleAssignmentPolicy`: sin super-admin ni `platform.*`, regla de subconjunto, no editar los propios roles, mismo condominio. `DEFAULT_ROLES` no se pueden borrar. | Los roles son globales; el seed no propaga permisos nuevos. |
| D11 | **`createAccountByAdmin` crea la membresía** (`OrganizationMembershipService`). Backfill con script idempotente y warning al arrancar. | Al filtrar por condominio desaparecerían los usuarios creados desde la UI. |
| D12 | **Aislamiento** con `scopeWhere` / `applyTenantFilter` / `TenantScope` pasado desde el controller, y variantes `*ForActor`. | No volver request-scoped a `UsersService`. |
| D13 | **Realtime:** `IoAdapter` con lista de orígenes, handshake con sesión better-auth, salas asignadas por el servidor (`user:<id>`, `org:<id>:conserje`), anomalías por condominio, sin `broadcastAlert` ni componentes huérfanos. | Hoy hay CORS `*` efectivo, sockets anónimos y broadcast global. |
| D14 | **MediaMTX:** control de red (WHEP solo en la interfaz interna; `rtsp/rtmp/hls/srt` desactivados) + `authMethod: http` contra el backend con secreto compartido. | v1.15.2 lo soporta; `lpr/` no lee de MediaMTX. |
| D15 | **Privacidad:** aviso de IA (prompt + kiosko antes de `getUserMedia`), `RetentionService` (lotes, solo estados terminales, `anonymizedAt`, dry-run), cron de `AuditService.cleanup`, redacción en `auditToolCall`, snapshots de detecciones con retención de 7 días y `PrivacyPolicyView` alineada con el código. | Mínimos de la Ley 21.719. |
| D16 | **Unificar `/respond` con `PendingAction` se difiere;** solo se copia su patrón de claim. | `PendingAction` no tiene UI. |

**Decisiones de Benjamin (2026-10-08):**
- El manager LPR pasa a `x-api-key` sobre un `WorkersController` nuevo, y se retira por completo el JWT legacy y `create-service-token`.
- **Visita aprobada por el conserje (peatonal o vehicular), revisado el 2026-10-08:** check-in al aprobar, en el mismo evento que abre la puerta o el portón. Este punto reemplaza la decisión inicial ("vehicular queda `PENDING` sin check-in"), que QA refutó:
  - El LPR descarta la misma patente durante 120 s (`LPR_DEDUP_SECONDS`) y las cámaras no conocen el sentido (entrada o salida).
  - Por eso la lectura del auto entrando se perdía, la salida se registraba como entrada y un regreso dentro de 24 h se trataba como "salida", lo que abría sin aprobación.
- **Espera antes de la salida (`VISIT_EXIT_COOLDOWN_MINUTES`, default 5):** el LPR no registra la salida de una visita `ACTIVE` hasta que pasa ese tiempo desde la entrada. Así, la lectura del auto que todavía está pasando no se confunde con una salida.
- **Follow-up (Fase 5):** configurar el sentido de cada cámara (entrada o salida) cuando se conozca la distribución de cámaras del NVR del piloto.

**Detalle de la P4 (Nova, 2026-10-08, sobre el estado posterior a P3):**
- **Quién gana la respuesta.** El *claim* atómico ya existe sobre la visita (`approve`/`deny` con `claimTransition`, 409). Por eso `respondedById` (FK a `user`, `ON DELETE SET NULL`) y `respondedAt` se guardan en **`visits`**, escritos en el mismo `UPDATE` del *claim*. No se agrega otro *claim* sobre la sesión: habría dos fuentes de verdad que pueden quedar inconsistentes. `session.residentResponse` sigue siendo informativo.
- **`/respond` solo humano.** La ruta sale de la clase con `ConciergeAuthGuard` (que admite hubs) y pasa a un controlador propio con `AuthGuard`, en la **misma URL**. El body es `{ approved: boolean, visitId: uuid }`; con `forbidNonWhitelisted`, un `residentId` responde 400. Si `visitId` no coincide con `session.createdVisit.id` → 409. La respuesta HTTP es `{ success, message, entryRegistered }`.
- **`/status`.** Sigue bajo `ConciergeAuthGuard`, pero autoriza solo:
  - al hub dueño de la sesión (`session.hubId`);
  - a los residentes de `residentsNotified`;
  - a quien tiene `digital-concierge.manage`.

  Además expone `visitId`, `residentResponse` y `entryRegistered`. Es el respaldo por *polling* del kiosko.
- **Identidad del dispositivo.** `GET /concierge/device` (solo `HubAuthGuard`) devuelve `{ hubId, type, organizationId }`; el emparejamiento del kiosko lo usa para validar la credencial y exigir `type = web-kiosk`. No va en `/hubs/me`, porque chocaría con `GET /hubs/:hubId`. La credencial vive en `localStorage` del dispositivo y un 401 HTTP la borra. El riesgo de XSS sobre `localStorage` se acepta para el piloto; el follow-up es el código de emparejamiento de un solo uso.
- **Enrutamiento** (`HubGateway`):
  - **`sendDoorOpen`** entrega solo a sockets `physical-hub`: al hub de la sesión si es físico y está conectado; si no, a los hubs físicos del condominio. Nunca a un `web-kiosk`.
  - **`visitor:response:*`** va solo al socket dueño de la sesión, **sin caer al condominio**: esa caída filtraría la respuesta a otros kioskos. El kiosko se respalda con *polling*.
  - **Handlers `hub:*`:** usan la identidad del handshake, nunca el `hubId` del body.
  - **Reconexiones:** una reconexión con el mismo `hubId` desconecta el socket anterior. Rotar el secret o desactivar el hub desconecta su socket.
- **Mensaje al visitante fail-closed.** El hub y el kiosko solo dicen "pase" si `approved === true && entryRegistered === true`. Todo emisor de `visitor:response:*` (incluido `PendingActionsService.notifyVisitorLive`) manda ambos campos.
- **Throttling sin guard global.** `@RateLimit('<política>')` compone `UseGuards(VigiliaThrottlerGuard)` + `Throttle({ default })` a nivel de método. Así corre después de los guards de autenticación y el contador puede ser `hub:`/`user:`/IP. Un `APP_GUARD` global correría antes de la autenticación y frenaría la ingesta del LPR. Al haber un solo throttler nombrado, desaparece el apilamiento de límites.
- **Auditoría de login** con `hooks`/`databaseHooks` de better-auth. `AuditService` está fuera de DI, así que un *sink* registrado al iniciar `AuthModule` lo conecta. Es best-effort: auditar nunca bloquea el login.

**Detalle de la P5 (Nova, 2026-10-08, sobre el estado posterior a P4):**
- **Roles de sistema inmutables y definidos en el código.**
  - Los `DEFAULT_ROLES` no se renombran, no se borran y sus permisos no se cambian por la API.
  - `DataInitializationService` los sincroniza al arrancar: agrega los permisos que falten y quita los que sobren. Así un permiso nuevo llega a los roles ya sembrados, y desaparece el problema de "el seed no propaga".
  - Solo el super-admin crea, edita o borra roles personalizados y cambia sus permisos (D10). El chequeo es explícito con `isSuperAdmin`, sin depender solo del permiso `roles.*`.
  - `GET /roles/:id` ya no devuelve `users`.
- **`RoleAssignmentPolicy`** es una función pura, extraída de `assertCanAssignServiceApiKeyTo`/`managesOrganization`. Se aplica en `create-by-admin`, `PATCH /users/:id` y `POST /onboarding/members`. Para quien no es super-admin:
  - no puede asignar el rol "Super Administrador" ni roles con permisos `platform.*`;
  - cada rol asignado debe tener un subconjunto de los permisos del actor;
  - no puede editar sus propios roles;
  - el usuario destino debe ser del mismo condominio.
- **Membresías (D11).** `OrganizationMembershipService` crea el `member` en `createAccountByAdmin`.
  - Lo usan también los dos caminos del onboarding, con compensación si falla.
  - Se retira `POST /users`: creaba usuarios sin contraseña ni membresía y la UI no lo usa.
  - Hay un script idempotente de backfill que deriva el condominio de `user.family.organizationId` y reporta los casos ambiguos, más un aviso al arrancar.
  - `/respond` y `/status` exigen `isActiveMemberOfOrganization` para el residente notificado.
- **Humanos sin condominio:** las lecturas devuelven **vacío**, ya no el cajón nulo, y las creaciones de recursos del condominio responden 403. El super-admin crea recursos indicando un `organizationId` explícito; ese campo se acepta solo de él.
- **Usuarios:** variantes `*ForActor`, con un join a `member` en el controller, para `GET`, `PATCH`, `DELETE`, `disable` y `enable`. Los callers internos de `UsersService` no cambian (D12).
- **Ver todo el condominio** es un permiso nuevo, `condominium.view-all`, para Administrador, Conserje y Seguridad. Sin él (el Residente), visitas, vehículos, detecciones y familias quedan acotados a la familia propia, en lectura y en escritura. Reemplaza al `UserFilterInterceptor`, que decidía por nombre de rol.
  - El `qrCode` solo se devuelve a la familia del anfitrión.
  - Un residente crea visitas solo para sí mismo o su familia.
- **Cámaras:** cada lectura y escritura por id se acota al condominio.
  - `GET /cameras/:id/source` exige `cameras.update` (es una credencial).
  - `CameraViewGuard` compara el condominio de la cámara usando `TenantContextService`.
- **Auditoría:** columna `organizationId` en `audit_logs` (migración), que estampan el interceptor y el *sink* de login.
  - El Administrador lee solo su condominio.
  - Los eventos sin condominio, como `LOGIN_FAILED`, los ve solo el super-admin.
  - Los **logs del sistema** son de plataforma: solo el super-admin.
  - El dashboard acota todos sus conteos y la actividad reciente.
- **Unicidad por condominio:** `UNIQUE (organizationId, plate)` y `(organizationId, identifier)` con `NULLS NOT DISTINCT` (Postgres 15). Un conflicto responde 409, no 500.
- **`vehicleType`/`accessLevel`:** enum en el código y `@IsIn`, sin enum en la BD, porque la decisión del portón compara esos literales.
- **Vehículos, modelo corregido** (P5.C; el bug ya existía: la UI guardaba la carrocería en `vehicleType` y el portón comparaba ese campo con `residente`/`visitante`, así que nada de lo registrado por la UI abría):
  - `vehicleType` es la **carrocería**: `auto | camioneta | moto | camion | otro | null`. Es descriptivo.
  - `accessLevel` es lo **único que decide el portón**: `residente` → permitido; `visitante` → abre solo con una visita válida; `servicio` o `null` → escala al conserje.
  - Una migración convierte los datos: `vehicleType` `residente`/`visitante` → `accessLevel`; `permanente` → `residente`; `temporal` → `visitante`.
  - **Decisión de Benjamin (2026-10-09):** un vehículo que registra un residente **abre de inmediato** (`residente`), tal como hoy, aunque ciberseguridad confirmó que así cualquier residente puede dar pase permanente a una patente no registrada.
  - Salvaguardas que no cambian esa decisión:
    - el portón exige que el dueño sea **miembro activo** del condominio;
    - quien está acotado a su familia no puede reactivar un vehículo desactivado ni subir su `accessLevel` al editarlo (solo bajarlo), así que la revocación del Administrador prevalece;
    - ese mismo actor solo ve las detecciones posteriores al registro del vehículo.
- **Contratos de la P5.C para el frontend:**
  - `GET /users` devuelve todos los datos solo con `users.update` o al super-admin; al resto, `{ id, name, family: { id, name } | null }`.
  - `GET /roles` agrega `isSystem`.
  - El listado de condominios para el selector del super-admin al crear usuarios (ruta exacta según el reporte del backend).
  - `GET /vehicles/:id`, acotado.
  - `qrCode` es `null` para quien no es de la familia del anfitrión.
  - `GET /anomalies` pasa a sesión humana, acotada al condominio, si no hay otro consumidor con key.
- **Ejecución:**
  - **P5.A** (roles, usuarios, membresías, auditoría, logs y la base de tenant) y **P5.B** (aislamiento de recursos: cámaras, detecciones, anomalías, unidades, vehículos, notificaciones, familias y dashboard) van en paralelo, con archivos disjuntos.
  - **P5.C** va después: alcance por familia (`condominium.view-all`) y `qrCode`, y el frontend si hace falta.

**Detalle de la P6 (Nova, 2026-10-09, sobre el estado posterior a P5):**
- **`VigiliaIoAdapter` (D13)** en `main.ts`:
  - fija el CORS de socket.io para todos los namespaces al origen de `FRONTEND_URL`, con `credentials`;
  - en `allowRequest` acepta un `Origin` de la lista, o ninguno (clientes Node: vigilia-hub);
  - los decoradores dejan de usar `origin: '*'`.
- **Namespace `/` autenticado antes del CONNECT**, con un middleware como el de `/hub`:
  - la sesión de better-auth se lee de la cookie del handshake con un `BetterAuthSessionResolver` compartido con `AuthGuard` (hoy duplicado);
  - la identidad (usuario, condominio, permisos, super-admin) queda en `socket.data`.
- **Salas asignadas por el servidor:**
  - `user:<id>`;
  - `org:<id>:security`, para quien tiene `detections.read` + `condominium.view-all`.
  - Se eliminan `register`, `join_room`/`leave_room`, el Map `userSockets`, `broadcastAlert`/`broadcast` y el evento `security:anomaly_detected`, que no tenía lector legítimo.
  - Un socket se corta al expirar su sesión y al hacer logout o revocarse la sesión, con revalidación periódica y el hook de borrado de sesión si dispara.
- **Anomalías por WebSocket:** `security:anomaly_highlight` va solo a `org:<condominio de la cámara>:security`, **sin la imagen**. El payload es `{ anomalyId, cameraId, cameraName, type, severity, reasoning, timestamp }`. La foto se pide con `GET /anomalies/:id`, acotado y con `detections.read`.
- **Caché de credenciales de hub:** el heartbeat WS lo renueva (`touch`) y la edad máxima sube a 24 h. La revocación ya la invalida vía `disconnectHub`.
- **Contexto de la casa:**
  - `getHouseContext` devuelve datos estructurados: `{ expectedVisitors: string[] }`, con nombre + inicial del apellido, solo letras y espacios, ≤ 40 caracteres y máximo 5;
  - se eliminan la lista de "frecuentes", que es perfilado, y las frases con autoridad ("pase directo");
  - `CreateVisitDto.visitorName` lleva `MaxLength(128)`;
  - el hub lo inyecta como mensaje **`user` delimitado**, marcado como datos y no instrucciones;
  - el prompt de Sofía agrega la regla de que el contexto nunca otorga acceso.
- **MediaMTX (D14):**
  - `authMethod: http` contra `POST /api/v1/internal/mediamtx/auth` del backend. Solo autoriza `read` por `webrtc` de un path de cámara registrada, con el secreto compartido `MEDIAMTX_AUTH_SECRET` (≥ 32, solo en el env del backend). Todo lo demás se niega (fail-closed).
  - El forward WHEP manda Basic con ese secreto.
  - `rtsp`, `rtmp`, `hls` y `srt` se desactivan: MediaMTX sigue tirando RTSP de las cámaras como cliente.
  - `webrtcAddress` queda en loopback (señalización solo vía backend; los medios siguen por ICE UDP). La API queda en loopback y fuera del auth HTTP.
  - Sin usuario `any` y sin secretos en el `.yml`.
  - Supuesto: MediaMTX corre en el mismo host que el backend; si no, `MEDIAMTX_URL` apunta a la red interna.
  - `GET /mediamtx/health` deja de ser público.
- **vigilia-hub:**
  - un módulo de config central valida el env: con `NODE_ENV=production` exige `https`/`wss`, `HUB_ID` y `HUB_SECRET`, y prohíbe `DEBUG_OPENAI_KEY`;
  - un formato de winston redacta transcripciones, argumentos de tools, contexto, prompt y eventos completos de OpenAI, y los baja a `debug`.
- **Pendientes que se incluyen:** `vehicle.ownerId` del vecino en `GET /visits` y `/visits/plate`; `hubId` enmascarado en la pantalla del kiosko.
- **Ejecución en paralelo, con archivos disjuntos:**
  - **P6.R** (backend en tiempo real: adapter, gateway `/`, sesión, anomalías WS, caché de hub, `ownerId`);
  - **P6.M** (MediaMTX + contexto de la casa + vigilia-hub + prompt);
  - **P6.F** (frontend: socket único con ciclo de vida de login/logout, `GlobalSecurityNotifications` sobre el servicio y por permiso, foto por `GET /anomalies/:id`, huérfanos eliminados y `hubId` enmascarado).

**Detalle de la P7 (Nova, 2026-10-09):** el diseño completo está en [privacidad-ley-21719.md](privacidad-ley-21719.md): bases de licitud, tabla de retención, derechos, textos de aviso, cartel y EIPD.
- **P7.R (backend: retención y derechos):**
  - `RetentionService`: diario, por lotes, con dry-run e idempotente con `anonymizedAt`; plazos `RETENTION_*_DAYS` validados en el env;
  - anonimización de visitas, sesiones, detecciones y usuarios deshabilitados; borrado de imágenes (también en Cloudinary), anomalías, notificaciones, acciones pendientes, auditoría y logs;
  - `GET /auth/me/data-export`;
  - `POST /privacy/erasure` por RUT, patente o usuario, con el permiso nuevo `privacy.manage`.
- **P7.L (backend: logs, redacción y prompt):**
  - logs sin datos personales;
  - `LOG_LEVEL` (su validación la agrega P7.R en `env.validation.ts`);
  - auditoría, `auditToolCall` y `pending_actions` redactados;
  - aviso de IA y finalidades en el prompt de Sofía;
  - dispositivos sin nombres de residentes en las tools;
  - `sourceUrl` sin `"'<>`;
  - el hub no persiste audio.
- **P7.F (frontend):**
  - política pública según el art. 14 ter, enlazada desde la landing, el login y el kiosko;
  - pantalla de aviso del kiosko antes de `getUserMedia`;
  - "Descargar mis datos" en el perfil.

**Detalle de la P8 (Nova, 2026-10-09):**
- **E2E de caja negra con better-auth real.** El runner (Jest con `test/jest-e2e.json`) usa un `globalSetup` que:
  1. crea una BD limpia y corre `migration:run`;
  2. arranca la **app compilada** (`node dist/main.js`) como proceso hijo, en un puerto libre y con un env de prueba válido;
  3. espera a que responda y siembra el primer super-admin (`seed-admin.js`, que también lee `process.env`).

  Los datos se crean **por endpoints** (condominios, usuarios, hubs, API key del LPR). OpenAI se reemplaza por un **servidor falso local**, apuntando ahí la URL base nueva `OPENAI_API_BASE_URL` (en producción, la oficial). El `globalTeardown` mata el proceso y borra la BD.
- **Casos:**
  - el LPR no abre con una visita AWAITING_APPROVAL;
  - `/respond`: 403 a un residente no notificado, 401 con credencial de hub, 409 en una doble respuesta, 200 al notificado;
  - un admin de A no lee ni edita usuarios de B, y nadie escala a Super Administrador;
  - `GET /cameras/:id/source` de otro condominio da 404;
  - los endpoints nativos de better-auth fuera de la lista blanca dan 404;
  - un body de más de 100 kb da 413;
  - un socket `/` sin sesión se rechaza.
- **Ejecución:** los e2e se escriben y **compilan con `tsc`** en P8, pero **se ejecutan por primera vez en P9** (metodología de Benjamin).
- **CI (GitHub Actions, `.github/workflows/ci.yml`):**
  - **Bloqueantes:**
    - backend: typecheck, build, unit, `migration:run` + `migration:check` y e2e con Postgres 15 como service;
    - hub: typecheck, test y build;
    - frontend: test y build;
    - lpr: pytest con un set liviano `lpr/requirements-ci.txt`, que es posible porque los tests reemplazan torch y ultralytics por stubs.
  - **No bloqueantes:** `lint:check` del backend, `lint` del frontend y `npm audit`.
  - Node 22 (`.nvmrc` + `engines`), porque better-auth requiere `require(esm)`, y Python 3.12.
  - `pigpio` pasa a `optionalDependencies` del hub (`gpio-wrapper` ya tolera que falte).
  - Cobertura con umbrales en trinquete: el nivel actual menos un margen.
  - `scripts/gate.sh` para correr el gate completo en local.
- **Deuda:** el warning de Jest "worker failed to exit gracefully" (timers sin `unref`); el `requirements.txt` completo del LPR (subir ultralytics/torch) sigue como follow-up de la Fase 5, porque exige revalidar el detector.

**Detalle de la P9 (Nova, 2026-10-09). Contratos que cambian en la ronda de higiene del gate (P9.H):**

**Backend**
- **Límite de body de la ingesta:**
  - Los 10 MB se aplican solo con una API key **ya verificada**. El middleware la verifica una vez y deja el resultado en la request, en una propiedad `Symbol` atada al string exacto de la key. `ServiceApiKeyGuard` reutiliza ese resultado: no se duplican las escrituras de better-auth en `apikey`.
  - Una key inválida, o un error del verificador, no se parsea (el body se descarta) y el guard responde 401.
  - Sin key se aplica el límite general de 100 kb.
- **`HOST`:** el puerto de escucha es configurable; el default `0.0.0.0` se mantiene porque el hub y el LPR llegan por LAN. Con `TRUST_PROXY > 0` y `HOST` distinto de loopback, el backend avisa al arrancar: el puerto debe quedar accesible solo desde el proxy, porque si no `X-Forwarded-For` anula el límite de login por IP.
- **Swagger** (`/api`): en producción se publica solo con `SWAGGER_ENABLED=true`.
- **Cookies:**
  - `useSecureCookies = NODE_ENV=production || BETTER_AUTH_URL https`.
  - Fuera de producción con https, la cookie pasa a `__Secure-…`.
  - `validateEnv` avisa si hay URLs https con un `NODE_ENV` distinto de `production`.
- **`/tokens`:** se retiró el controller huérfano. La entidad y `cleanupExpiredTokens` se quedan, porque la tabla la crea `InitialSchema`.
- **`PATCH /cameras/:id/zones`:**
  - DTO `UpdateGuardianZonesDto`: hasta 20 zonas de 3 a 100 puntos `{x,y}` finitos, recortados a [0,1].
  - El id debe ser un UUID; si no, 400.

**Gate y harness:** solo usan Postgres en loopback, salvo con `VIGILIA_ALLOW_REMOTE_TEST_DB=true`. `gate-db.cjs` sale con 4 y el gate lo marca FAIL.

**Frontend**
- `vercel.json` con `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` + `frame-ancestors 'none'` y `Permissions-Policy` (micrófono y cámara solo del propio origen).
- Se eliminaron `RegisterView` y `AuthAPI.createAccount` (el registro público no existe) y `getCameraRecentEventsCount`.

**LPR:** `LPR_MAX_WORKERS` se declara en `settings.py`, porque `Settings` rechaza las variables extra y documentarla sin declararla impedía arrancar.

**Hub**
- `install.sh` con `npm ci` + `prune`, copia de archivos ocultos, `.env` 600 y unidad systemd endurecida (`ProtectSystem=strict`, `ReadWritePaths`), sin `PrivateDevices`.
- `health-check.sh` y la documentación (`DEPLOYMENT`, `INSTALLATION`, `README`, `QUICK_REFERENCE`) usan el modelo de secret por hub. La prueba de conectividad usa `GET /concierge/device`.

## 3. Máquina de estados de `Visit` (objetivo)

```
             notifyResident              approve + checkIn (mismo evento que abre)
 (nueva) ───────────────────► AWAITING_APPROVAL ─────────────────────────────► PENDING ──► ACTIVE
                                    ├── deny ────────────────────────► DENIED (terminal)
                                    └── TTL vencido / fin de sesión ─► EXPIRED (terminal)
 create (residente/admin) ─► PENDING ──checkIn (LPR/QR)──► ACTIVE ──checkOut──► READY_FOR_REENTRY | COMPLETED
                                                            (no hay checkOut durante la espera post-ingreso)
```

- **LPR acepta:** `PENDING`, `ACTIVE`, `READY_FOR_REENTRY`. Si encuentra una visita `ACTIVE` dentro de la espera posterior al ingreso, no hace nada: ni checkOut ni apertura.
- **QR válido:** los mismos estados, dentro de la ventana de validez. Una solicitud `AWAITING_APPROVAL` no tiene QR; se genera al aprobar.
- **`checkIn` desde:** `PENDING` o `READY_FOR_REENTRY`.
- **Edición (PATCH):** solo en `PENDING` o `READY_FOR_REENTRY`, con un patch explícito que nunca reescribe `status` ni `usedCount`.
- **Cancelación:** solo desde `PENDING`.

## 4. Fases

P0 preparación (hecha) · P1 red de tests · P2 base de producción · P3 estados de visitas y LPR fail-closed · P4 `/respond`, kiosko, canales y throttling · P5 roles y aislamiento · P6 realtime, MediaMTX y hub · P7 privacidad y retención · P8 CI y e2e · P9 gate (los e2e solo se ejecutan aquí) · P10 commits y PR.

**Metodología:**
1. Cada fase la implementa un agente especializado.
2. Nova revisa el diff con apoyo de `cybersecurity-engineer` y `quality-gate-reviewer`.
3. Cada fase incluye tests unitarios: se ajustan los existentes y se crean los nuevos.
4. No se avanza sin unit, typecheck y build en verde.

## 5. Fuera de alcance (follow-ups)

- Unificar `/respond` con `PendingAction`, con UI.
- Asociar kiosko y portón, y emparejamiento con código de un solo uso.
- Keys del LPR por cámara.
- Deuda de lint (~900 `no-unsafe`, 138 `any`).
- E2E con Playwright y auth real.
- Revocar sockets al hacer logout.
- TLS y TURN para WebRTC.
- Revisión legal completa de la Ley 21.719.
- Respaldos, observabilidad y gestor de secretos.

## 6. Base de datos y despliegue

**El esquema lo crean las migraciones.** La migración base `backend/src/migrations/1791472216949-InitialSchema.ts` crea, sobre una BD vacía:
1. La extensión `pgcrypto`.
2. Las tablas de TypeORM.
3. Las tablas de better-auth, con el SQL generado por su CLI (`auth@1.6.23`).

Las 8 migraciones viejas viven en `migrations/legacy/` y no se ejecutan (ver su `README.md`). Las opciones de TypeORM salen de una sola fuente, `src/database/typeorm-options.ts`, que comparten la app y el CLI.

| Script (`backend/`) | Uso |
|---|---|
| `npm run migration:run` | Aplica las migraciones pendientes (ts-node, desde `src/`). |
| `npm run migration:run:prod` | Igual, pero desde `dist/`: sirve tras `npm run build`, sin devDependencies. |
| `npm run migration:show` | Lista las migraciones y cuáles están aplicadas. |
| `npm run migration:revert` | Revierte la última migración. ⚠️ Sobre `InitialSchema` **borra todo el esquema** (todas las tablas y sus datos, incluidas las de better-auth): nunca en un ambiente con datos. |
| `npm run migration:generate -- src/migrations/<Nombre>` | Genera una migración incremental desde las entidades. |
| `npm run migration:check` | Falla (exit 1) si las entidades y la BD difieren. Va en CI (P8). |

**Despliegue:** `npm ci` → `npm run build` → `npm run migration:run:prod` → `npm run start:prod`, siempre con **`NODE_ENV=production`** (activa las cookies `secure`, exige `https://` en `BETTER_AUTH_URL` y `FRONTEND_URL`, y prohíbe `DB_SYNCHRONIZE=true`; sin él, el backend corre con los defaults de desarrollo). La app **no** migra sola al arrancar (`migrationsRun: false`). Al arrancar, `DataInitializationService` siembra los roles y permisos.

**`DB_SYNCHRONIZE`:** solo para prototipos o BD desechables (`DB_SYNCHRONIZE=true`). Por defecto está apagado. Con `NODE_ENV=production`, el backend se niega a arrancar si está activo.

**Configuración:** el backend valida el `.env` al arrancar (`src/config/env.validation.ts`). Falla si:
- falta alguna variable `DB_*`, `BETTER_AUTH_SECRET`, `CAMERAS_ENCRYPTION_KEY` o `FRONTEND_URL`;
- un secreto conserva un valor de ejemplo;
- `BETTER_AUTH_SECRET` tiene menos de 32 caracteres;
- `CAMERAS_ENCRYPTION_KEY` no es base64 de 32 bytes;
- `WORKER_MANAGER_URL` está definida y `WORKER_MANAGER_SECRET` falta, o este tiene menos de 32 caracteres o un valor de ejemplo. El LPR (`lpr/settings.py`) aplica la misma regla y no arranca con un secreto débil.

Los mensajes nombran la variable, nunca su valor. `TRUST_PROXY` es opcional y acepta solo un **número exacto de saltos de proxy** (entero ≥0), o `false`/vacío si no hay proxy. `true` se rechaza porque haría que Express confíe en el `X-Forwarded-For` que envía el cliente, y un número mayor al real también permite falsificar la IP; better-auth toma la IP del cliente de `req.ip` (respeta `TRUST_PROXY`) vía el header `x-client-ip`, y descarta los headers de IP que manda el cliente.

**Credenciales:** la contraseña vive solo en la cuenta `credential` de better-auth (`account.password`); `user` ya no tiene columna `password`. `/auth/check-password` y `/auth/update-password` usan `auth.api.verifyPassword` y `auth.api.changePassword` (este último cierra las demás sesiones y renueva la cookie de la actual).

**Recrear la BD de desarrollo** (no hay datos que conservar). Desde la raíz del repo, con el contenedor `vigilia_postgres` arriba:
1. Completa `backend/.env` según `backend/.env.example`: `BETTER_AUTH_SECRET` y `CAMERAS_ENCRYPTION_KEY` reales (`openssl rand -base64 32`), `NODE_ENV` y `DB_SYNCHRONIZE=false`. Borra `JWT_SECRET` y `JWT_EXPIRATION`, que ya no se usan.
2. Borra y crea la BD (`<DB_USER>` y `<DB_NAME>` son los de tu `.env`):
   ```bash
   docker exec vigilia_postgres psql -U <DB_USER> -d postgres -c "DROP DATABASE IF EXISTS \"<DB_NAME>\" WITH (FORCE)" -c "CREATE DATABASE \"<DB_NAME>\""
   ```
3. `npm --prefix backend run migration:run`, y luego `npm --prefix backend run migration:check` para confirmar que no hay drift.
4. `npm --prefix backend run start:dev`. El arranque siembra los 6 roles y los 82 permisos, incluido `platform.manage-hubs`.
5. **Crea el primer Super Administrador.** Es el único dato que se siembra a mano: el registro está deshabilitado y `POST /users` exige un admin.
   - Opción rápida: `node backend/scripts/seed-admin.js <email> <password>` (lee la BD de `backend/.env`; crea el usuario, el rol y su cuenta `credential` de better-auth).
   - Opción manual: inserta la fila en `user` con `emailVerified = true`, asígnale el rol "Super Administrador" en `user_roles_role` y define su contraseña con "Olvidé mi contraseña" (`POST /api/v1/auth/forgot-password`, requiere SMTP).
   - Desde ahí, todo se crea por la app: condominio (`POST /onboarding/condominiums`), administradores y residentes.
6. **Credencial del LPR:**
   - Inicia sesión con un admin **que pertenezca al condominio** (o un super-admin con `targetUserId` de un usuario del condominio). Sin condominio, la emisión responde 400.
   - Emite la key con `POST /api/v1/auth/service-api-keys`. Solo el backend emite keys: los endpoints de cliente `/api/auth/api-key/*` responden 404.
   - La key queda vinculada a su condominio en `permissions` (server-only), sin límite de requests por key (`rateLimitEnabled: false`). Deja de servir (403) si su dueño sale del condominio o se deshabilita.
   - La ingesta solo acepta datos de ese condominio: en `/detections/plates` y `/anomalies` una cámara ajena o inexistente responde 403, y en `/detections/plates/attempts` una detección ajena responde 404, sin registrar nada ni abrir el portón.
   - Pégala como `LPR_SERVICE_API_KEY` en `lpr/.env`.
   - Configura `WORKER_BACKEND_URL` con el prefijo `/api/v1`, y el mismo `WORKER_MANAGER_SECRET` (≥ 32 caracteres) en `backend/.env` y `lpr/.env`.
   - Borra `WORKER_BACKEND_TOKEN` y `LPR_WORKER_TOKEN`, o el LPR no arranca.

## 7. Registro de avance

| Fase | Estado | Notas |
|---|---|---|
| P0 | 🟢 | Cloudinary rotado; Fase 3 mergeada (PR #56). El índice de git ya está en LF (0 archivos CRLF), así que no hace falta un PR de normalización: `.gitattributes` y `.editorconfig` entran en la P1. |
| P1 | 🟢 | **Backend:** 32/32 suites, 260 tests; antes había 13 suites y 67 tests rojos. Se agregaron los scripts `typecheck` (incluye specs) y `lint:check` (sin `--fix`), y el helper `src/test-utils/mock-repository.ts`. **Hub:** 58/58; el mock pasó de `onoff` a `gpio-wrapper`. **Frontend:** Vitest 5 + jsdom + Testing Library, con el helper `@/test/renderWithProviders`. Vitest no usa globals (se importa todo desde `'vitest'`), y `restoreMocks: true` solo restaura spies. QA: aprobado con observaciones. `findByIds` del mock pasa a P2; scripts de gate y cobertura mínima pasan a P8. |
| P2 | 🟢 | **Cerrada:** backend 41/41 suites (429 tests), lpr 47, hub 58, Vitest 7. Mini-ronda final: revocación de service keys (`POST /auth/service-api-keys/:id/revoke`, sin `'never'`), `revokeSessionsOnPasswordReset`, `TRUST_PROXY` solo como saltos y `@types/pg` (deja `better-auth.ts` limpio en eslint). Implementada y verificada: migración base `InitialSchema` (TypeORM + better-auth + pgcrypto) con `migration:run`/`check` sin drift sobre una BD temporal; validación de env al arrancar; retiro completo del JWT legacy; `WorkersController` + LPR con `x-api-key`; `Logger` en vez de `console`; deps actualizadas (nodemailer 10). **Seguridad** rechazó la primera versión:<br>• **C1:** el plugin apiKey dejaba que cualquier sesión emitiera keys con un condominio arbitrario en `metadata`.<br>• **A1:** el cambio de contraseña no cambiaba la contraseña de login.<br>• **A2:** la ingesta no usaba la organización de la key.<br>• M1–M4.<br>Cerrados en la ronda de correcciones: rutas de cliente con `disabledPaths`, vínculo con el condominio vía `permissions` (server-only), keys del LPR con `rateLimitEnabled:false` (decisión de Benjamin), `changePassword` con `revokeOtherSessions`, sin columna `user.password`, ingesta verificada contra la org de la key, IP real para el rate limit de better-auth, revalidación de membresía y `WORKER_MANAGER_SECRET`. Re-revisión: aprobado con observaciones. Mini-ronda en curso: revocar service keys (sin `'never'`), `revokeSessionsOnPasswordReset` y `TRUST_PROXY` solo como saltos. **Diferido:** `GET /anomalies` y `zones` entre condominios, unicidad de `vehicles.plate`/`units.identifier` por condominio y `POST /users` → P5; límite de intentos en `check-password`/`update-password` y auditoría de login → P4; PII en logs y niveles de log en producción → P7; `TokensController` huérfano y `AuthAPI.createAccount` → follow-up; audit restante (braces/js-yaml, no alcanzables en runtime) → follow-up. |
| P3 | 🟢 | **Cerrada:** backend 45/45 suites (786 tests), frontend 147, lpr 50, hub 58. Implementada con 3 rondas de revisión; QA y ciberseguridad aprobaron con observaciones, y ciberseguridad verificó con sondas que el bypass de contexto nulo quedó cerrado (`resolveWriteScope` antes de leer al anfitrión o la visita; error de BD en la membresía → 403; `organizationId` explícito no alcanzable desde HTTP; `respondToVisitor` exige el condominio de la sesión). **Cambio de comportamiento:** una visita creada por el super-admin queda en el condominio del anfitrión (antes sin organización, sin efecto). **Decisión revisada de Benjamin:** check-in al aprobar más `VISIT_EXIT_COOLDOWN_MINUTES`. **Adelantado de P5:** `scopeWhere` con `IsNull` (fail-closed). Última ronda:<br>• bypass de contexto nulo en `POST /visits` y edición;<br>• validez de 4 h para las visitas del conserje (`VISIT_CONCIERGE_VALIDITY_HOURS`);<br>• SMS sin bloquear la apertura y QR del SMS corregido;<br>• cooldown simétrico para READY y dedupe deslizante en el LPR;<br>• carrera de checkOut tratada como `Duplicado`;<br>• host deshabilitado null-safe;<br>• `Duplicado` fuera del SLA y en filtros;<br>• `console.log` del QR eliminado.<br>**Pasa a P4:**<br>• `/respond` con DTO `@IsBoolean` y `visitId` obligatorio (que el residente apruebe la visita que vio);<br>• hub, kiosko y `VisitorApprovalDialog` respetan `entryRegistered:false` (no decir "pase" sin apertura);<br>• residual bajo: el PATCH del super-admin acepta un anfitrión de otro condominio sin mover `organizationId` (exigir `host.family.organizationId === visit.organizationId`).<br>**Pasa a P5:**<br>• visitas del super-admin con anfitrión sin familia quedan sin organización y son legibles por humanos sin condominio (lo cubre "sin organización → vacío");<br>• `GET /cameras/:id/source` y update/remove de cámaras sin filtro de condominio (**prioridad**);<br>• residentes que ven o editan visitas de vecinos (filtro por familia, sin `qrCode` en listados);<br>• humanos sin organización con resultado vacío y `stampOrganizationId` estricto;<br>• conteos del dashboard por condominio;<br>• `vehicleType`/`accessLevel` como texto libre.<br>**Follow-up Fase 5:** dirección por cámara (entrada/salida). |
| P4 | 🟢 | **Cerrada (2026-10-08):** backend 61 suites / 1217 tests, frontend 29 archivos / 306 tests, hub 95 tests, typecheck y build en verde. Tres frentes: **P4.A** (backend + vigilia-hub), **P4.F** (frontend) y **P4.B** (backend). Ciberseguridad hizo 4 rondas y QA 3; las dos aprobaron el cierre con observaciones no bloqueantes.<br>**`/respond`:**<br>• solo sesión humana, autorizada como residente notificado o con `manage` del condominio;<br>• DTO `{approved, visitId}`;<br>• `respondedById/respondedAt` en el claim de la visita;<br>• 409 ante doble respuesta;<br>• `entryRegistered` = acceso efectivo, persistido en la sesión; `door_open` sale antes que `visitor:response`;<br>• cualquier error tras el claim → alerta + `false`.<br>**Dispositivos:**<br>• `Hub.type` propagado y `GET /concierge/device`;<br>• el dispositivo debe ser dueño de la sesión en `/status`, `/end` y `execute-tool`;<br>• `sendDoorOpen` solo a hubs físicos y `visitor:response` solo al dueño, sin caída al condominio;<br>• auth de `/hub` en un middleware antes del CONNECT; 401 genérico;<br>• caché de credenciales verificadas y límite de fallos (3 en vuelo por IP, semáforo global, IPv6 /64);<br>• los handlers `hub:*` usan la identidad del handshake; last-wins;<br>• vigilia-hub reconecta con backoff.<br>**Kiosko:**<br>• emparejamiento en runtime (sin `VITE_KIOSK_*`) y socket `/hub` con polling de respaldo;<br>• mensajes fail-closed;<br>• esperas acotadas: 3 min (reiniciable con un reenvío), 30 s y `onClosed`;<br>• desemparejar con gesto + secret;<br>• 429 sin borrar la credencial.<br>**Canales (D8):**<br>• `AuthorizedContext.channel` y `allowedChannels` obligatorio: el kiosko sin `abrir_acceso`; `consultar_*` solo humanos con `manage`;<br>• prompt de Sofía por canal, con la rama "acceso no abierto";<br>• salidas mínimas para dispositivos;<br>• acciones pendientes revalidan canal y antigüedad (15 min).<br>**Throttling (D9):** `@RateLimit` en 18 rutas, un throttler `default`, sin `APP_GUARD`.<br>**better-auth:**<br>• **lista blanca HTTP** (plugin `onRequest`): solo `sign-in/email`, `sign-out`, `GET reset-password/:token` y `GET verify-email`; el resto, incluido `/organization/*`, responde 404;<br>• escape HTML en los emails;<br>• auditoría de LOGIN/LOGIN_FAILED/LOGOUT/PASSWORD_CHANGE: sin contraseña y legible solo por el super-admin.<br>**Migración:** `1791498985330-ConciergeResponseTracking`.<br>**Pasa a P5:**<br>• membresía actual del residente notificado (`isActiveMemberOfOrganization`, con D11);<br>• scope por condominio de la auditoría.<br>**Pasa a P6:**<br>• saneo del contenido de `/concierge/context`;<br>• renovar el caché de credenciales con el heartbeat WS y subir su edad máxima (hoy el hub inactivo >10 min vuelve a la ruta fría);<br>• enmascarar el `hubId` en la pantalla del kiosko.<br>**Pasa a P7:** retención de la auditoría.<br>**Despliegue:**<br>• caché y limitador en memoria: una sola instancia, y los cambios a `hubs` siempre vía `HubsService`;<br>• `TRUST_PROXY` exacto.<br>**Operación (Benjamin):** rotar el secret del kiosko que estuvo en el bundle y emparejarlo de nuevo. |
| P5 | 🟢 | **Cerrada (2026-10-09):** backend 80 suites / 1728 tests, frontend 51 archivos / 457 tests, hub 8 suites / 99, lpr 53; typecheck y build en verde. Tres frentes: **P5.A** (roles, usuarios, membresías, auditoría y logs), **P5.B** (aislamiento de recursos) y **P5.C** (sin condominio → vacío, creación estricta, alcance por familia y modelo de vehículos). Ciberseguridad hizo 3 rondas y QA 2, con sondas contra Postgres real (13 actores, 2 condominios); las dos aprobaron el cierre.<br>**Migraciones:** `AuditLogOrganization`, `PerOrganizationUniqueness` (`NULLS NOT DISTINCT`) y `VehicleAccessModel` (solo datos).<br>**Roles:**<br>• roles de sistema inmutables y sincronizados desde el código;<br>• solo el super-admin muta roles y permisos;<br>• `RoleAssignmentPolicy` (sin Super Administrador ni `platform.*`, subconjunto, sin tocar los roles propios, mismo condominio);<br>• **jerarquía en toda escritura sobre otro usuario** (sus permisos deben ser un subconjunto de los del actor);<br>• solo el super-admin cambia el email de otro usuario;<br>• el Administrador puede asignar Conserje (recibe `detections.*`).<br>**Membresías:** se crean al crear el usuario (con compensación); `POST /users` retirado; backfill idempotente y aviso al arrancar.<br>**Aislamiento:**<br>• cámaras (`source` exige `cameras.update`; `CameraViewGuard` compara el condominio; WHEP usa el mount autorizado);<br>• detecciones (claim atómico en `respond`), anomalías (`GET` humano, `zones` con key) y unidades (guard + permisos reales);<br>• vehículos, notificaciones (sin IDOR), familias, dashboard, auditoría (`organizationId`) y logs (solo super-admin);<br>• usuarios acotados por condominio y proyectados `{id, name}` sin `users.update`, también los embebidos y el dueño del vehículo en las visitas;<br>• sin condominio → vacío; creación estricta (`organizationId` solo del super-admin).<br>**Alcance por familia:** `condominium.view-all` (Administrador, Conserje, Seguridad, Desarrollador) en reemplazo de `UserFilterInterceptor`; el Residente solo ve lo de su familia; `qrCode` solo para la familia del anfitrión.<br>**Portón:**<br>• `accessLevel` decide (`residente` abre; `visitante` exige visita; `servicio`/null escalan);<br>• solo abre con dueño miembro activo, y en las visitas con anfitrión activo;<br>• decisión de Benjamin: el vehículo que registra un residente abre de inmediato;<br>• la familia no reactiva, no sube el nivel, no cambia la patente ni borra un vehículo inactivo.<br>**Hub:** `X-Hub-Id` en la caché de IA (hacía falta desde la Fase 1); `digitalConciergeEnabled` asignable (`PATCH /families` + interruptor).<br>**Frontend:**<br>• super-admin por un helper único; `CondominiumSelect` en las creaciones;<br>• roles y usuarios según los permisos (solo roles asignables; email de otro, solo lectura);<br>• vehículos con los enums nuevos y la patente de solo lectura para la familia;<br>• QR solo si llega; manejo de 409 y 403.<br>**Follow-ups:**<br>• `vehicle.ownerId` del vecino (UUID opaco) en `GET /visits` y `/visits/plate`;<br>• para revocar un vehículo hay que **desactivarlo**: si solo se baja el nivel, la familia puede borrarlo y recrearlo;<br>• en la UI, el Residente solo se elige a sí mismo como anfitrión;<br>• `DELETE /users` es un borrado definitivo (P7, anonimización);<br>• anomalías por WebSocket a todos los condominios (P6);<br>• el Residente no ve el email de los miembros de su propia familia (conservador).<br>**Operación (Benjamin):**<br>• correr `node backend/scripts/backfill-memberships.js` (dry-run y luego `--apply`);<br>• asociar cada hub a su condominio;<br>• revisar por condominio los vehículos `residente` antes de activar el LPR (ahora abren solos con dueño activo). |
| P6 | 🟢 | **Cerrada (2026-10-09):** backend 92 suites / 2020 tests, hub 11 / 169 (el build genera `dist/main.js`), frontend 57 / 543, lpr 53; typecheck y build en verde. Tres frentes: **P6.R** (tiempo real), **P6.M** (MediaMTX, contexto y hub) y **P6.F** (frontend). Ciberseguridad hizo 2 rondas y QA 1, con sondas reales sobre socket.io, better-auth, Postgres y el binario de MediaMTX v1.15.2. La última ronda de ciberseguridad quedó **APROBADA**.<br>**Tiempo real:**<br>• `VigiliaIoAdapter` con lista de orígenes; namespace `/` autenticado por cookie en el handshake;<br>• salas del servidor `user:`/`session:`/`org:<id>:security`, sin `register`/`join_room`/broadcast;<br>• `session:ended` y corte de sockets al hacer logout, expirar, revocar, deshabilitar o borrar el usuario (hook de better-auth, timer y revalidación cada ≤5 min);<br>• `security:anomaly_highlight` sin imagen solo al condominio + `GET /anomalies/:id`; el socket no extiende la sesión;<br>• caché del hub con `touch` en el heartbeat y 24 h.<br>**MediaMTX:**<br>• `authMethod: http` para lectura **y para la API de control** (cerraba un CSRF/DNS rebinding que permitía `runOnInit`, es decir, ejecutar comandos en el host); `authHTTPExclude` vacío;<br>• guard de origen (IPs permitidas, sin headers de proxy); WHEP y API con Basic; rtsp/rtmp/hls/srt apagados; WebRTC y API en loopback; `paths: {}`;<br>• `sourceUrl` solo `rtsp(s)`; health protegido; redacción también de las URLs que MediaMTX repite en sus errores;<br>• **resincronización automática** de cámaras al arrancar y cuando vuelve MediaMTX, y re-registro al fallar el WHEP.<br>**Contexto de la casa:**<br>• `{ expectedVisitors }` saneado ("Nombre I.", ≤20+inicial, máx 5, sin frecuentes ni frases de autoridad), inyectado como `user` delimitado; regla en el prompt;<br>• `visitorName` con `MaxLength(128)` y `.max()` en `guardar_datos_visitante`;<br>• **casa por calce exacto** (código, o número de unidad si es único; si es ambiguo, solo los códigos y Sofía pregunta): se cerró el caso viejo de "10" → "101" (familia equivocada).<br>**Usuarios:** un deshabilitado no obtiene sesión (mismo error que credenciales malas, auditado); `disable`/`DELETE` cortan sesiones al instante; `enable` invalida las previas.<br>**vigilia-hub:** config central (en producción exige https/wss y `HUB_ID`/`HUB_SECRET`, sin `DEBUG_OPENAI_KEY`); logs redactados (en `info` solo metadatos); build corregido; guía de TLS en la LAN.<br>**Frontend:** socket único `RealtimeConnection` con revalidación y sin bucles; alertas por permiso (sin super-admin) con foto por HTTP; huérfanos eliminados; `hubId` enmascarado; docs actualizadas.<br>**`rtsp-simple-server/`:** endurecido y marcado como legacy (solo desarrollo).<br>**Pasa a P7 (privacidad):**<br>• Sofía dice "le envié una notificación a [nombre del residente]" (permite armar la relación nombre-casa);<br>• una `sourceUrl` con `"`/`<`/`>` deja la cola de la clave en el log (rechazar esos caracteres en el DTO).<br>**Pasa a P9 (validar):** el saludo inicial con el contexto como mensaje `user`.<br>**Restricción:** una sola instancia (salas, timers, caché y limitador en memoria).<br>**Pasos operativos:**<br>• `MEDIAMTX_AUTH_SECRET` (≥32) en `backend/.env` (y `MEDIAMTX_AUTH_ALLOWED_IPS` si MediaMTX está en otro host);<br>• reiniciar el backend y luego MediaMTX con el yml nuevo (el re-registro de cámaras ya es automático);<br>• UDP 8189 abierto y 8554/1935/8888/8890 cerrados;<br>• el reverse proxy no expone `/api/v1/internal/` y `TRUST_PROXY=1`;<br>• hub en producción con https (guía de TLS en `vigilia-hub/DEPLOYMENT.md`), `HUB_ID`/`HUB_SECRET` y sin `DEBUG_OPENAI_KEY`; desplegar hub y backend juntos. |
| P7 | 🟢 | **Cerrada (2026-10-09):** backend 116 suites / 2491 tests, hub 12 / 172, frontend 67 / 621, lpr 53; typecheck y build en verde. Tres frentes: **P7.R** (retención y derechos), **P7.L** (logs, redacción y prompt) y **P7.F** (frontend). Diseño y base legal en [privacidad-ley-21719.md](privacidad-ley-21719.md), con deep research de la Ley 21.719 (fuentes primarias). Ciberseguridad hizo 3 rondas y QA 3, con sondas reales sobre Postgres y HTTP; las dos aprobaron el cierre.<br>**Retención:**<br>• `RetentionService` (3:30 Chile, lotes, advisory lock, dry-run, idempotente con `anonymizedAt`): imágenes 30 d; datos de visitas, sesiones, registros de acceso, anomalías, notificaciones y acciones pendientes 90 d; auditoría 365 d; logs 30 d; usuarios deshabilitados 30 d;<br>• la visita anonimizada suelta su vehículo y se borran los vehículos de visitante huérfanos;<br>• la limpieza técnica corre siempre;<br>• cierre automático de visitas ACTIVE vencidas (`VISIT_ACTIVE_GRACE_HOURS`) y de sesiones abandonadas (>1 h);<br>• script `retention-run.js` (dry-run por defecto) y runbook `backend/src/privacy/README.md`;<br>• **test de arranque** que exige los 9 crons registrados (un `@Cron` en un provider request-scoped se perdía en silencio).<br>**Derechos:** `GET /auth/me/data-export`; `POST /privacy/erasure` (`privacy.manage`, por RUT, patente o usuario, acotado al condominio; las cuentas de personal solo las suprime el super-admin; sin Cloudinary dentro del request).<br>**Minimización:**<br>• logs sin datos personales; `LOG_LEVEL` (`log` en producción);<br>• auditoría, `auditToolCall` y `pending_actions` redactados, con regex acotadas y recorte a 2 KB: se cerró un **ReDoS que tumbaba el backend**, introducido por la propia P7;<br>• email de LOGIN_FAILED enmascarado con HMAC;<br>• el contexto de la casa envía a OpenAI solo la cantidad de visitas;<br>• el QR por "SMS" queda apagado (`VISITOR_QR_SMS_ENABLED`);<br>• Cloudinary borra solo en el cloud y la carpeta propios.<br>**Transparencia:**<br>• Sofía se presenta como IA, explica para qué pide cada dato y nunca nombra a los residentes; los dispositivos no reciben nombres;<br>• aviso del kiosko antes del micrófono;<br>• política pública según el art. 14 ter (encargados reales, plazos, derechos, Agencia);<br>• landing sin afirmaciones falsas.<br>**Seguridad extra:**<br>• límite de body de **100 kb** (10 MB solo en la ingesta con API key): cerraba un DoS sin sesión, preexistente, por class-transformer cuadrático;<br>• `execute-tool` exige `digital-concierge.access` a los humanos y tiene un tope de 8 KB / 4 niveles.<br>**Residuales documentados:**<br>• el nombre en `access_attempts.reason` solo se limpia por patente o a los 90 d;<br>• los vehículos de residentes se borran solo al anonimizar la cuenta;<br>• los frames del LPR subidos antes sin carpeta quedan como foráneos;<br>• audio pregrabado del aviso de IA en el hub (follow-up);<br>• revisión legal de los textos y DPA de OpenAI/SMTP/Cloudinary.<br>**Operación (Benjamin):**<br>• cartel de cámaras y LPR en el acceso (texto en el doc de privacidad);<br>• `VITE_PRIVACY_CONTROLLER_NAME` y `VITE_PRIVACY_CONTACT_EMAIL`;<br>• correr `retention-run.js` en dry-run antes del primer `--apply`;<br>• vaciar la BD de desarrollo antes del piloto (hay auditoría vieja con datos personales). |
| P8 | 🟢 | **Cerrada (2026-10-09):** backend 126 suites / 2577 tests, con umbrales de cobertura en trinquete (79/71/77/79; medido 81,97/73,54/79,04/81,73); hub 13 / 176, con umbral (50/46/46/51); frontend 67 / 621; lpr 53 (`requirements-ci.txt` verificado en un venv de Python 3.12).<br>**E2E de caja negra** (`backend/test/e2e/`): 32 casos con la app compilada, better-auth real, Postgres real (una BD `vigilia_e2e_*` por corrida), OpenAI y SMTP falsos (`OPENAI_API_BASE_URL`) y datos creados por endpoints. Áreas: LPR con AWAITING, `/respond` (401/403/409/200), aislamiento y escalada, `source` de cámaras, lista blanca de better-auth, 413 y socket sin sesión. **Compilan, pero no se ejecutaron (se corren en P9).**<br>**CI** (`.github/workflows/ci.yml`):<br>• bloqueantes: backend con Postgres 15 (typecheck, build, unit, migraciones con chequeo de drift, e2e y logs como artefacto si fallan), hub, frontend y lpr;<br>• no bloqueantes: lint y `npm audit`.<br>**Plataforma:**<br>• `.nvmrc` = 22 y `engines >=22.12` en los tres proyectos npm;<br>• `pigpio` es dependencia opcional, pero la instalación aborta si falla en una Pi real;<br>• **hub en Raspberry Pi OS 64-bit + Node 22 LTS** (Node 18 está EOL; decisión de Nova).<br>**`scripts/gate.sh`:** gate local (`--with-e2e`, `--require-db`). El warning de *open handles* no se reprodujo; quedan timers con `unref` como prevención.<br>**Para P10:** `frontend/src/test/`, `.github/`, `scripts/` y `.nvmrc` son nuevos y no están versionados, y `scripts/gate.sh` necesita el bit ejecutable.<br>**Operación (Benjamin):** si la Raspberry del piloto tiene un SO de 32 bits, reinstalar Raspberry Pi OS 64-bit (Bookworm). |
| P9 | 🟢 | **Gate cerrado (2026-10-09):** `bash scripts/gate.sh --with-e2e --require-db` dio **12 OK / 0 FAIL / 0 SKIP**:<br>• backend: typecheck, build y unit, 130 suites / 2823 tests; cobertura 82,6/74,1/80,0/82,4 sobre umbrales 79/71/77/79;<br>• migraciones: `migration:run` y `migration:check` sin drift sobre una BD temporal;<br>• **e2e de caja negra:** 5 suites / 36 tests;<br>• hub: 13 / 176 con umbral; frontend: 68 / 627 + build; lpr: 53.<br>**E2E:** primera ejecución real con 33 de 33 casos verdes, dos veces seguidas. El único fallo fue `jest-e2e.json` con escapes inválidos, causado por un heredoc. Se agregó un control positivo a la política de roles (Conserje 200 → Super Administrador 403).<br>**Revisión final:**<br>• ciberseguridad: **APROBADO CON OBSERVACIONES**, sin críticos ni altos en el código; revisó la superficie de la P8, los 3 emisores de `sendDoorOpen`, el aislamiento y los secretos en los 669 archivos;<br>• QA: el único bloqueante era el JSON; contratos frontend↔backend, migraciones y e2e verificados.<br>**Ronda P9.H:** body de 10 MB solo con una key verificada, `HOST`, Swagger, cookies seguras con https, `/tokens` retirado, DTO de zonas, candado de BD loopback, headers en `vercel.json`, código muerto del frontend, `install.sh`/systemd, docs del hub y `LPR_MAX_WORKERS` en `settings.py`. Contratos en §2, "Detalle de la P9".<br>**Smoke manual:** guía en [smoke-pre-piloto.md](smoke-pre-piloto.md), a cargo de Benjamin. Punto a observar: el kiosko no envía un disparador para que Sofía salude primero (preexistente).<br>**Follow-ups:**<br>• acotar las coordenadas en el editor de zonas;<br>• quitar los permisos `tokens.*` del catálogo;<br>• tope de bytes al descartar un body con una key inválida;<br>• `dependabot.yml` para actions.<br>**Hardware (Benjamin):**<br>• GPIO 22 lo usan por defecto el hangup (`HANGUP_GPIO`) y el relé de puerta (`RELAY_DOOR_PIN`), algo que viene de antes; `PIN_MAPPING.md` lo reserva para la puerta;<br>• verificar si `pigpio` exige root con `User=pi`; si lo exige, el portón queda simulado.<br>**Operación (Benjamin), antes del merge:**<br>• ruleset en `main` (PR obligatorio y los 4 jobs) y secret scanning con push protection;<br>• borrar `VITE_KIOSK_*` en Vercel y rotar el secret del kiosko, porque Vercel despliega `main`;<br>• `VITE_PRIVACY_*` en Vercel;<br>• en el servidor, `NODE_ENV=production` y el puerto 3000 accesible solo desde el proxy (o `HOST=127.0.0.1`). |
