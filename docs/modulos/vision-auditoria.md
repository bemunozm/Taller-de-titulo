# Auditoría integral del subsistema de visión (`lpr/`)

> **Fecha:** 2026-07-17 · **Método:** 5 auditorías adversariales en paralelo (arquitectura/mantenibilidad, configuración/operabilidad, seguridad, viabilidad edge/modelos, reglas/robustez ambiental). Los hallazgos 🔴 fueron **verificados directamente en el código** (no solo por los agentes) antes de registrarlos aquí.
>
> **Propósito:** documentar el estado real de `lpr/` antes de la Fase 3, y servir de base al capítulo de resultados de la tesis. Cada hallazgo lleva `file:line`.

## Diagnóstico en una frase

`lpr/` tiene la **forma** de un sistema robusto —cinco capas de validación, motion gating, retry con backoff, confirmación multi-frame— pero **ninguna de esas capas está realmente conectada**. El código no es malo; fue escrito y nunca verificado, porque el mecanismo que debía reportar los fallos está roto de origen. Consecuencia central: **el sistema se defiende mucho menos de lo que su código sugiere**, y eso es más peligroso que no tener defensas, porque invita a confiar.

Corolario operativo descubierto en esta auditoría: **el subsistema no es desplegable hoy en una Raspberry limpia** (no se instala; ver Bloque 2).

---

## Bloque 1 — Correctitud del pipeline (decide si se abre un portón)

### 🔴 El gate de confianza no filtra la emisión
`processor/worker.py:252` — `post_event()` está **fuera** del `if save_high:` (`:190`). Los umbrales `LPR_DET_CONF_THRESHOLD=0.55` / `LPR_OCR_CONF_THRESHOLD=0.98` solo deciden si se **guarda un JPG en disco**, no si se **emite al backend**. Una lectura con 13% de confianza OCR se emite igual. **Verificado.**

### 🔴 Anti-spam invertido
`emitted_cache[plate]` se marca **dentro** del `if save_high` (`worker.py:244`). El dedupe de `LPR_DEDUP_SECONDS=120` protege a las lecturas **buenas** y deja pasar el flood de las **malas**, que se re-emiten en cada frame (~1/s mientras el auto está a la vista). **Verificado.**

### 🔴 El manejo de errores es código muerto — la causa raíz sistémica
`worker.py:66-81`: `submit_frame` (`:81`) sobrescribe `self.processing_future` con un future nuevo **antes** de que `:67` consulte el anterior. El future con la excepción queda sin referencia y `concurrent.futures` no reporta nada. `logging.exception('Error worker')` (`:71`) **nunca corre**.
- **Evidencia empírica:** en el log real `logs/worker_56cf34a5-….log` hay **239 patentes "duplicada"** (cada una debía disparar el `NameError` de abajo) → **0 `NameError`, 0 "Error worker"**. La excepción se evapora.
- Cualquier excepción del pipeline (OCR, disco lleno, `cv2.imwrite`) desaparece: el worker "corre" y no procesa nada, con el log sano. Explica ~7 meses de bugs invisibles. Mismo patrón en `guardian_worker.py:110-124`.

### 🔴 `NameError` en el path de dedupe
`worker.py:139` — `continuedebug('Placa %s recientemente emitida', plate_clean)`: función inexistente (fusión de `continue` + `logging.debug`). Lanza `NameError` en cada patente duplicada y **aborta el resto del `for det in plates`** (si entran dos autos juntos, el segundo se pierde). **Verificado.**

### 🔴 `plate_sightings` nunca se purga → la confirmación se auto-desactiva con el uptime
`worker.py:32,143,148` — sin TTL, sin cleanup. Combinado con `should_confirm` (`rules.py:46`: `elapsed≥5s AND count≥1`), **desde el segundo avistamiento histórico de cualquier patente se confirma en un solo frame**; `LPR_CONFIRM_FRAMES=3` no aplica a autos recurrentes. Además `count` es acumulativo y no decae: tras días, `count` de un residente va en cientos, y **un único frame con un OCR falso que produzca esa patente confirma al instante**. La característica anti-falso-positivo se degrada con el tiempo de operación (segura en la demo, peligrosa en el piloto). **Verificado.**

