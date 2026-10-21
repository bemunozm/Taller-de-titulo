# Privacidad y Ley 21.719: diseño de Vigilia

> Estado: diseño de la fase P7 del hardening (2026-10-09). Base: la investigación del 2026-10-09 (fuentes al final), el inventario de datos del backend y la revisión de transparencia del frontend, del prompt y del hub.
> **No es asesoría legal.** Un abogado debe revisar los textos de aviso y la política antes del piloto.

## 1. Marco aplicable

- **Ley 21.719** (reforma la 19.628). Vigencia legal: **1-dic-2026**. El Boletín 18.623-07 propone postergarla y está en discusión. Se diseña para el 1-dic-2026.
- No existe norma específica para CCTV, LPR ni asistentes de IA. Rigen los principios del art. 3 (licitud, finalidad, **proporcionalidad**, calidad, responsabilidad, seguridad, transparencia, confidencialidad) y los arts. 12–16 ter.
- **Datos de Vigilia:** nombre, RUT, teléfono, email, patente, imagen de CCTV, voz y transcripción. Son **datos personales comunes**. La voz y el rostro solo serían biométricos (art. 16 ter) si se usaran para identificar de forma única.
- **Decisión de diseño:** Vigilia **no hace reconocimiento facial ni de voz**. Así queda fuera del régimen de datos sensibles.

## 2. Bases de licitud

| Tratamiento | Base | Nota |
|---|---|---|
| Datos de residentes (RUT, teléfono, email, familia, vehículos) | Art. 13 c: ejecución de contrato (administración del condominio) | El consentimiento sería frágil, porque el residente no puede negarse sin perder el servicio. |
| CCTV en espacios comunes y anomalías | Art. 13 d: interés legítimo (seguridad), con ponderación documentada (§7) | Se recomienda un acuerdo de la asamblea de copropietarios. |
| LPR de residentes | Art. 13 c y d | Es lo que permite el ingreso vehicular. |
| LPR de visitantes | Art. 13 d | Aviso visible en el acceso (§6). |
| Voz y datos del visitante con la IA | Art. 13 d (operar el control de acceso), más aviso previo | Pedir consentimiento verbal no sirve: no es libre, porque quien se niega queda sin acceso. Grabar para otros fines sí requeriría consentimiento, y **no se hace**. |
| Notificaciones al residente (app, email o SMS) | Art. 13 c | Son parte del servicio. |

## 3. Retención (P7: `RetentionService`)

La ley no fija plazos: son **criterio propio** justificado por la proporcionalidad. El de 30 días para imágenes sigue la referencia del CPLT (Oficio 2309/2017).
- Cada plazo es configurable por env.
- El servicio corre a diario en lotes, con modo de prueba (`RETENTION_DRY_RUN`).
- Es idempotente (`anonymizedAt`) y **nunca toca registros vigentes**: visitas en AWAITING_APPROVAL, PENDING, ACTIVE o READY_FOR_REENTRY; sesiones ACTIVE; acciones pendientes no terminales.

| Dato | Acción | Plazo por defecto | Env |
|---|---|---|---|
| Imágenes: recorte de patente (`plate_detections.meta.snapshot_jpeg_b64`), frame completo (`full_frame_path` y su archivo en Cloudinary), foto de anomalía (`anomaly_events.snapshotJpegB64`) | Borrar la imagen (la fila sigue) | **30 días** | `RETENTION_IMAGES_DAYS` |
| Visita terminal: nombre, RUT, teléfono, patente solicitada, motivo y QR del visitante | Anonimizar (`visitorName` = "[anonimizado]", el resto a null) | **90 días** desde el cierre | `RETENTION_VISITS_DAYS` |
| Sesión del conserje terminal: datos del visitante, nombres en `residentsNotified` (se conservan los ids), `transcript` y `functionCalls` | Anonimizar | **90 días** | `RETENTION_VISITS_DAYS` |
| Detecciones e intentos: patente (`plate`/`plate_raw`), vínculo al residente, texto de `reason` | Anonimizar (las métricas del dashboard siguen) | **90 días** | `RETENTION_ACCESS_LOG_DAYS` |
| Pasadas de vehículos (`vehicle_passages.plate`, D8) | Anonimizar junto con sus detecciones (`anonymizedAt`) | **90 días** | `RETENTION_ACCESS_LOG_DAYS` |
| Anomalías (fila con `aiReasoning`) | Borrar | **90 días** | `RETENTION_ANOMALIES_DAYS` |
| Notificaciones (copian los datos del visitante) | Borrar | **90 días** | `RETENTION_NOTIFICATIONS_DAYS` |
| Acciones pendientes terminales (`input`, `contextSnapshot`, `result`) | Borrar | **90 días** | `RETENTION_PENDING_ACTIONS_DAYS` |
| Auditoría (`audit_logs`) | Borrar | **365 días** | `RETENTION_AUDIT_DAYS` |
| Logs del sistema (`system_logs`) | Borrar | **30 días** (hoy está fijo en el código) | `RETENTION_SYSTEM_LOGS_DAYS` |
| Usuario deshabilitado | Anonimizar: nombre "Usuario eliminado", email no entregable y único, RUT, teléfono y foto a null; borrar la foto en Cloudinary | **30 días** desde la baja | `RETENTION_DISABLED_USERS_DAYS` |
| better-auth: `session` y `verification` vencidas; `rateLimit` antiguo | Borrar | al vencer / 1 día | — |
| Disco del LPR (frames) | Ya existe | 7 días | `LPR_RETENTION_DAYS` |

