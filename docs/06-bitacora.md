# 06 — Bitácora

Registro cronológico de conversaciones, decisiones y avances. Lo más reciente arriba.

---

## 2026-10-21 (tarde) — Voto de patente por vehículo y hallazgo nocturno

**Problema en vivo**
- Un mismo vehículo (un solo id de ByteTrack) generó **dos emisiones con 9 s de diferencia**, con textos que diferían en el último carácter. La pista de la patente se cerraba tras 1,5 s sin verla y la lectura siguiente abría otra que emitía sola; el dedupe por texto no lo cubría.

**Hecho** (decisión [D9](05-decisiones-tecnicas.md#d9--voto-de-patente-por-vehículo-y-seguimiento-robusto--implementado-2026-10-21))
- **Worker:** voto por vehículo (una pista por id canónico; vehículo consumido tras emitir, con WARNING si cambia el ganador), seguimiento de vehículos siempre activo, yaml propio de ByteTrack con `track_buffer` en segundos × fps, reenganche de ids con guardas, tolerancia del 10 % en la asociación patente → vehículo, espera de asentamiento de 1 s y `meta.track` con `vehicle_uid`, `vehicle_ids` y `settled`. Variables nuevas: `LPR_VEHICLE_LOST_SECONDS`, `LPR_VEHICLE_RELINK_SECONDS`, `LPR_VOTE_SETTLE_SECONDS` y `LPR_VOTE_FREEZE_AFTER_SETTLE`.
- **Replay (8 pasadas del portón):** dejar votar todas las lecturas daba 1 patente incorrecta (el OCR se sesga cuando el auto está más cerca); congelar el texto tras el asentamiento, ahora el defecto, deja 8/8, 0 incorrectas, 0 duplicados y un solo id por pasada. El barrido de umbrales de ByteTrack no mejoró nada y una configuración regresó: se quedan los defaults.
- **Tests:** 521 en `lpr/tests`, con mutaciones sobre las reglas nuevas.

**Hallazgo nocturno (23:15)**
- **Dos autos no se leyeron.** En el **Portón**, los focos tapan la patente de frente. En **Estacionamiento 03**, la patente trasera sale barrida o lavada por la exposición nocturna.
- **Palanca:** obturación máxima corta y **HLC** (compensación de luces altas) en la cámara. El NVR expone HLC y WDR, pero no el obturador.
- **Pendiente:** visto bueno de la administración para tocar la configuración de las cámaras.

**Próximo paso:** validar D9 con los clips nocturnos y de Estacionamiento 03 que se están grabando.

---

## 2026-10-21 — Dirección por trayectoria del vehículo y pasadas multicámara

**Stack local con cámaras reales**
- Se levantó el stack completo en local (backend, frontend, manager y workers LPR) contra las cámaras del condominio, por el relay de la Pi (D6), con Cloudinary para los frames de evidencia.
- **Imágenes de trazabilidad:** el detalle de un intento no mostraba la evidencia. Se corrigió para mostrar el frame de Cloudinary o, si no hay, el recorte de la patente (PR #60, mergeado).

**Hallazgos**
- **La dirección por ancho de la patente es débil:** 5/8 en el portón y el resto `unknown` (D7). Falla con autos que pasan de lado o se detienen.
- **Doble apertura entre cámaras.** El dedupe vivía en la memoria de cada worker y el backend no tenía locks: dos cámaras que leían a un residente casi al mismo tiempo producían **dos `Permitido` y dos aperturas**.
- **Bug de la URL de cámara.** El campo enmascarado no se podía editar y el submit reenviaba la URL vieja. Aunque se cambiara por API, el manager respondía `already_running` y el worker seguía con la URL anterior.

**Decisiones de Benjamin**
- **Dirección robusta con ByteTrack**, siguiendo el vehículo y no la patente, con una línea de cruce dibujada por cámara.
- **Dedupe multicámara obligatorio**, para cualquier combinación de cámaras LPR presente o futura: cada auto es **una pasada**, con un intento y como máximo una apertura.
- **Estacionamiento 03 como cámara de salida**, reapuntada a su stream HD: solo registra, ve ambos sentidos y tiene línea de dirección con la flecha de salida hacia el portón. Para eso hacía falta arreglar la edición de la URL.

**Implementación** (plan E1–E10, decisión [D8](05-decisiones-tecnicas.md#d8--dirección-por-trayectoria-del-vehículo-y-pasadas-multicámara--implementado-2026-10-21-falta-gate-completo-y-pr))
- **Worker:**
  - `processor/vehicle_tracker.py` (ByteTrack con el `yolo11n.pt` local, sin descargas en runtime);
  - `utils/direction.py`, puro: cruce del segmento con márgenes anti-ruido y respaldos `motion` > `width` > `none`;
  - asociación patente → vehículo, espera de dirección de hasta 4 s, `meta.direction_source` y liberación de pendientes al detener;
  - `lapx==0.10.0` declarado y `replay_eval --direction-line`.
- **Backend:**
  - entidad `VehiclePassage` y su migración: advisory lock por (condominio, patente), índice único "un intento por pasada", token de liderazgo, promoción registro → acceso y pasadas huérfanas;
  - validación en el servidor de la fuente de la dirección;
  - `passage` en `GET /detections/plates/attempts`;
  - retención y supresión de pasadas;
  - relanzamiento del worker al cambiar `sourceUrl`.
- **Frontend:**
  - herramienta "Línea de dirección" en el `ZoneEditor`, con la flecha de salida y "Invertir sentido";
  - sección en "Configurar LPR";
  - trazabilidad con dirección, fuente y "Cámaras que vieron este paso";
  - fix de la URL en `CamerasPanel`.
- **Contrato nuevo** `contracts/direction-line.cases.json`, que fija la convención de `exitSide` y se prueba en el worker y el frontend.

**Resultados**
- **Harness sobre los 9 clips del portón** (8 pasadas, RTX 5060 Ti, 1920 / 8 fps / N=3, con zona y línea): patentes 8/8 y 0 incorrectas (sin cambio); **dirección 8/8, 0 equivocadas y 0 `unknown`** (antes 5/8 y 3 `unknown`): 6 por línea y 2 por movimiento. Costo de ~33–48 ms por cuadro en GPU con el tracker de vehículos (antes ~13–21) y latencia mediana de ~4.6 s (máximo 6.5 s). Detalle en [modulos/vision.md](modulos/vision.md#dirección-por-trayectoria-bytetrack--línea).
- **Concurrencia contra Postgres real:** 10 POST simultáneos de la misma patente → 1 pasada, 1 intento y 1 apertura. Una pasada huérfana con un líder lento → 1 apertura.

**Revisiones**
- **QA:** aprobado con observaciones, ya corregidas.
- **Ciberseguridad:** 0 críticos.
  - 1 ALTO: una cámara de solo registro absorbía la decisión del portón. Se corrigió con la **promoción** registro → acceso.
  - 1 MEDIO: una dirección fija de cámara podía partir una pasada. Ahora **solo `line`** la parte.
- **Nova** detectó una posible doble apertura en el guardado de la decisión, cuando un líder lento perdía la pasada. Se corrigió con el **token de liderazgo**.

**Pendientes**
- Gate completo con e2e, commits y PR (los dispara Benjamin).
- Configurar la línea en `porton-hd` y en Estacionamiento 03 desde la UI, y verificar end-to-end que una pasada vista por las dos cámaras queda como una sola.
- Deuda de D8: costo del tracker en CPU/RPi, transición de visitas ante un líder lento, reconciliación del manager, re-registro con `CAMERAS_STRICT_REGISTRATION` y supresión con la pasada abierta.

---

## 2026-10-20 — LPR sobre la cámara real del portón: de 0/8 a 8/8

**Prueba en terreno**
- El LPR corrió en vivo sobre `porton-hd` (1920x1080 HEVC, por el relay de la Pi) y **no leyó ninguna patente**.
- Se grabaron 9 clips por evento desde el preview, una tarde de día: ~870 s y 6 960 cuadros a 8 fps.
- Nova verificó a ojo la patente de cada pasada. Quedaron **8 pasadas legibles**, anonimizadas como P1…P8 en los docs, más 6 falsos positivos del detector y 1 ilegible.
- Benchmark de detección CPU vs GPU sobre capturas del mismo portón, en un Ryzen 5 7600X y una RTX 5060 Ti.

**Hallazgos**
- **Causa raíz del 0/8:**
  - la patente se ve inclinada ~20–25°, así que su caja es casi cuadrada (ratio mediana ~1.33), y el filtro `ratio ≥ 2.0` (hardcodeado) la botaba;
  - el detector corría a 640, porque `cli.py` no pasaba `imgsz`, y el worker a 1 fps;
  - `plausible_plate` aceptaba cualquier `[A-Z0-9]{3,8}`;
  - la confirmación contaba textos, no vehículos, y aceptaba una lectura suelta tras 5 s.
- **Configuración recomendada:** 1920, 8 fps, recorte de 60–250 px con ratio 0.8–6, formato chileno con corrección posicional, y seguimiento + voto con N=3 y `winner_share` ≥ 0.6. Con ella, el harness con el código final dio **8/8 correctas y 0 incorrectas**, con latencia mediana de 4.2–4.3 s (máximo 6.2 s) y 13–15 ms por cuadro en GPU. Con zona, igual 8/8 y ~12–13 ms.
- **Bajar N mete errores:** N=2 da 7/8 con 1 incorrecta y N=1 da 5/8 con 4 incorrectas. Los errores del OCR se repiten en cuadros casi idénticos.
- **La dirección inferida** acertó en 5/8. El resto quedó `unknown`, ninguna equivocada.
- **CPU vs GPU:** a cuadro completo y 1920, la CPU tarda 153 ms y la GPU 11.5 ms. Una ROI x1.66 @1280 baja a 73 ms en CPU y 12 ms en GPU. Sin GPU, la zona es obligatoria.
- **El límite es físico:** el OCR es confiable desde ~55–60 px de ancho de patente y la cámara entrega entre ~40 y ~94 px. Para abrir el portón hace falta una cámara dedicada (DS-2CD2643G2-IZS, ≥ 100–130 px de patente).
- **Limitación:** 8 pasadas, de día y con un solo ángulo. Por la regla del 3, 0 errores en 8 es compatible con una tasa real de hasta ~37 %. Antes del piloto falta muestra de noche, con motos y con lluvia.

**Decisiones de Benjamin**
- **`porton-hd` solo registra.** No abre el portón ni escala al conserje, porque mira desde adentro (D6). El modo vive por cámara (`action = register | access`) y lo aplica el backend.
- **Dirección por cámara** (`entry`, `exit` o `both`). Con `both`, el worker la infiere por la tendencia del ancho de la caja.
- **UI con lienzo.** La configuración LPR de cada cámara se edita en "Configurar LPR", con la zona de detección dibujada sobre el video en vivo. Reutiliza el editor de zonas del Guardián, ahora generalizado como `ZoneEditor`.

**Implementación** (plan D1–D11, decisión [D7](05-decisiones-tecnicas.md#d7--lpr-robusto-por-cámara--implementado-2026-10-20-falta-gate-completo-y-pr))
- **Worker:**
  - módulos puros `plate_format`, `plate_tracker` y `pipeline`, más `utils/zones` (compartido con el Guardián) y `utils/pii` (enmascarado en logs);
  - config por cámara por pull, con refetch en caliente y la zona fail-closed;
  - dedupe que solo se consume si el POST se aceptó o pudo haber llegado.
- **Backend:**
  - `Camera.lprSettings` jsonb y su migración;
  - endpoints `PATCH /cameras/:id/lpr-settings` y `GET /workers/cameras/:id/lpr-settings`;
  - rama `Registrado` fail-closed en `createDetection` y normalización de la patente en la ingesta.
- **Contrato compartido** de validación en `contracts/lpr-settings.cases.json`, probado en las tres capas.
- **Harness reproducible:** `lpr/tools/replay_eval.py`. Los datos quedan fuera del repo, en `lpr/eval-data/` (privacidad §7.2).
- **Detalle:** [modulos/vision.md](modulos/vision.md#evaluación-lpr-sobre-cámara-real-porton-hd).

**Pendientes**
- Revisión de ciberseguridad y QA, gate completo con e2e, commits y PR (los dispara Benjamin).
- Configurar `porton-hd` con la zona dibujada y verificar end-to-end que no haya `door-open`.
- Borrar los datos de evaluación al cerrar la calibración.

---

## 2026-10-16 — Fase 4 en GitHub, cámaras reales y relay de borde

**Fase 4 en GitHub**
- Gate completo en verde, con 12 de 12 pasos OK.
- Quedó en 9 commits, uno por subsistema, más un fix de un test del hub que dependía del reloj y fallaba en CI.
- Se abrió el **PR #57**, sin mergear. Su CI pasó completo.

**Cámaras reales**
- **Acceso:** Benjamin obtuvo acceso a las cámaras del condominio: un NVR Hikvision DS-7616NI-K2/16P con 11 cámaras. La administración no abrió puertos ni dio VPN.
- **Cobertura:** ninguna cámara mira hacia afuera del portón. Sin una cámara exterior, el LPR solo sirve para registrar entradas y salidas, no para abrir.

**Arquitectura** (D5 y D6 actualizadas)
- **Esquema híbrido:**
  - en la nube, lo liviano: backend, Postgres y el MediaMTX central, en el Hetzner CAX21 que Benjamin ya tiene;
  - en la conserjería, la inferencia.
- **Equipo edge recomendado:** un mini PC reacondicionado i5-12500T de ~CLP 400 mil, en vez de una Pi 5 con Hailo (que supera los CLP 460 mil). Se compra después del benchmark de la Fase 5.
- **Frigate:** se evaluará en ese mismo benchmark.
- **Dirección del proyecto:** kiosko en lugar del citófono, ESP32 con relés para la puerta y el portón, y la Raspberry Pi 3B solo como relay.

**Relay de cámaras**
- Kit nuevo en [`edge/camera-relay/`](../edge/camera-relay/README.md), versión 0.2.1, para la Raspberry Pi 3B:
  - MediaMTX v1.15.2 on-demand;
  - Tailscale con ACL por tags;
  - systemd endurecido (exposición 1.0) y salida de red limitada a la IP del NVR;
  - netwatch basado en `Self.Online`;
  - `apply` con lock y rollback;
  - ffprobe como usuario sin privilegios con `no-new-privs`;
  - SSH solo por clave y sudo con clave;
  - runbook de 3 fases.
- Verificación:
  - 301 tests;
  - contract test con el binario real, que incluye un fuzz inverso de 417 URLs;
  - E2E con un NVR falso, 16 de 16;
  - 50 mutaciones detectadas;
  - `install.sh` idempotente probado con systemd real.
- Revisión en 3 rondas:
  - ciberseguridad, APROBADO CON OBSERVACIONES;
  - QA rechazó la primera versión por un falso verde en la comparación de IPs y después lo dejó APROBADO CON OBSERVACIONES.
- Decisiones de Benjamin: **Tailscale** y la SD flasheada limpia.
- Diferido para la etapa del VPS: subir MediaMTX a la v1.21 o superior. Tiene avisos publicados que no son alcanzables con esta config.

**Privacidad:** se agregó la sección 7.1 al documento de la Ley 21.719, sobre el relay, Tailscale como encargado y los requisitos de un dataset de entrenamiento.

---

## 2026-10-08 → 2026-10-09 — Fase 4: hardening pre-piloto ✅ (código + gate)

**Metodología de Benjamin.** Todas las fases siguieron estos pasos:
1. Exploración con `codebase-explorer` y CodeGraph.
2. Plan en Plan Mode, con fases P0 a P10 y decisiones D1 a D16.
3. Cada fase delegada a agentes especializados.
4. Revisión de Nova con ciberseguridad y QA, por rondas hasta aprobar.
5. Tests unitarios por fase y e2e solo en el gate.

**Avance por fase:**
- **P1, red de tests:** 67 tests rojos reparados y Vitest en el frontend.
- **P2, base de producción:** migración base, validación de env y retiro del JWT legacy. El LPR pasó a `x-api-key`.
- **P3, máquina de estados de visitas:** nuevo estado `AWAITING_APPROVAL` y LPR que falla cerrado. Benjamin decidió hacer check-in al aprobar, con una espera de salida.
- **P4:** `/respond` solo con sesión humana, emparejamiento del kiosko en runtime, tools por canal, throttling y lista blanca HTTP de better-auth.
- **P5:** roles inmutables con `RoleAssignmentPolicy`, aislamiento por condominio y alcance por familia. Benjamin decidió que el vehículo de un residente abre de inmediato.
- **P6:** sockets autenticados con salas del servidor. MediaMTX ahora autentica contra el backend: cerraba un RCE local vía su API. Calce exacto de casa.
- **P7, privacidad (Ley 21.719):** retención y anonimización, derechos, aviso de IA y un ReDoS cerrado.
- **P8:** CI en GitHub Actions, e2e de caja negra y gate local.
- **P9:** gate completo en verde. Los e2e pasaron 33/33 a la primera; su único fallo fue el JSON de configuración. Revisión final de ciberseguridad y QA, más una ronda de higiene: límite de body con key verificada, `HOST`, Swagger, cookies, DTO de zonas, headers de Vercel e `install.sh` endurecido.

**Números finales:**
- backend: 130 suites / 2823 tests, cobertura 82,6/74,1/80,0/82,4;
- e2e: 36;
- hub: 176;
- frontend: 627;
- lpr: 53.

**Detalle:** [modulos/hardening-pre-piloto.md](modulos/hardening-pre-piloto.md) §7 · Privacidad: [modulos/privacidad-ley-21719.md](modulos/privacidad-ley-21719.md) · Smoke: [modulos/smoke-pre-piloto.md](modulos/smoke-pre-piloto.md).

**Pendientes:**
- **P10:** commits y PR (los dispara Benjamin).
- **Smoke manual.**
- **Operación:** secretos nuevos, BD limpia, backfill de membresías, hubs con condominio, `VITE_KIOSK_*` fuera de Vercel, ruleset en `main`, secret scanning y Raspberry de 64 bits.
- **Hardware:** conflicto de GPIO 22 (hangup y relé de puerta) y si `pigpio` exige root.

---

## 2026-07-12 — Fase 0 #20: frontend a cookies ✅ → FASE 0 COMPLETA (7/7)
- Delegado a frontend-senior-dev, más fixes de regresión (CameraPlayer/useNotifications/WebSocketService) y verificación en navegador por Nova.
- Cutover a cookies httpOnly de better-auth: axios withCredentials, login/logout/getUser por cookie, vistas reset/confirm con token opaco. `seed-admin` provisiona la cuenta better-auth (prereq). Cero `AUTH_TOKEN` en el frontend.
- Verificado (navegador): login `ben.munozm` → dashboard con RBAC por cookie, cookie httpOnly, sin `AUTH_TOKEN` en localStorage, sin errores de consola.
- **FASE 0 (auth robusta + multi-tenant) COMPLETA.** Detalle en [modulos/auth-multitenant.md §16](modulos/auth-multitenant.md#16-tarea-20--frontend-a-cookies-httponly--2026-07-12-verificado).
- Pendientes antes de mergear/prod: rotar secretos de `lpr/.env`; ~11 errores tsc preexistentes del frontend (bloquean build prod); gateway de notificaciones sin validar sesión; Jest/ESM.

---

## 2026-07-11 (cont. 9) — Fase 0 #21: review de seguridad + hardening ✅
- Auditoría del cybersecurity-engineer (2🔴/3🟠/3🟡/5🔵) + fixes por senior-backend-engineer, revisado y verificado por Nova.
- **Cerrado el riesgo #1**: los endpoints de ingesta que abrían el portón sin auth ahora exigen `apiKey` (ServiceApiKeyGuard) — verificado 401 sin key. Worker LPR cablea la key.
- JWT_SECRET: fallback eliminado + fix de un bug grave (firmaba con el secret hardcodeado por orden de carga). Rate-limit, synchronize prod-safe, targetUserId restringido, anti-enumeración, helmet, secure cookies.
- `lpr/.env` desregistrado (tenía secretos) → **ROTAR**. Detalle en [modulos/auth-multitenant.md §17](modulos/auth-multitenant.md#17-tarea-21--hardening-de-seguridad--2026-07-11-verificado).
- **Fase 0: 6/7 (#15–#19, #21). Solo falta #20 (frontend→cookies), diferido para cuando Benjamin esté presente (cutover visible + acoplamiento §16).**

---

## 2026-07-11 (cont. 8) — Fase 0 #19: multi-tenant ✅
- Delegado a senior-backend-engineer, revisado y verificado por Nova (test de aislamiento independiente).
- organization=condominio; tenant desde membresía; TenantInterceptor + helpers de scoping (super-admin bypass); `organizationId` en 10 entidades núcleo; módulo onboarding (condominios + members).
- Verificado: 2 condominios aislados (cada admin ve solo su data), super-admin cross-tenant, RBAC 403, login legacy+módulos 200.
- **Fase 0: 5/7 (#15–#19). Falta #20 (frontend→cookies, ver acoplamiento §16) y #21 (cleanup+seguridad+tests).**
- Detalle en [modulos/auth-multitenant.md §15](modulos/auth-multitenant.md#15-tarea-19--multi-tenant-organizationcondominio--2026-07-11-verificado).

---

## 2026-07-11 (cont. 7) — Fase 0 #18: flujos + apiKey + disableSignUp ✅
- Delegado a senior-backend-engineer, revisado y verificado por Nova.
- Sign-up cerrado (`disableSignUp`), flujos forgot/reset/confirm migrados a better-auth, emails re-cableados, bridge `user.password` que mantiene el login legacy vivo, service-token vía apiKey.
- Verificado: login legacy + módulos 200, sign-up 400, apiKey endpoint 201. Build limpio.
- Detalle y deudas (#21: retro-assign de permisos, retirar Token/createServiceToken legacy, Jest/ESM) en [modulos/auth-multitenant.md §14](modulos/auth-multitenant.md#14-tarea-18--flujos-de-cuenta--apikey--disablesignup--2026-07-11-verificado).
- **Fase 0: 4/7 tareas hechas (#15–#18). Faltan #19 (multi-tenant/organization), #20 (frontend cookies), #21 (cleanup+seguridad+tests).**

---

## 2026-07-11 (cont. 6) — Fase 0 #17: AuthGuard dual-mode ✅
- Delegado a senior-backend-engineer, revisado y verificado por Nova.
- `AuthGuard` autentica con sesión de better-auth (cookie) primario + JWT Bearer legacy fallback; ambos cargan el User con roles/permisos. RBAC fino intacto.
- Verificado: legacy 200/401/401, cookie better-auth 403(sin rol)/200(con rol Super Admin). Build limpio.
- Deuda para #21: Jest roto por imports ESM-only de la lib (baseline ya estaba rojo). Ver [modulos/auth-multitenant.md §13](modulos/auth-multitenant.md#13-tarea-17--authguard-dual-mode--2026-07-11-verificado).

---

## 2026-07-11 (cont. 5) — Fase 0 #16: modelo User unificado ✅
- Delegado a senior-backend-engineer (con skills), revisado y verificado por Nova.
- `user` de better-auth = fuente de verdad (opción C). Una sola tabla `user` en `public` (TypeORM la crea con nativos + additionalFields); better-auth crea el resto vía CLI. `confirmed`→`emailVerified`; `customSession` inyecta roles/permisos.
- Verificado: build limpio, login legacy + 5 módulos dependientes 200, sign-up + get-session con user unificado (roles/permisos). RBAC fino intacto.
- Aristas transitorias (dual password store, disableSignUp abierto, rut/phone requeridos) documentadas en [modulos/auth-multitenant.md §12](modulos/auth-multitenant.md#12-tarea-16--modelo-user-unificado--2026-07-11-verificado). Onboarding (org+invitaciones) en §7b.
- Documentado el modelo de onboarding: plataforma → admin de condominio → usuarios (sign-up cerrado, invitaciones del organization plugin).

---

## 2026-07-11 (cont. 4) — Fase 0 arrancada: POC better-auth verificado
- Rama `feature/fase-0-auth-multitenant`. Instaladas skills de skills.sh (`.agents/skills`, symlink a `.claude/skills`) y deps (better-auth 1.6.23 + nestjs-better-auth 2.4.0 + @better-auth/api-key).
- **POC (delegado a senior-backend-engineer, revisado por Nova contra las skills):** better-auth montado en paralelo, no destructivo. Verificado end-to-end (build ok, sign-in con cookie httpOnly, get-session ok, auth propio intacto 401). Detalle y aristas en [modulos/auth-multitenant.md](modulos/auth-multitenant.md#11-estado-del-poc-2026-07-11--verificado).
- Aristas flagueadas para el cableado real: sign-up abierto (cerrar `disableSignUp`), rate-limit storage, npm audit, audit logging.

---

## 2026-07-11 (cont. 3) — Research better-auth + mapa de auth → diseño Fase 0
- **Research (deep-web-researcher, jul-2026):** la lib `@thallesp/nestjs-better-auth` está sana (v2.7.0, 4-jul-2026); las skills de skills.sh son agent-skills que se usan junto con la lib. Recomendación: lib community + skills, NO vanilla. Organization plugin = tenant; RBAC fino mejor app-side (customSession). CVEs parchadas en jun-2026 → pinnear versión.
- **Mapa de auth (codebase-explorer):** hallazgo clave = el RBAC es SEPARABLE de la autenticación (`AuthorizationGuard` solo lee `request.user`), así que se reemplaza solo la capa de sesión y se conservan los 114 usos de `@RequirePermissions`. Blast radius acotado.
- **Entregable:** [modulos/auth-multitenant.md](modulos/auth-multitenant.md) — diseño + plan de migración de la Fase 0, con 4 decisiones abiertas para Benjamin (modelo User, sesión, service-token, teams).

---

## 2026-07-11 (cont. 2) — better-auth pasa a ser Fase 0
- **Decisión:** migrar a **better-auth** como **Fase 0 (fundacional)** para cerrar auth robusta + multi-tenant desde el inicio, y que el agente-cerebro nazca tenant-aware. Se aprovecha que hoy hay ~cero datos (migración barata).
- **Guardia de tech lead:** POC primero (fit NestJS + mapeo de los 79 permisos) y **timebox**, para no comerse el runway de septiembre (donde vive el agente, el diferenciador).
- El plan se reordenó: Fase 0 = auth/multi-tenant; Fase 1 = consolidar agente-cerebro en backend; Fase 2 = agente completo; Fase 3 = visión; Fase 4 = métricas/piloto/hardening. Ver [04](04-plan-por-fases.md).

---

## 2026-07-11 (cont.) — Decisiones técnicas afinadas
- **Timeline:** ideal "todo perfecto" a mediados de septiembre (~2 meses); tope noviembre (5 meses). → meta sept = agente-cerebro (Fases 0–1); resto a nov.
- **Voz en RPi (🟢):** la Raspberry es puente de audio delgado; el speech-to-speech va en la nube (realtime). VAD liviano local. Vosk solo si no hay internet.
- **AI Gateway:** aclarado que es el provider `@ai-sdk/gateway` del AI SDK.
- **better-auth (revisado):** se aprueba avanzar (buena opción para SaaS + hoy no hay datos = migración barata), condicionado a un POC (fit NestJS + mapeo RBAC).
- **Presupuesto edge:** sin plata para Jetson → el edge cabe en RPi5 (LPR gatillado por evento) o va a la nube (Vision-on-trigger). Regla: el edge manda eventos/frames, nunca video continuo. Falta investigar números concretos (FPS RPi5, costo cloud).
- **Hardware:** Benjamin decodifica las señales R1/R2 del citófono GT hoy.
- Amin no participa en la construcción.

---

## 2026-07-11 — Retoma del proyecto + definición de enfoque y futuro

**Contexto:** Benjamin retoma la tesis tras un tiempo sin tocarla (antes trabajada con GitHub Copilot, primera vez con Claude Code).

**Trabajo técnico de la sesión:**
- Se indexó el monorepo con **CodeGraph** (índices por-subproyecto + índice raíz unificado + auto-sync) y se actualizó CodeGraph a v1.4.1.
- Se exploró y entendió toda la arquitectura (backend, frontend, lpr, vigilia-hub).
- Se **rescató trabajo sin commitear** (feature "Guardián Visual" end-to-end + LogsModule que estaba mal ignorado por gitignore) y se consolidó en `main` vía PRs #45/#46. Ramas viejas limpiadas; repo quedó ordenado (solo `main`).
- Se levantó el stack completo en local (backend, frontend, Postgres, MediaMTX) y se verificó funcionando. Se aisló el proyecto Docker como `vigilia` (chocaba con RUKLO por carpetas `backend/` homónimas; data de RUKLO intacta).
- Se sembró un usuario Super Admin de bootstrap y se corrigió un bug real (`userSchema.age` no aceptaba `null` → 403 en toda ruta protegida).

**Conversación estratégica (lo importante):**
- Se aclaró la **visión**: el proyecto es un **agente conserje autónomo** (el cerebro del condominio), no "LPR + citófono". Ver [01](01-vision-contexto.md).
- **Hallazgo clave:** el agente de voz hoy vive **duplicado** en frontend y `vigilia-hub`, ya divergido; el backend solo mintea tokens y ejecuta 4 tools. Ver [02](02-estado-actual.md).
- **Decisión de rumbo:** mover el **cerebro al backend** como única fuente de verdad; web y hub pasan a transportes delgados. Ver [03](03-arquitectura-objetivo.md).
- Se detalló el rol de `vigilia-hub`: dispositivo de punteo **dentro** del citófono **Aiphone GT**, que intercepta la llamada antes de la casa, puentea mic/altavoz/teclado, decodifica R1/R2, redirige a la casa marcada, abre portón/puerta.
- Se definió el **plan por fases** ([04](04-plan-por-fases.md)) y se abrieron **decisiones técnicas** ([05](05-decisiones-tecnicas.md)): Vercel AI SDK (+Gateway) para el agente, capa de voz realtime, evaluar última YOLO, better-auth vs extender RBAC para multi-tenant, split cloud/edge, cámaras pendientes.

**Aclaraciones de Benjamin:**
- Cámaras: quedan como incógnita por ahora (sin contacto con el conserje), no bloqueante, alta probabilidad RTSP/Hikvision.
- Amin no participa en la construcción; Benjamin lleva solo el desarrollo (avisará si delega).
- Modelo de negocio aún abierto, depende del split cloud/edge.

**Próximo paso sugerido:** iniciar Fase 0 por un módulo concreto (consolidar el cerebro del agente en el backend), documentando el diseño del módulo antes de implementar.