### 🔴 Filtro de tamaño de crop muerto
`settings.py:139-143` define `min_crop_w=30`, `min_crop_h=10`, `min_crop_area=300`, `min_crop_ratio=2.0`, `max_crop_ratio=12.0` — con **cero referencias fuera de `settings.py`** (verificado por grep). `worker.py:95` solo valida que el área no sea cero → **un crop de 1×1 px entra al OCR**, que alucina con confianza media y dispara la cadena entera.

### El scoring está mal de forma, no de valor
`rules.py:53` — `combined = 0.75·ocr_conf + 0.25·det_conf`. Suma dos cantidades incomparables: `det_conf` mide que *hay* una patente, no *qué dice*. Deja que una detección nítida compense una lectura ilegible — el caso de una patente sucia o nocturna, donde más hay que desconfiar. Además `ocr_conf` es la **media** de las confianzas por carácter (`fast_ocr_adapter.py:52`): 6 chars a 0.9 → media 0.90, pero P(lectura correcta) ≈ 0.53. La forma correcta para control de acceso es que **la señal más débil domine** (AND / producto / mínimo), no una media ponderada.

### La cadena completa del desastre
```
crop 20px → OCR alucina "BBCD12" conf 0.6
  → plausible_plate ✅ (regex laxo)
  → ratio_above ✅ (MIN_CHAR_CONF=0.30, tolera 2 de 6 chars malos)
  → should_confirm ✅ (2º avistamiento histórico → 1 frame)
  → should_save_or_emit → False (combined < 0.3)
  → post_event() SE EJECUTA IGUAL (gate desconectado) → 🚪 PORTÓN
```
Cinco capas de defensa, y ninguna defiende.

---

## Bloque 2 — Instalabilidad

### 🔴 `pip install` limpio no arranca
`requirements.txt` pide `pydantic>=1.10.0` (resuelve a v2), pero `settings.py:5-13` necesita `pydantic-settings` (que **no está en requirements**) y su tercer fallback es idéntico al primero → la cadena de imports no puede tener éxito con pydantic v2. Funciona en el PC de desarrollo solo porque `pydantic-settings` está instalado de antes, por accidente. `lpr/__init__.py:10-16` envuelve el import en `try/except: pass`, así que el paquete "importa bien" con la config rota y el error aparece disfrazado más adelante.

### 🔴 `pyproject.toml` no empaqueta nada
`[tool.setuptools.packages.find]` con `where=["."]` desde dentro de `lpr/` no encuentra ningún paquete `lpr*`. `lpr.egg-info/top_level.txt` está **vacío** (verificado) → `pip install -e .` instala **cero código**. De ahí las tres capas de hacks de `sys.path` en `execute_worker.py`, `manager.py` y `cli.py`.

### Dependencias flotantes e irreproducibles
Todo `>=` sin techo, `fast-plate-ocr[onnx]` sin versión, sin lockfile → dos Raspberrys flasheadas en fechas distintas corren stacks distintos. `transformers>=4.30.0` está declarado y **no lo importa nadie** (verificado). `psutil` se usa en `debug_visual_guardian.py` y no está declarado. `pydantic-settings` (necesario) no está declarado.

### Gestión de modelos inconsistente
`guardian_worker.py:20` carga `YOLO('yolo11n.pt')` con ruta relativa al CWD y sin paso de descarga documentado → el Guardián no arranca sin internet. El LPR usa otro mecanismo (`hf_hub_download`, `yolo_detector.py:17-33`) → **dos estrategias** en el mismo paquete. `yolo11s.pt` (18 MB) es **huérfano** (cero referencias, verificado).

### `.env.example` desincronizado
Documenta **7 de 44** variables; una que documenta (`LPR_SAVE_DETECTIONS_DIR`) **no existe** en el código (la real es `LPR_DETECTIONS_DIR`); y `LPR_MIN_DET_CONF=0.45` en el ejemplo contradice el default `0.3` de `settings.py:34`.

---

## Bloque 3 — Operabilidad