- **Pasadas multicámara (2026-10-21, D8).** Una pasada agrupa las lecturas de una misma patente vistas por varias cámaras, y copia la patente en `vehicle_passages.plate`. La retención y la supresión por patente la enmascaran en la misma operación que anonimiza sus detecciones (`anonymizeDetectionsWith`). Dos registros vigentes **no** se tocan antes de tiempo:
  - **Pasadas abiertas.** Una pasada que sigue dentro de su ventana (`LPR_PASSAGE_WINDOW_SECONDS`, 60 s) todavía puede recibir lecturas, así que no se enmascara.
  - **Evidencia de una pasada pendiente.** Una detección no se anonimiza mientras su intento, **o el intento de su pasada**, espera la decisión del conserje (`Pendiente`). Así las lecturas de las otras cámaras siguen disponibles como evidencia de esa decisión.
  - **Caso borde pendiente:** si una supresión inmediata alcanza a una pasada todavía abierta, sus detecciones se anonimizan pero la patente de la pasada no, y ninguna corrida posterior vuelve a ella. Falta un barrido propio de `vehicle_passages` (deuda de D8).
- **Audio crudo:** Vigilia **no lo guarda**: ni el backend ni el hub lo persisten (se verifica en P7). La transcripción solo se usa en vivo, porque `ConciergeSession.transcript` nunca se escribe.
- **Retención del encargado:** OpenAI retiene sus logs de monitoreo de abuso hasta **30 días**, y Realtime **no es elegible** para Zero Data Retention. Debe informarse en la política.

**Minimización desde la captura, que sigue funcionando aunque la retención falle:**
- Logs sin datos personales: teléfono enmascarado, patente parcial, sin nombres ni RUT.
- `LOG_LEVEL` en producción sin `debug`.
- Auditoría (`oldValue`/`newValue`) y `auditToolCall` / `pending_actions` con los campos personales redactados.

## 4. Derechos de los titulares (arts. 5–11)

- **Canal:** el correo de la administración del condominio, publicado en la política. Se responde en **30 días corridos**, prorrogables una vez por 30 días más. El titular puede reclamar ante la Agencia.
- **Herramientas mínimas (P7):**
  - **Residente:** `GET /auth/me/data-export` le entrega sus datos (perfil, familia, vehículos, visitas que creó, notificaciones), con lo que cubre acceso y portabilidad. Rectifica en su perfil.
  - **Administración** (supresión u oposición de visitantes y residentes): una ruta de borrado inmediato, acotada al condominio y auditada, que anonimiza por **RUT** o **patente** las visitas, sesiones, notificaciones y detecciones que coincidan. También permite anonimizar a un usuario deshabilitado sin esperar los 30 días.
  - **Video:** si se entrega una copia, difuminar a terceros (CPLT). Es un procedimiento manual y queda fuera del software del piloto.

## 5. Transparencia

### 5.1 Aviso de IA (voz, al inicio de cada llamada; lo dice Sofía)

> "¡Hola! Soy Sofía, la asistente virtual con inteligencia artificial del condominio. Esta conversación se transcribe solo para gestionar tu visita; el aviso de privacidad está en el acceso."

- No se presenta como "conserje" humana.
- Al pedir el RUT o el teléfono indica la finalidad una vez: "para registrar tu visita".
- **Nunca nombra a los residentes**: "notifiqué al residente de la casa X". Además, los dispositivos ya no reciben los nombres desde las tools.
- Si no puede resolver o el acceso se niega, informa que una persona (residente o conserjería) decide. Así se cumplen las garantías del art. 8 bis.

### 5.2 Kiosko web: pantalla previa al micrófono

Antes de `getUserMedia`, el kiosko muestra:

> "Vas a hablar con Sofía, una asistente de inteligencia artificial. Para gestionar tu visita, tu voz se procesa en tiempo real con un proveedor de IA (OpenAI, EE.UU.). Registramos tu nombre, RUT, teléfono, patente y motivo, que se conservan 90 días. [Ver aviso de privacidad] [Continuar] [Cancelar]"

