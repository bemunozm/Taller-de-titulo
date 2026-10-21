# 05 — Decisiones técnicas

Decisiones abiertas y en discusión. Formato mini-ADR. Estado: 🟢 decidido · 🟡 en discusión · 🔴 pendiente.

---

## D1 — Framework del agente (cerebro) 🟢 *implementado (F1)*
**Contexto:** hoy el agente está atado a OpenAI y duplicado en clientes. Se quiere un cerebro en el backend, provider-agnóstico.

**Propuesta de Benjamin:** [Vercel AI SDK](https://ai-sdk.dev/) + AI Gateway.

**Evaluación (Nova):** buena elección y apropiada.
- ✅ Provider-agnóstico (OpenAI, Anthropic, Google, etc.), tool-calling de primera clase, streaming, TypeScript-nativo → encaja directo en el backend NestJS.
- ✅ El AI Gateway agrega ruteo/fallback/observabilidad de proveedores, pero **es opcional**: el desacople de proveedor ya lo da el SDK a nivel de código (puedes usar los providers directo sin Gateway). Ojo: el Gateway es un servicio hosteado (dependencia + costo + los datos pasan por Vercel) — a considerar si algo debe ser on-prem/edge.
- 💡 **Alternativa a evaluar encima del AI SDK:** [Mastra](https://mastra.ai/) — framework de agentes construido sobre el propio Vercel AI SDK; añade agentes, workflows, memory y tools con más estructura. Si queremos scaffolding de agente listo, Mastra; si queremos control total y mínimas dependencias, AI SDK "core" (`streamText`/`generateText` + tools + loop propio).

**Lean:** AI SDK core como base; evaluar Mastra si necesitamos más andamiaje. Gateway opcional.

**DECISIÓN (Benjamin, 2026-07-12):** **AI SDK core**, y se **adelanta a Fase 1** (no Fase 2). Razón: el cerebro hoy vive en los clientes atado a OpenAI; llevarlo al backend es *reconstruir*, no mover → hacerlo sobre la base definitiva de una vez evita reescribir lo migrado. Multiagente/LangGraph/RAG solo si la métrica lo justifica (ver [modulos/agente-cerebro.md](modulos/agente-cerebro.md#9-cuándo-no-sobre-ingenierizar-criterios)). Diseño completo del módulo en [modulos/agente-cerebro.md](modulos/agente-cerebro.md).

**IMPLEMENTADO (F1):** `ai@7` + `@ai-sdk/openai` en el backend NestJS; catálogo `VigiliaTool<In,Out>` con **Zod in/out** + `ToolDispatcherService` (scope→Zod→ejecuta→Zod→audita) + `ToolLoopAgent`. Gateway **no** usado (providers directo). Multiagente/LangGraph/RAG: no fue necesario.

---

## D2 — Capa de voz en tiempo real 🟢 *opción (a) implementada desde F1*
**Contexto:** el cerebro (D1) razona con texto/tools; hablar con el visitante en el citófono necesita **speech-to-speech de baja latencia**. Son problemas distintos.

**Opciones:**
- (a) Mantener un **modelo realtime dedicado** (hoy OpenAI Realtime) como transporte de voz, y que sus tool-calls apunten al **cerebro del backend** (única fuente de verdad de tools/lógica).
- (b) Desacoplar STT → cerebro (AI SDK, cualquier modelo) → TTS: 100% provider-agnóstico pero **más latencia** (malo para una llamada).

**Lean:** (a) — voz realtime como transporte, tools resueltas por el backend. Reconcilia "cerebro agnóstico" con "mejor voz". Revisar si el AI SDK/Gateway ya expone una vía realtime aceptable.

**Alcance (2026-07-12):** la voz realtime se queda en **Fase 2** (no se adelanta como D1). En Fase 1 el core del agente (texto/tools sobre AI SDK) ya resuelve los tool-calls en el backend; hoy los resuelve el **cliente** (frontend SDK / vigilia-hub WS crudo) → mover esa resolución al backend es parte de F1, y consolidar el transporte de audio (WebRTC/WS) es F2. Ver [modulos/agente-cerebro.md](modulos/agente-cerebro.md#8-corte-fase-1-vs-fase-2).

**IMPLEMENTADO (desde F1):** opción **(a)** — OpenAI Realtime como transporte de voz en los clientes (kiosko web WebRTC / vigilia-hub WS crudo); los tool-calls se resuelven en el **backend** vía `execute-tool`, y el prompt + las definiciones de tools se sirven desde `agent-config`. El backend **no toca el audio**. Lo que resta (unificar el hub al SDK oficial) es refinamiento opcional.

**Voz en la Raspberry (decidido 🟢):** la RPi NO corre ASR. Es un **puente de audio delgado** (captura mic del citófono + reproduce respuesta); el speech-to-speech ocurre en la nube (modelo realtime). Lo único local: **VAD** liviano (`webrtcvad` / Silero) para turnos. Excepción: si no hay internet confiable en la conserjería, STT offline con **Vosk** (mejor que whisper.cpp en RPi, tiene español) — degrada UX, no es el default del piloto.

> Nota: "AI Gateway" = el provider `@ai-sdk/gateway` del propio AI SDK (acceso multi-modelo + failover con una API key), no un producto edge aparte. Los datos pasan por el gateway hosteado (a considerar solo si algo debe ser 100% on-prem).

---

## D3 — Modelos de visión 🟡 *research hecho (2026-07-12); benchmark movido a Fase 5*
> **Research SOTA completo:** ver [modulos/vision.md](modulos/vision.md) (deep-research verificado). Resumen: YOLO26 (ene-2026) supersede a YOLO11; en RPi5 la palanca más grande es el **runtime** (NCNN/OpenVINO ~2× sobre ONNX), luego migrar a **YOLO26n** (+15% FPS); OCR → `cct-xs-v2` + charset chileno de 18 letras; VLM de anomalías → bajar a gpt-4o-mini/Gemini Flash (mantener en la nube); RF-DETR/transformers descartados en RPi5-CPU. **Condición:** ninguna cifra pública es sobre patentes chilenas → decidir con un benchmark propio sobre el piloto.
>
> **Reencuadre (2026-07-17):** la auditoría integral de `lpr/` ([modulos/vision-auditoria.md](modulos/vision-auditoria.md)) mostró que **medir/migrar modelos ahora es prematuro**: el pipeline emite detecciones sin filtrar y no puede reportar sus fallos, así que cualquier benchmark mediría ruido. Además el análisis edge confirmó que **"cuántos modelos hay" no es el cuello de botella** (los pesos son el ~4% de la RAM; torch+ultralytics el ~60%): la palanca es el **runtime ONNX** (`onnxruntime` ya está instalado vía `fast-plate-ocr[onnx]`), no fusionar modelos. Por eso: la **robustez del pipeline es Fase 3**, y el **runtime + reglas + benchmark propio es Fase 5**. El charset chileno (mejora de precisión a costo cero) se adelanta a Fase 3.A.
**Contexto:** hoy YOLOv11 + fast-plate-ocr (relativamente antiguos), para patentes, OCR y anomalías.

**Propuesta de Benjamin:** evaluar la última YOLO (variante nano) para detección de patentes, extracción de texto y anomalías/seguridad.

**Evaluación (Nova):**
- 👍 Buena idea evaluar, pero **medir, no cambiar a ciegas**. La versión exacta ("v26") hay que **verificar cuál es la vigente** de Ultralytics antes de comprometerla.
- El **detector** (YOLO) y el **OCR de patentes** son dos modelos distintos: mejorar uno no mejora el otro. El texto de la patente depende tanto o más del OCR.
- Para anomalías hay una segunda etapa (GPT-4o Vision). Evaluar si conviene un detector edge + verificación en la nube.

**Acción:** armar un **harness de benchmark** con patentes reales/etiquetadas del piloto y comparar objetivamente (precisión, latencia, tamaño) los candidatos. Se puede delegar una investigación del SOTA actual (deep-web-researcher) cuando lleguemos a Fase 3.

---

## D4 — Auth + Multi-tenant 🟢 (decidido: migrar a better-auth, es Fase 0)
**Contexto:** hoy JWT + RBAC propio (roles/permisos/service-token), **funcional**. Se quiere multi-tenant para SaaS.

**Propuesta de Benjamin:** migrar a [better-auth](https://www.better-auth.com/) (tiene plugins de organización/multi-tenant).

**Evaluación (Nova) — cuidado, trade-off real:**
- La **multi-tenancy es un problema de la capa de datos**, resoluble SIN cambiar de librería de auth (agregar `tenantId` a las entidades + guard/interceptor de scoping por tenant). Bajo riesgo, lo controlas tú.
- Migrar auth es un **rewrite significativo**: re-implementar el RBAC que ya funciona, y **verificar que better-auth encaje bien con NestJS** (better-auth está más orientado a Next.js/Hono; su fit con Nest no es de primera clase — a validar antes de comprometer).
- Better-auth sí vale la pena **si además** quieres sus otras features (OAuth social, orgs, 2FA, sesiones robustas), no solo por el multi-tenant.

**DECISIÓN (Benjamin, 2026-07-11):** migrar a **better-auth** y hacerlo **Fase 0 (fundacional)** para cerrar identidad robusta + multi-tenant desde el inicio, de modo que el agente-cerebro nazca tenant-aware. Aprovechar que **hoy hay ~cero datos (1 usuario)** → la migración es lo más barata que va a ser nunca.

**Razonamiento a favor:** mantener auth hecho a mano es un pasivo (sensible; ya tiene huecos: register deshabilitado, service-token sin enganchar, endpoints sin guard); better-auth trae identidad/sesiones/OAuth/2FA/organizaciones battle-tested; y multi-tenant es central a la tesis de emprendimiento.

**Guardias antes de comprometer la migración completa (POC/spike primero):**
1. **Fit con NestJS** — el core de better-auth es agnóstico (se monta su handler en una ruta), pero no es un módulo Nest nativo; validar que quede cableado limpio.
2. **Mapeo del RBAC fino (79 permisos)** — ver si el plugin organization/access-control lo modela, o dejar permisos app-side y usar better-auth solo para identidad/sesiones/orgs.
3. **Timebox** — es plumbing con librería; no debe comerse el runway de septiembre (donde vive el agente). Si amenaza, se recorta alcance.

**Riesgo asumido:** re-homar los flujos actuales (register/confirm/forgot/reset/profile/service-token/email) al modelo de better-auth. Bounded, y más barato ahora que con datos.

**Resultado del research (jul-2026) — camino elegido:**
- **Stack:** lib community `@thallesp/nestjs-better-auth` (v2.7.0, activa) **+** las skills de skills.sh (agent-skills, se usan junto con la lib). NO montar el handler vanilla.
- **Enfoque híbrido (confirmado por el mapa de auth):** better-auth para identidad/sesión/**organización (=condominio)**/roles gruesos; el **RBAC fino (79 permisos) queda app-side intacto** (`AuthorizationGuard` + `@RequirePermissions`, 114 usos, no se tocan). Poblar permisos en la sesión con `customSession`.
- **Diseño + plan completo:** ver [modulos/auth-multitenant.md](modulos/auth-multitenant.md). Decisiones abiertas ahí: modelo User (A vs C), sesión (cookies vs stateless), service-token, teams.

---

## D5 — Cloud vs Edge (define el modelo de negocio) 🟡
**Contexto:** ¿qué corre en la nube y qué en el sitio? Clave por los modelos de IA que procesan cámaras.

**Evaluación (Nova):**
- **Edge (en el condominio):** el `vigilia-hub` (obligado, está en el hardware) y **la inferencia de visión** (LPR/anomalías) cerca de las cámaras → NO subir video crudo a la nube (ancho de banda, latencia, privacidad), enviar solo **eventos**. El `lpr/` ya es worker por-cámara → encaja. Requiere un **equipo edge** con cómputo (mini-PC / Jetson; la RPi sola es lenta para YOLO).
- **Cloud:** cerebro (agente), DB, app web, dashboard, orquestación multi-condominio.
- **Modelo de negocio derivado:** suscripción SaaS por condominio (cloud) + **appliance edge** (venta/arriendo del equipo). Limpio y defendible.

**Restricción de presupuesto:** NO hay plata para Jetson/mini-PC. El edge debe caber en una **Raspberry Pi 5** o irse a la nube donde salga más barato. Análisis:
- **LPR en RPi5: plausible por-evento** (no 24/7): motion-trigger en el portón → YOLO **nano optimizado** (NCNN/ONNX) a pocos FPS → OCR. Un auto en el portón es lento, no se necesitan 30 FPS.
- **Anomalías/seguridad: NO continuo en RPi** (modelo más pesado + ya se usa GPT-4o Vision). Hacerlo **cloud-on-trigger** (solo frames gatillados).
- **Regla de oro:** el edge manda **eventos/frames**, NUNCA video crudo continuo a la nube (eso dispara ancho de banda + GPU 24/7 y mata el margen del SaaS).
- **Modelo de negocio derivado:** SaaS por condominio (cloud) + la RPi5 como appliance edge barato (puente citófono + LPR gatillado).

**Lean:** edge (RPi5) para hub + LPR gatillado; cloud para cerebro/datos/app + Vision-on-trigger. **Pendiente:** números reales (FPS de YOLO nano en RPi5, costo de inferencia cloud, inversión por condominio) → investigar con deep-web-researcher.

**Actualización (2026-10-16): arquitectura híbrida con números reales.** La investigación se hizo con precios de Chile al 16-oct-2026.

**Perfil de cómputo del código actual:**
- Hay 1 proceso por cámara y por modo, con torch, de ~800 MB cada uno.
- Corre a ≤1 FPS en CPU.
- Cada worker abre su propio RTSP, así que hay hasta 3 decodificaciones por cámara.
- Las 11 cámaras **no caben en 8 GB** con el código actual. Tras la optimización de la Fase 5 (un solo proceso, ONNX/OpenVINO, YOLO26n a 640 px y motion-gating) la estimación baja a ~1–2 GB.

**No hace falta GPU para inferir.** La demanda es de unas 10–20 inferencias por segundo. La GPU solo sirve para entrenar.

**IA en la nube: descartada para el piloto.**
- Exige subir el video del condominio 24/7, unos 13 Mbps continuos.
- La latencia a Alemania es de ~205 ms.
- Las vCPU compartidas se limitan con carga sostenida.

**Nube, solo para lo liviano:** backend, Postgres y el MediaMTX central que reparte el video a los residentes. Benjamin ya tiene un **Hetzner CAX21** (ARM, 8 GB) por ~US$13 al mes.

**Edge para la inferencia: mini PC x86 en vez de Raspberry Pi 5.**
- Al precio real chileno, la Pi 5 de 8 GB con un Hailo-8L supera los CLP 460 mil.
- Un **Dell OptiPlex 3000 Micro reacondicionado (i5-12500T, 16 GB, NVMe) cuesta ~CLP 400 mil** y rinde ~70 inferencias por segundo (estimado):
  - su iGPU UHD 770 tiene soporte vigente de OpenVINO;
  - decodifica los 11 streams por hardware con QuickSync;
  - no obliga a compilar los modelos a HEF.
- Gasta más luz que la Pi, ~CLP 50 mil al año, pero la diferencia es menor que la fricción técnica que se ahorra.

Esto cambia la restricción anterior de "no hay plata para un mini PC": a este precio cuesta lo mismo que la Pi 5 con Hailo.

**Compra:** se decide después del benchmark de la Fase 5. Mientras tanto, la Pi 3B solo retransmite y la IA corre en el PC de Benjamin.

**Frigate:** se evaluará en el mismo benchmark como reemplazo de los workers del edge, no de MediaMTX. Adoptarlo queda como decisión de Benjamin.

---

## D6 — Sistema de cámaras del condominio 🟢 *acceso obtenido (2026-10-16)*
**Lo que había antes:** San Lorenzo tiene cámaras Hikvision visibles desde una app móvil, con la hipótesis de **RTSP nativo** (`rtsp://user:pass@ip:554/Streaming/Channels/101`).

**Confirmado (2026-10-16):**
- **Equipos:** NVR **Hikvision DS-7616NI-K2/16P**, de 16 canales con PoE propio, con **11 cámaras**. Quedan 5 canales libres. Benjamin tiene acceso al NVR, las IPs, las credenciales y Hik-Connect.
- **Red:** las cámaras viven en la red PoE interna del NVR, así que el RTSP se toma del NVR (`/Streaming/Channels/{ch}01|02`). La administración **no abrió puertos ni dio VPN**.
- **Hik-Connect** es P2P propietario y no entrega RTSP a terceros.

**Decisión: relay de borde.** Una **Raspberry Pi 3B** en la conserjería corre MediaMTX v1.15.2 en modo pull **on-demand**, sin transcodificar ni grabar. Lo envía por **Tailscale** (decisión de Benjamin), sin abrir puertos, al PC de desarrollo y más adelante al MediaMTX central del VPS. Así cada cámara cruza internet una sola vez.

**Seguridad del relay:**
- ACL de Tailscale por tags, porque UFW no filtra el tailnet.
- Un usuario del NVR con solo "vista en vivo remota".
- Credenciales fuera del repo.
- API de MediaMTX autenticada.

Kit y runbook en [`edge/camera-relay/`](../edge/camera-relay/README.md).

**Implicancia para la tesis:** ninguna cámara mira hacia afuera del portón. Las dos relevantes miran desde adentro, una a la puerta y otra al portón. Con ellas **el LPR solo puede registrar entradas y salidas, no abrir el portón**.
- Para la apertura automática hace falta una cámara exterior. La propuesta es la Hikvision DS-2CD2643G2-IZS: 4 MP, varifocal motorizado, ~CLP 200–235 mil con IVA, más la instalación.
- O bien redefinir el objetivo del LPR.

Queda como decisión de Benjamin y su profesor guía.

---

## D7 — LPR robusto por cámara 🟢 *implementado (2026-10-20); falta gate completo y PR*
**Contexto.** Con la cámara real del portón (`porton-hd`, 1920x1080 HEVC, por el relay de [D6](#d6--sistema-de-cámaras-del-condominio--acceso-obtenido-2026-10-16)) el LPR de producción **leyó 0 de 8 patentes** en la evaluación offline del 2026-10-20 (detalle y metodología en [modulos/vision.md](modulos/vision.md#evaluación-lpr-sobre-cámara-real-porton-hd)). Las causas, verificadas en el código:
- **El filtro de forma botaba todas las patentes.** Era `ratio ≥ 2.0` y estaba hardcodeado. La cámara ve la patente inclinada ~20–25°, así que su caja alineada a los ejes sale casi cuadrada (ratio mediana ~1.33).
- **El detector corría a 640**, porque `cli.py` no pasaba `imgsz`, y el worker procesaba a **1 fps**.
- **`plausible_plate` aceptaba cualquier `[A-Z0-9]{3,8}`.**
- **La confirmación contaba textos, no vehículos**, y además aceptaba una sola lectura tras 5 s.

Ninguna cámara mira hacia afuera del portón (D6), así que `porton-hd` solo puede **registrar** entradas y salidas, no abrir. Esta decisión cierra lo que [D3](#d3--modelos-de-visión--research-hecho-2026-07-12-benchmark-movido-a-fase-5) dejó pendiente para el LPR: un benchmark propio sobre datos del piloto. No cambia el modelo (sigue YOLOv11 + `fast-plate-ocr`): lo que cambia es el pipeline alrededor.

**Decisión** (plan aprobado, D1–D11 del plan, tal como quedaron en el código):

| # | Tema | Cómo quedó |
|---|---|---|
| 1 | Dónde vive la config | Columna **jsonb `Camera.lprSettings`**, nullable (migración `1791580000000-CameraLprSettings`). `null` = defaults del env del worker. Sigue el precedente de `guardianZones`. `PATCH /cameras/:id/lpr-settings` **reemplaza** la config, no la mezcla; `{}` la deja en `null`. Requiere `cameras.enable-ia` y es `@Auditable`. La lectura es `GET /cameras/:id/lpr-settings` con `cameras.read` |
| 2 | Qué es por cámara y qué es global | **Por cámara** (escena y política): `action` (`register` \| `access`), `direction` (`entry` \| `exit` \| `both`), `zone`, `detectorImgsz` (640/960/1280/1920), `sampleFps` (1–15), `crop` {`minWidth`, `maxWidth`, `minRatio`, `maxRatio`}, `confirmReads` (1–10). **Global, en el env del host:** `LPR_DEVICE`, `LPR_OCR_DEVICE` (hardware), `LPR_MIN_WINNER_SHARE` (0.6), `LPR_TRACK_MAX_GAP_SECONDS` (1.5) y el formato de patente. Los defaults del env reproducen el comportamiento previo (640, 1 fps, recorte 30 px / ratio 2–12): una cámara sin `lprSettings` no cambia de golpe |
| 3 | Cómo llega al worker | **Pull.** El worker llama a `GET /workers/cameras/:id/lpr-settings` (`ServiceApiKeyGuard`, condominio de la key, 404 si la cámara es ajena), que responde `{cameraId, enableLpr, lprSettings}`. Lo hace al arrancar, antes de abrir la captura, y después cada `LPR_ZONES_REFETCH_SECONDS` (60 s) en un hilo aparte. `apply_camera_settings` fusiona sobre la config **base** del env (función pura). `cfg` y el tracker se publican juntos bajo un lock, y el tracker solo se rehace si cambian N, la dirección o el hueco. **Si el backend falla, se conserva la última config válida.** La parte HTTP es `fetch_camera_json` en `lpr/api/client.py`, que comparten el Guardián y el LPR: nunca lanza, no sigue redirects y no loguea el cuerpo |
| 4 | Zona de detección | El detector ve solo el **rectángulo envolvente** de la zona, con 5 % de margen y a resolución nativa. `imgsz` se escala al recorte (`scaled_imgsz`) para que la patente conserve su tamaño en píxeles. Las cajas se re-proyectan al cuadro y se descarta toda caja cuyo **centro quede fuera del polígono**. La geometría se extrajo a `lpr/utils/zones.py` y la usa también el Guardián. **Zona fail-closed:** una zona que llega rota conserva la última válida; si nunca hubo una, `detection_blocked=True` y la cámara **no detecta nada** (con log de error) en vez de ensancharse a todo el cuadro. `zone: []` quita la zona a propósito |
| 5 | Formato de patente | Módulo puro `lpr/processor/plate_format.py`: `LLLL##` con las 18 letras (BCDFGHJKLPRSTVWXYZ) y `LL####`, con **corrección posicional** letra↔dígito según la clase de cada posición (0/O/D, 1/I/L, 2/Z, 4/A, 5/S, 6/G, 8/B). Endurecido contra textos que no son patentes: máximo 2 correcciones, a lo más 1 dígito en el grupo de letras y al menos la mitad del grupo de dígitos deben ser dígitos reales. Si empatan los dos formatos, gana el moderno. Una letra fuera del set se sustituye solo si el OCR dudó de ese carácter (conf < 0.6). Es el default de `resolve_plate`; `LPR_PLATE_REGEX` sigue siendo el override |
| 6 | Seguimiento + voto | Módulo puro `lpr/processor/plate_tracker.py`. Asocia cajas entre cuadros por distancia de centros, con un umbral proporcional al tamaño de la caja y a lo que alcanzó a moverse. Cierra el seguimiento tras 1.5 s sin ver la patente. Dentro del seguimiento hay un **voto por texto completo ponderado por `ocr_conf`**, y se **emite una vez por vehículo** cuando el ganador suma N lecturas y al menos el 60 % del peso (`winner_share`). Con `direction=both` la dirección se infiere por la tendencia del ancho (crece = entra, decrece = sale, plana = `unknown`); `entry`/`exit` la fijan. El historial por seguimiento tiene un tope de 200 |
| 7 | Qué reemplaza | Se reemplazaron `plate_sightings` + `should_confirm` (incluida la rama de 1 lectura tras 5 s), el filtro de calidad de caracteres y el gate de confianza; sus variables de env quedan declaradas sin efecto, para no romper un `.env` existente. Se mantiene el **dedupe deslizante de 120 s por patente**, que ahora se consume **solo si el POST se aceptó, o si pudo haber llegado**. Ver "POST ambiguo" abajo |
| 8 | Modo "solo registrar" | Lo aplica el **backend** (`DetectionsService.createDetection`), que es quien abre el portón. Con `action='register'` se guarda la `PlateDetection` y un `AccessAttempt` con decisión **`Registrado`**, y nada más: sin búsqueda de vehículo o visita, sin `sendDoorOpen`, sin escalar al conserje, sin `applyVisitPassage` y sin notificación. El `method` toma la dirección (`Patente - Entrada`, `Patente - Salida` o `Patente - Registro`) y `responseTimeMs` queda `null`, para que no entre en las métricas de SLA. **Fail-closed** (`isRegisterOnly`): solo `null`, `action` ausente o `'access'` conservan el control de acceso; cualquier otro valor, incluido un jsonb corrupto, se trata como "solo registrar". La salida temprana va antes de cualquier efecto |
| 9 | Regresión con datos reales | `lpr/tools/replay_eval.py` corre los clips por **el mismo camino que el worker** (`pipeline.process_frame`: zona → forma → OCR → formato → seguimiento + voto), sin POST, y compara contra un CSV de verdad terreno. Devuelve código 2 si hubo alguna patente incorrecta, así que sirve como gate. Enmascara las patentes del reporte. Los datos viven fuera del repo (`lpr/eval-data/`, ignorado) |
| 10 | UI | `GuardianZoneEditor` pasó a un **`ZoneEditor`** reutilizable, con paletas `guardian` y `lpr`. En el menú de cada cámara, **"Configurar LPR"** abre `LprSettingsDialog`, con las secciones Política, Detección, Recorte de la patente, Confirmación y la zona dibujada sobre el video en vivo; la validación es zod con `zodResolver`. Sin `cameras.enable-ia` el diálogo es solo de lectura. La trazabilidad muestra la decisión `Registrado` y la dirección del intento |
| 11 | Normalización en la ingesta | `createDetection` aplica `normalizeChileanPlate` a `dto.plate` antes de persistir y de buscar el vehículo, porque el match es por igualdad exacta. Si el texto cambia, conserva el recibido en `plate_raw`. Una patente que queda vacía responde 400 |

**Reglas transversales:**
- **Contrato compartido.** Las reglas de `lprSettings` viven en [`contracts/lpr-settings.cases.json`](../contracts/lpr-settings.cases.json): rangos, enums, pares del recorte, límites de la zona, propiedades desconocidas y `null` explícito rechazados, y casos válidos e inválidos. Lo consumen tres tests, uno por capa: el DTO del backend (`lpr-settings.contract.spec.ts`), el zod del frontend (`lprContract.test.ts`) y el worker (`test_lpr_settings_contract.py`). Si cambia una regla, cambia el archivo y las tres capas deben seguir en verde. El worker **vuelve a validar** lo que recibe (defensa en profundidad): ignora con un warning el campo inválido y no el resto, y un par del recorte incoherente se descarta solo él.
- **Mínimo de lecturas en modo acceso.** `confirmReads < 3` se rechaza cuando la acción es `access` o no se indica. La regla está en el DTO, en zod y en el worker, y solo `register` puede bajar de 3.
- **POST ambiguo.** `classify_post_exception` separa dos casos:
  - `STATUS_NOT_SENT` (DNS, conexión rechazada, timeout al conectar, TLS): se reintenta y **no** consume el dedupe.
  - `STATUS_MAYBE_SENT` (timeout leyendo la respuesta, conexión cortada a mitad): el backend pudo haber abierto el portón, así que **no** se reintenta y **sí** consume el dedupe. Es más seguro perder un evento que reabrir.

  Los POST usan `allow_redirects=False`, para que el `x-api-key` no termine en otro host.
- **Logs sin patentes.** El worker enmascara las patentes en todos sus logs con `lpr/utils/pii.py` (`AB**12`, misma regla que `maskPlate` del backend). El payload al backend sí lleva la patente real.

**Alternativas descartadas:**
- **ByteTrack para patentes.** `ultralytics` no se instala en CI (`requirements-ci.txt`), así que el seguimiento no sería testeable allí. Un tracker propio en Python puro sí lo es al 100 % y es justo el que se validó offline. El Guardián sigue con ByteTrack para personas.
- **Superresolución o preprocesado del recorte.** El benchmark probó upscale x2/x3, padding, CLAHE, sharpening y rotación con 3 modelos de OCR (210 lecturas sobre patentes de ~40 px). Ninguna combinación dio la misma lectura en dos cuadros: el OCR redimensiona todo a 128x64, y agrandar no agrega la información que el sensor y el códec no capturaron. Una superresolución aprendida suma costo y el riesgo de "inventar" caracteres, inaceptable en algo que puede abrir un portón. La palanca real es más píxeles por patente, es decir, la cámara.
- **Bajar N para ganar latencia.** Con N=2 se leyeron 7/8 con **1 incorrecta**; con N=1, 5/8 con **4 incorrectas**. Los errores del OCR están correlacionados, porque cuadros consecutivos son casi idénticos: repetir la misma lectura equivocada 2 veces es fácil. N=3 suma ~0.6 s a la latencia mediana y es el menor N sin incorrectas.
- **Columnas escalares en vez de jsonb.** Escalares darían restricciones en la BD, pero una migración por campo y un esquema rígido para algo que todavía se está calibrando. jsonb sigue el precedente de `guardianZones` y se resuelve con una sola migración. La falta de restricciones en la BD se compensa con el DTO, el contrato compartido, la revalidación del worker y el fail-closed de `isRegisterOnly`.
- **Push de la config por argv del manager.** Obligaría a reiniciar el worker en cada cambio y choca con el `already_running` del manager. Además el argv ya es deuda, porque lleva credenciales RTSP. El pull reutiliza el patrón del Guardián y aplica los cambios en caliente.

**Consecuencias:**
- ✅ Con la configuración recomendada, la evaluación pasó de **0/8 a 8/8, sin incorrectas**, con la zona dibujada o sin ella. Cada cámara se ajusta desde la UI, sin reiniciar el worker (≤ 60 s).
- ✅ Una cámara en modo `register` **no puede abrir el portón por construcción**: lo decide el backend, no el worker.
- ⚠️ La configuración recomendada (cuadro completo a 1920 y 8 fps) **requiere GPU**. En CPU, 1920 cuesta ~153 ms por cuadro, más que los 125 ms disponibles a 8 fps. La zona baja el costo. Esto condiciona el equipo edge de [D5](#d5--cloud-vs-edge-define-el-modelo-de-negocio-): el benchmark de la Fase 5 debe medirlo en el hardware candidato.
- ⚠️ **El límite es físico.** El OCR es confiable desde ~55–60 px de ancho de patente, y `porton-hd` entrega entre ~40 y ~94 px según la distancia. Para **abrir** el portón hace falta la cámara dedicada que propone D6.
- ⚠️ **La muestra es chica:** 8 pasadas, de día y con el mismo ángulo. Por la regla del 3, 0 errores en 8 es compatible con una tasa real de hasta ~37 %. Antes del piloto hay que medir de noche, con motos y con lluvia.

**Deuda (fuera de alcance):**
- Usar `direction` en el check-in/out de visitas (`applyVisitPassage`).
- Mostrar `meta.track` en `AttemptDetails`.
- WebSocket de detecciones y unificar el tipo `PlateDetection` duplicado en el frontend.
- Conflicto `ultralytics 8.3.0` vs `numpy` en `requirements.txt` (preexistente).
- Credenciales RTSP en el argv del worker (preexistente).
- Formatos de patente de moto y especiales.
- **Reconciliación periódica del manager.** Si `enableLpr` pasa a `false`, el worker solo lo deja en el log: el manager reconcilia únicamente al arrancar, así que el worker sigue corriendo hasta que alguien lo detenga.