### 🔴 `/health` y `/status` mienten por construcción
`api/manager.py:167-173` devuelve el PID sin `proc.poll()`; `:181-186` devuelve `running_workers = len(_PROCS)` (entradas de un diccionario, no procesos vivos). Un worker muerto por OOM cuenta como vivo para siempre. **El modo de falla dominante es el silencio, y nada mide silencio.**

### 🔴 Cero supervisión de procesos
El manager hace `Popen` (`:119`) y nunca `wait()`/`poll()` → zombies `<defunct>`, sin restart, sin backoff, sin límite de procesos. Si el manager se reinicia, los hijos sobreviven huérfanos y `reconcile_with_backend` los relanza → dos workers por cámara compitiendo por el mismo RTSP.

### 🔴 "Reconectando…" es mentira: no hay reconexión
El `VideoCapture` se abre una vez (`cli.py:29`) y nunca se reabre. Si el RTSP cae, `cap.read()` devuelve `False` para siempre → bucle infinito de warnings, proceso vivo, cámara ciega permanente y silenciosa. Sin `CAP_PROP_OPEN_TIMEOUT_MSEC`/`READ_TIMEOUT_MSEC`, un stream **congelado** bloquea el hilo indefinidamente. Sin watchdog ni heartbeat de liveness.

### 🔴 El manager arranca un stub silencioso si falla el import
`lpr/manager.py:45-53`: si `import lpr.api.manager` falla (dep faltante, `.env` inválido), devuelve una FastAPI stub con solo `GET /` → `{'ok': True}`. systemd lo ve `active`, el health responde 200, y **ninguna cámara se registra jamás**. Un servicio debe morir ruidosamente.

### 🔴 El disco se llena solo
El default de fábrica no borra nada. `CLOUDINARY_DELETE_LOCAL` solo aplica si `CLOUDINARY_UPLOAD=True` (default `False`). Sin rotación de logs (medido: ~48 MB/día/cámara con `verbose=True` de ultralytics), sin retención en `detecciones/`. Al llenarse la SD, `cv2.imwrite` falla y el `except` se lo traga; de paso corrompe lo demás que corra en la Pi.

### 🔴 El edge no es autónomo sin internet
`api/client.py:32-45`: si se cae la red, `post_event` tarda hasta ~37s (3 reintentos con backoff) antes de rendirse, pierde el evento **sin cola de reintento**, y bloquea el hilo de esa cámara mientras tanto. **Se cae internet → el portón deja de abrir y la cámara deja de mirar.** Falta caché local de lista blanca + decisión local + cola de eventos.

### Estado en memoria: leaks
| Estructura | file:line | Purga | Nota |
|---|---|---|---|
| `LprWorker.plate_sightings` | `worker.py:32` | ❌ ninguna | 🔴 corrompe la confirmación (Bloque 1) |
| `LprWorker.emitted_cache` | `worker.py:33` | ❌ ninguna | crece con cada patente distinta |
| `GuardianWorker.emitted_cache` | `guardian_worker.py:37` | ❌ ninguna | clave por `track_id` monótono → una entrada por persona, para siempre |
| `GuardianWorker.track_hits` | `guardian_worker.py:54` | ⚠️ solo rama "sin detecciones" | casi nunca purga en cámara con tráfico |
| `GuardianWorker.sightings` | `guardian_worker.py:21` | ✅ TTL 30s | única purga correcta del paquete |

### No es multi-tenant en el edge
El worker no conoce condominios (grep `condominium|tenant|organization` → nada). Toda la config es global por `.env`. Dos cámaras en la misma Pi (portón iluminado vs. patio nocturno IR) no se pueden configurar distinto sin dos instalaciones separadas.

---

## Bloque 4 — Seguridad

> Postura general: **crítica** — no por densidad de bugs (el backend muestra hardening a conciencia) sino porque **el hardening se detuvo en el borde del backend y no cruzó al edge**. Patrón recurrente: el control existe pero se aplica en un solo lado.