### 5.3 Política de privacidad pública (art. 14 ter)

Es una ruta **pública**, enlazada desde la landing, el login y el kiosko. Secciones:
1. Responsable (la administración del condominio) y contacto, configurables. Vigilia actúa como encargado.
2. Categorías de datos: identificación, contacto, imagen, patente, voz y transcripción, registros de acceso.
3. Finalidades y base de licitud de cada una (§2).
4. Encargados: OpenAI (voz, transcripción, visión de anomalías, agente de texto), proveedor de correo SMTP (notificaciones y el "SMS" con el QR, que hoy es un email), Cloudinary (fotos de perfil y, si se activa, frames del LPR) y hosting.
5. Transferencias internacionales a EE.UU. (OpenAI, bajo su DPA) y su sustento. Está pendiente la lista de países adecuados de la Agencia.
6. Plazos de conservación, la tabla del §3. **Deben coincidir con los valores configurados.**
7. Medidas de seguridad **reales**: control de acceso por rol y condominio, cifrado de las credenciales de cámaras, auditoría y TLS. Se quitan las afirmaciones falsas (2FA y "cifrado de datos sensibles").
8. Derechos (acceso, rectificación, supresión, oposición, bloqueo, portabilidad), cómo ejercerlos y el plazo de 30 días.
9. Reclamo ante la Agencia de Protección de Datos Personales.
10. Fuentes de los datos: el propio titular, el residente que registra una visita, las cámaras y el LPR.
11. Decisiones automatizadas: el LPR abre para vehículos autorizados; una negativa nunca es definitiva sin una persona.
12. Sin reconocimiento facial ni de voz.
13. Fecha y versión.

## 6. Cartel de cámaras y LPR (físico, en el acceso)

> **ZONA VIDEOVIGILADA.** Este condominio graba imágenes y lee patentes de vehículos por seguridad y control de acceso. En el citófono te atiende una asistente de inteligencia artificial. Responsable: [Administración del condominio, RUT]. Conservación: imágenes 30 días; registros de acceso 90 días. Más información y ejercicio de derechos: [correo] / [QR a la política].

El cartel va visible **antes** de entrar al área grabada.

## 7. Evaluación de impacto liviana (EIPD)

El art. 15 ter probablemente no la exige a un condominio, porque no es gran escala. Igual se hace como buena práctica y como material de tesis.

| Riesgo | Medida | Riesgo residual |
|---|---|---|
| Acceso indebido entre condominios | Aislamiento por condominio (P5), jerarquía de roles y auditoría | Bajo |
| Exposición de imágenes con personas | Retención de 30 días, foto por HTTP acotada y fuera del socket (P6), sin reconocimiento facial | Medio: viajan a OpenAI para el análisis de anomalías |
| Transferencia de voz a EE.UU. | Aviso previo, minimización y DPA de OpenAI | Medio: Realtime sin ZDR y retención de 30 días del proveedor |
| Decisión automatizada que niega el acceso | El LPR o la IA nunca niegan de forma definitiva; escala a una persona; el citófono siempre está disponible | Bajo |
| Perfilado de visitantes | Se eliminan los "frecuentes" del contexto (P6) y se anonimiza a los 90 días | Bajo |
| Datos personales en logs | Redacción desde la captura y `LOG_LEVEL` | Bajo |
| Brecha de seguridad | Hardening P2–P6 y deber de reporte a la Agencia (art. 14 sexies) | Medio: sin un procedimiento formal de respuesta a incidentes en el piloto |
| Video que sale del condominio (relay de cámaras, ver 7.1) | Pull on-demand: solo sale lo que alguien mira. Sin grabación en la Pi, túnel cifrado, ACL por tags y usuario del NVR con solo vista en vivo | Medio: un dataset de entrenamiento implica copias de imágenes fuera del condominio |

### 7.1 Relay de cámaras y dataset de entrenamiento (2026-10-16)

Una Raspberry Pi 3B en la conserjería retransmite las cámaras del NVR por **Tailscale** hacia el PC de desarrollo y, más adelante, al servidor central (kit en `edge/camera-relay/`). Cómo se trata cada aspecto:

- **Qué sale y cuándo:** solo los streams que alguien está mirando (on-demand). La Pi **no almacena video**. Su journald guarda las IPs de los lectores y los nombres de los paths, con un tope de 64 MB.
- **Encargado nuevo, Tailscale:** coordina las conexiones y solo ve metadatos (nodos, IPs y horarios). Hay que sumarlo al inventario de encargados de la política (5.3, punto 4).
- **Cifrado por tramo:**
  - **NVR → Pi:** viaja en claro por la LAN del condominio, porque RTSP del Hikvision no tiene TLS.
  - **Pi → consumidores:** va cifrado de punta a punta con WireGuard, también cuando pasa por los relays DERP de Tailscale.
  - **Mitigación del tramo en claro:** el usuario del NVR solo tiene "vista en vivo" y el relay solo puede hablar con la IP del NVR.