### 🔴 Manager fail-open
`api/manager.py:50-52` — `if not SECRET: return True`. Default de `WORKER_MANAGER_SECRET` = `None` (`settings.py:20`), host `0.0.0.0` (`:22`, ni siquiera en `.env.example`). Cualquiera en la LAN del condominio: `POST /unregister-camera` apaga la vigilancia del portón sin auth; `POST /register-camera` con un video propio emite detecciones "legítimas" firmadas con la key real del cliente. **Verificado.** Es el vector que convierte un incidente de software en un robo.

### 🟠 RTSP con credenciales filtrada 3 veces
`worker.py:179` / `guardian_worker.py:302` mandan `mountPath: self.cfg.rtsp_url` (con `user:pass`) al backend en cada evento — **anula el `encryptString` que el backend sí aplica** sobre la URL. También visible en `argv` (`ps`, `/proc/<pid>/cmdline`) y en `GET /status` (`cmd`). **Verificado.**

### 🟠 Path traversal vía `camera_id`
`_sanitize_fname` existe (`manager.py:66`) pero se aplica **solo al nombre del log** (`:92`). Los f-strings de paths (`worker.py:191,209,240…`) usan el `camera_id` crudo. `RegisterPayload.cameraId` es `str` sin validación. Permite sobrescribir archivos arbitrarios (`.pt`, `.env`, unidades systemd) → DoS persistente / encadenable a RCE vía `torch.load`.

### 🟠 Cross-tenant confirmado end-to-end
La service-key es global; `detections.service.ts:100` deriva el `organizationId` del `cameraId` del payload, no de la key. Con la key de un condominio (texto plano en la Pi expuesta) se inyectan detecciones en la cámara de **otro** condominio. **`GET /anomalies/cameras/:id/zones` no tiene guard** (`anomalies.controller.ts:35`) y el comentario del código afirma "sin evidencia de uso por worker" — **es falso**: `guardian_worker.py:_fetch_zones` lo llama en cada arranque, sin API key. Expone el mapa de puntos ciegos. **Verificado.**

### 🟠 Sin anti-spoofing (riesgo de negocio)
Un papel A4 o una pantalla de celular con una patente válida frente a la cámara ~5s abre el portón. Recomendación de producto: exigir co-detección de vehículo (clase `car`) alrededor del bbox de la patente, y 2º factor para visitas.

### 🟠 Cadena de suministro
Deps flotantes con CVEs alcanzables: incidente real de `ultralytics` (cryptominer en PyPI, dic-2024), `torch.load` RCE (CVE-2025-32434, encadena con el path traversal), `Pillow` (procesa imágenes de fuente no confiable), `requests`. Irreproducible sin lockfile.

### Descartado con evidencia (no invertir tiempo aquí)
- **No hay command injection** — `Popen` con lista, sin `shell=True`, sin argument injection posible tras `-m`. Concluyente.
- **El Bearer legacy no es bypass** — los endpoints de ingesta solo miran `x-api-key`.
- **Firma HMAC/SHA1 de Cloudinary correcta**; `api_secret` no se filtra.
- **TLS se verifica** — no hay `verify=False` en el repo.
- **File-read vía FFmpeg** no es canal de exfiltración útil (salida = frames).
- **Repo limpio de datos sensibles** — `git ls-files`: ni patentes, ni `.pt`, ni logs, ni `.env` versionados. (Sí existe exposición en disco y en Cloudinary con URLs adivinables — cuestión de Ley 19.628 para la defensa.)

---

## Bloque 5 — Modelos, viabilidad edge y estandarización

### La pregunta "¿estandarizar y correr menos modelos?" apunta al 4%
En un proceso de ~800 MB, los pesos ocupan ~30 MB (**4%**); **torch + ultralytics ocupan ~500 MB (60%)**. Nunca hay más de 2 modelos ML por proceso (`cli.py` es excluyente: `patente` = detector+OCR; `guardia` = yolo11n). Fusionar los dos YOLO ahorraría ~10 MB de ~6.600. Es ruido.

### Inventario de modelos
| Modelo | Dónde | Formato | Runtime | Estado |
|---|---|---|---|---|
| Detector patentes (`morsetechlab/yolov11-...`) | `yolo_detector.py:27` ← `cli.py` | `.pt` | torch+ultralytics | activo (modo patente) |
| `cct-s-v1-global-model` (fast-plate-ocr) | `fast_ocr_adapter.py:15` | **ONNX** | onnxruntime | activo (modo patente) |
| `yolo11n.pt` (COCO, clase persona) | `guardian_worker.py:20` | `.pt` | torch+ultralytics | activo (modo guardia) |
| `yolo11s.pt` | — | `.pt` | — | **huérfano (18 MB)** |
| MOG2 / ByteTrack | `guardian_worker.py:50,177` | — | OpenCV | algoritmos clásicos (no ML) |

### Palancas reales (ninguna toca "cuántos modelos hay")
1. **Matar torch → ONNX.** `onnxruntime` **ya está instalado** (viene con `fast-plate-ocr[onnx]`). Exportar los YOLO a ONNX y borrar torch/torchvision/ultralytics del runtime: **−60% RAM y ~2,3× CPU, sin reentrenar, sin perder precisión**. De ahí a NCNN, otro ~2×.
2. **Compartir proceso** (hoy 1 subproceso/cámara, `manager.py:90`). El estado ya está encapsulado por instancia; el GIL no es el bloqueador (torch/cv2 lo liberan). Bloqueador real: `persist=True` (`guardian_worker.py:177`) → ByteTrack vive dentro del objeto YOLO; compartirlo ingenuamente contamina los track IDs entre cámaras.

### ¿Cabe en un RPi5?
**2-3 cámaras con el stack actual — y la CPU revienta antes que la RAM.** `target_ia_fps=5.0` (Guardián) está fuera de rango por ~3,4× (techo real ~1,5 FPS con 1 cámara acaparando 4 cores). Con ONNX/NCNN: ~300 MB/proceso y ~68 ms/inferencia → muchas más cámaras. **Todas las cifras de RAM/CPU son estimaciones con la aritmética a la vista; ninguna medida en Pi real** — no cambian el veredicto cualitativo pero mueven la frontera exacta de "cuántas cámaras por Pi" (número de *pricing* para el SaaS).

### Guardián — roto en lo esencial
- `enableGuardian:false` **se ignora** (`guardian_worker.py:70-71`: solo warning, sigue procesando).
- Zonas descargadas **una sola vez** (`zones_last_fetched` se escribe y nunca se lee) → editar en la UI no tiene efecto hasta reiniciar.
- **El merodeo no consulta las zonas** (`:244`): cualquiera visible 20s en cualquier parte del frame dispara alerta (cartero, vecino).
- **El motion gating ciega al merodeo por diseño**: merodear es estar quieto → sin movimiento MOG2 no dispara YOLO → el track expira a los 30s → contador a cero. El intruso que se queda quieto vigilando es exactamente el que no se ve.
- Pérdida de track ID (ByteTrack sin re-ID, oclusión por un auto) → contador de merodeo a cero → explotable escondiéndose ~15s cada vez.

---

## Bloque 6 — Reglas y robustez ambiental

### Umbrales sin evidencia de calibración
Búsqueda en `git log -- lpr/` y en todos los `.md`: **cero** rastro de tuning. Los seis umbrales (`MIN_DET_CONF=0.3`, `MIN_CHAR_CONF=0.30`, `DEDUP_SECONDS=120`, `CONFIRM_FRAMES=3`, `CONFIRM_SECONDS=5`, `COMBINED_ALPHA=0.75`) son valores al aire.

### El regex laxo y el charset chileno
`rules.py:17` corre con el default `^[A-Z0-9]{3,8}$` (`LPR_PLATE_REGEX` no está en `.env.example`). Acepta `TURBO`, `4X4`, `HILUX`, `123456`, patentes extranjeras y lecturas truncadas. Las patentes chilenas usan solo **18 letras** (sin vocales ni M, N, Ñ, Q): `B C D F G H J K L P R S T V W X Y Z`, formato `LLLL##` o `LL####`. Aplicarlo cuesta **cero CPU** (un valor en `.env`) y es la mejora de precisión con mejor relación impacto/esfuerzo.