- **Antes de grabar cualquier dataset para entrenar** hacen falta tres cosas:
  1. autorización escrita de la administración (el responsable);
  2. definir la finalidad (entrenar y evaluar modelos de LPR y de detección de personas para la tesis), el plazo de conservación y la eliminación al cerrar la tesis;
  3. guardarlo cifrado y fuera del repo, con acceso solo de los autores.

  Las imágenes que se publiquen en la tesis van anonimizadas: patentes y rostros difuminados.
- **Transferencia internacional:** el servidor central (Hetzner) está en Alemania. La UE tiene un nivel de protección equivalente (RGPD), pero falta confirmarlo con la lista de la Agencia.

### 7.2 Datos de evaluación del LPR (2026-10-20)

Para calibrar el LPR de `porton-hd` se grabaron clips reales del portón y se armó una verdad terreno con las patentes ([vision.md](vision.md#evaluación-lpr-sobre-cámara-real-porton-hd)). Son datos personales (patentes e imágenes de personas), así que se tratan así:

- **Fuera del repo, que es público.** Los clips, el CSV de verdad terreno y las salidas del harness viven en `lpr/eval-data/`, que está en `.gitignore`. También se ignoran todo video bajo `lpr/` (`*.mkv`, `*.mp4`, `*.avi`, `*.mov`) y las salidas `replay-*.json`. Solo se versiona la herramienta (`lpr/tools/replay_eval.py`), nunca los datos.
- **Documentos y reportes sin patentes reales.** Las pasadas se publican anonimizadas como P1…P8 y los clips no se identifican por nombre, porque el nombre lleva fecha y hora. El reporte del harness enmascara las patentes salvo con `--show-plates`, que es solo para uso local.
- **Logs del worker enmascarados.** `lpr/utils/pii.py` (`mask_plate`) aplica la misma regla que `maskPlate` del backend: quedan los 2 primeros y los 2 últimos caracteres (`AB**12`). Se usa en todos los logs de lecturas, emisiones y dedupe, y en el DTO que se loguea en dry-run, que además va sin la imagen base64. El POST al backend sí lleva la patente real, porque es el dato del tratamiento.
- **Tests con patentes sintéticas.** Ningún test del worker, del backend ni del frontend usa patentes vistas en las cámaras.
- **Borrado al terminar.** Cuando termine la calibración, los clips y la verdad terreno de esta prueba se borran del equipo de desarrollo, incluidas las copias temporales. Si hiciera falta un dataset de evaluación permanente para la tesis, rigen los tres requisitos de 7.1: autorización escrita, finalidad y plazo definidos, y almacenamiento cifrado.

## 8. Incierto o pendiente

- Prórroga de la vigencia, normativa de la Agencia (videovigilancia, LPR, formato de reporte de brechas) y lista de países adecuados.
- Firmar o aceptar el DPA de OpenAI y revisar el del proveedor SMTP y el de Cloudinary.
- Revisión legal de los textos. Audio pregrabado del aviso en el hub, para no depender del modelo (follow-up).
- Anexo del dataset de entrenamiento (finalidad, plazo, custodia y anonimización para la tesis) y autorización escrita de la administración para el relay (7.1).
- Borrar los clips y la verdad terreno de la evaluación del LPR del 2026-10-20 al cerrar la calibración (7.2).

## Fuentes (consultadas el 2026-10-09)

- [BCN, Ley 21.719](https://www.bcn.cl/leychile/consulta/obtxml?opt=7&idNorma=1209272)
- [OpenAI, Your data (retención y ZDR)](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI, Data Processing Addendum](https://openai.com/policies/data-processing-addendum/)
- [CPLT, Oficio 2309/2017, recomendaciones sobre dispositivos de vigilancia](https://www.consejotransparencia.cl/wp-content/uploads/2020/01/RECOMENDACIONES-Dispositivos-de-Vigilancia.pdf)
- [IAPP, puntos pendientes de la reforma en Chile](https://iapp.org/news/a/protecci-n-de-datos-personales-puntos-pendientes-antes-de-la-entrada-en-vigor-de-la-reforma-en-chile)
- [Carey, proyecto de postergación](https://www.carey.cl/gobierno-ingresa-proyecto-de-ley-que-posterga-en-un-ano-entrada-en-vigor-de-la-ley-sobre-proteccion-de-datos-personales)