Tres vías para el charset:
- **A) Regex de validación/rechazo** — inmediata, `rules.py:17` ya lo soporta. Convierte confusiones (0/O, 1/I) en rechazo → falso negativo (residente esperando). Cuidado con patentes antiguas/extranjeras/motos.
- **B) Corrección determinista por posición** (`0→D` en pos. de letra, etc.) — recupera falsos negativos, pero corrige a ciegas: si el vehículo no cumple el formato, convierte una lectura correcta en falso positivo. Marcar `meta.corrected`.
- **C) Reranking sobre la distribución del OCR** (enmascarar clases inválidas por posición) — la vía correcta, pero **bloqueada hoy**: `char_confidences` es `List[float]` (solo el argmax), no la distribución. Requiere refactor de `fast_ocr_adapter.py` para retener logits.

### Cero preprocesamiento de imagen
Es `crop → PIL → OCR` literal (`worker.py:97-101`). Sin CLAHE, denoise, deskew, gate de nitidez, gamma. Además el roundtrip `cvtColor(BGR2RGB) → PIL → np.array` es overhead y **posible bug de color** si `fast_plate_ocr` asume BGR (verificar).

### Mejoras ambientales priorizadas por impacto/costo-CPU
| # | Acción | Impacto | Costo | Nota |
|---|---|---|---|---|
| 1 | Filtro de tamaño mínimo de crop (config ya existe) | 🔥 muy alto | ~0 | un `if` |
| 2 | `LPR_PLATE_REGEX` chileno | 🔥 muy alto | 0 | un valor en `.env` |
| 3 | CLAHE sobre el crop | 🔥 alto | ~0.5 ms | contraluz + niebla + sombra |
| 4 | Gate de nitidez (varianza Laplaciano) | alto | ~0.2 ms | motion blur → esperar mejor frame |
| 5 | Subir `imgsz` del detector (hoy 640 implícito) | 🔥 alto | 🔴 ~2.2× | financiar con motion-gating; medir en Pi |
| 6 | Padding + upscale del crop | medio | ~0.3 ms | recupera chars cortados |
| 7 | Gate de saturación (IR nocturno clippeado) | medio | ~0.05 ms | deja de emitir basura de noche |
| 8 | Verificar bug RGB/BGR del adapter | ❓ | 0 | 10 min de lectura |
| ❌ | Super-resolución / dehazing / deblur | — | 🔴 50-300 ms | inviable en edge |

> **Nota transversal:** los ítems 1, 2, 4, 7 son *gates de rechazo* — bajan falsos positivos a costa de subir falsos negativos. La curva FP/FN es **decisión de producto**: un intruso es raro pero catastrófico; un residente esperando en la lluvia es real y recurrente.

---

## Lo que está bien
`rules.py` limpio, puro y bien tipado (y trivialmente testeable). `_cleanup_sightings` es la única purga de estado correcta. El retry con backoff de `client.py`/`fs_storage.py` está bien construido (le falta cubrir códigos HTTP). El motion gating con MOG2 es la decisión arquitectónica correcta para edge. `_sanitize_fname` y el `Popen` con lista (no shell) evitan inyección. La separación `detector`/`ocr`/`storage`/`processor` es sensata. **El problema no es la estructura, es lo que hay adentro.**

---

## Índice de remediación → fases

| Bloque | Fase | Prioridad |
|---|---|---|
| 1 — Correctitud del pipeline | **3.A** | P0 (abre portones con basura) |
| 2 — Instalabilidad | **3.B** | P0 (sin esto no hay piloto) |
| 3 — Operabilidad | **3.C** | P0/P1 (silencio = ceguera) |
| 4 — Seguridad (fail-open + path traversal) | **3.seg** (dentro de F3) | P0 pre-piloto |
| 4 — Cross-tenant service-key | Fase 4 (o 3.seg si alcanza) | P1 |
| 5 — Runtime ONNX / estandarización | **Fase 5** | P1 (rendimiento) |
| 5 — Guardián (zonas, merodeo, motion-gating) | **Fase 5** (parte en 3.A: `enableGuardian`) | P1 |
| 6 — Reglas / robustez ambiental | **Fase 5** (regex chileno se adelanta a 3.A) | P1 |
| Benchmark propio (patentes chilenas, RPi5) | **Fase 5** (entregable cuantitativo tesis) | cierre |
