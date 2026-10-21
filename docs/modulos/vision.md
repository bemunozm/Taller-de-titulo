# Fase 3 — Modelos de visión: research y plan (D3/D5)

> Estado: 🟡 research hecho (2026-07-12), decisión **pendiente de benchmark propio**. Deep-research con verificación adversarial (23/25 claims confirmados, 2 refutados). Fuentes 2025–2026.
>
> **Actualización (2026-10-20):** primera evaluación propia sobre la cámara real del portón. Ver [Evaluación LPR sobre cámara real (porton-hd)](#evaluación-lpr-sobre-cámara-real-porton-hd) y la decisión [D7](../05-decisiones-tecnicas.md#d7--lpr-robusto-por-cámara--implementado-2026-10-20-falta-gate-completo-y-pr). La configuración por cámara está en [Configuración LPR por cámara](#configuración-lpr-por-cámara-lprsettings).

## Stack actual (del código, verificado — no de memoria)
| Componente | Modelo | Ubicación |
|---|---|---|
| Detección de patentes | YOLOv11 fine-tuned (`morsetechlab/yolov11-license-plate-detection`, n/s/m), Ultralytics ≥8.1, CPU, conf 0.3 | `lpr/detector/yolo_detector.py` |
| OCR de patentes | `fast-plate-ocr` (`cct-s-v1-global-model`), ONNX, **CPU siempre** | `lpr/ocr/fast_ocr_adapter.py` |
| Personas/merodeo (edge) | YOLOv11-**nano** (`yolo11n.pt`, COCO person) + ByteTrack, imgsz 960, ~5 FPS, motion-gating MOG2 | `lpr/processor/guardian_worker.py` |
| Anomalías (nube) | **GPT-4o** Vision (detail low, 150 tok) | `backend/src/anomalies/services/vision-analysis.service.ts` |

Todo corre en **CPU** (GPU opcional/manual; sin ONNX/NCNN/TensorRT propio). Edge target = **Raspberry Pi 5, sin presupuesto para Jetson** ([D5](../05-decisiones-tecnicas.md#d5)).

## 1. Detectores — en RPi5 CPU
Novedad: **YOLO26** (Ultralytics, 14-ene-2026) **supersede a YOLO11**. NMS-free (sin supresión post-proceso) y sin DFL → export más simple.

| Modelo | Params | mAP COCO | RPi5 (ONNX) | ¿Viable RPi5? |
|---|---|---|---|---|
| YOLO11n (actual) | 2.6M | 39.5 | 6.79 FPS | ✅ |
| **YOLO26n** (candidato) | 2.4M | 40.1 | **7.79 FPS (+15%)** | ✅ mejor |
| YOLOv12n | ~2.5M | 40.6 | *solo GPU publicado* | ⚠️ sin dato CPU |
| RF-DETR (transformer) | 30.5M–127M | >60 AP | *solo GPU* | ❌ ~12× tu modelo |

⚠️ El "+43% CPU" de Ultralytics es en Xeon x86 datacenter, **no** RPi5. En RPi5 la mejora real es ~15%, y los nano quedan en **1 dígito de FPS a 640px** → confirma el diseño **por-evento (motion-trigger)**, no streaming.

## 2. Runtime = la palanca más grande (más que el modelo)
| Runtime (YOLO26n, RPi5) | Latencia | vs ONNX |
|---|---|---|
| PyTorch | 302 ms | 0.4× |
| ONNX (actual) | 130 ms | 1× |
| OpenVINO | 70.7 ms | ~2× |
| **NCNN** | 67.7 ms (~14.8 FPS) | **~2×** ← más rápido |

**INT8:** para *detección* YOLO en RPi5 es ~**1.4–2×** (no el 4× citado, que es de *clasificación*).

## 3. OCR de patentes
- `fast-plate-ocr` tiene **v2** (`cct-s-v2`/`cct-xs-v2`): mejora **precisión, no velocidad** (`cct-s-v2` es *más lento* que v1).
- **FastALPR** (MIT, mismo autor): framework integrado (detector `open-image-models` YOLOv9-tiny + `fast-plate-ocr`), ONNX y swappable → upgrade mantenible sin reescribir el pipeline casero.
- 💡 **Chile:** las patentes usan solo **18 letras** (sin vocales ni M,N,Ñ,Q). Restringir el charset del OCR a ese alfabeto sube la precisión gratis.

## 4. VLM de anomalías (hoy GPT-4o, nube)
| Modelo | Costo in/out (1M) | Visión (MMMU) | Nota |
|---|---|---|---|
| GPT-4o (actual) | alto | — | overkill para clasificar |
| GPT-4o mini | $0.15 / $0.60 | 59.4% | ~3.2× más barato |
| Gemini 2.5 Flash | $0.30 / $2.50 | 79.7% (90% LPR) | más preciso, más caro |

Para clasificación semántica simple, ambos superan lo necesario → costo (gpt-4o-mini) vs. precisión (Gemini Flash). VLM open (Qwen2-VL, Llama-Vision) **NO** corren en RPi5 CPU y requieren fine-tuning GPU → **mantener el VLM en la nube**.

## Recomendación priorizada (beneficio/esfuerzo)
1. **🥇 Runtime → NCNN u OpenVINO** (de ONNX): ~2×, esfuerzo bajo, sin cambiar de modelo. La palanca más grande y barata.
2. **🥈 Detectores YOLO11n → YOLO26n** (placas + personas): drop-in en Ultralytics, +15% FPS + algo de mAP.
3. **🥉 OCR:** `cct-xs-v2` + charset chileno de 18 letras; considerar FastALPR por mantenibilidad.
4. **VLM:** bajar de GPT-4o a gpt-4o-mini (ahorro) — decisión costo vs. precisión.
5. **RF-DETR / transformers:** ❌ descartar mientras el edge sea RPi5-sin-GPU.

## ⚠️ Condición transversal (bloquea comprometer la decisión)
**Ninguna fuente mide precisión sobre patentes chilenas reales** (BBBB99/AA9999); los benchmarks de YOLO26 son de Ultralytics sin réplica independiente en RPi5; los precios de VLM son volátiles (Gemini duplicó el 2-jul-2026). → El entregable de Fase 3 es un **harness de benchmark propio** sobre datos del **piloto San Lorenzo** (patentes chilenas, iluminación/cámara reales) en la RPi5 objetivo con NCNN/INT8, comparando stack actual vs. propuesto, antes de comprometer.

## Preguntas abiertas (a resolver con el benchmark)
- Precisión de reconocimiento (no solo detección) de `cct-s-v1` vs `cct-xs-v2` y de YOLO26n/YOLOv9-tiny sobre patentes chilenas reales.
- FPS reales del pipeline completo (detección placa + OCR) en YOLO26n→NCNN/INT8 en la RPi5, y si el motion-trigger evita saturar CPU con el detector de personas simultáneo.
- Costo real por imagen del VLM a volumen del piloto (gpt-4o-mini vs Gemini) y acierto en las anomalías concretas (no benchmarks genéricos).

## Evaluación LPR sobre cámara real (porton-hd)

> Fecha: 2026-10-20. Cámara `porton-hd` del condominio San Lorenzo: 1920x1080 HEVC, tomada del NVR por el relay de borde (D6). Mira el portón **desde adentro**. Sirve como evidencia para el capítulo de evaluación de la tesis.
> **Privacidad:** las patentes reales no aparecen en este documento. Las pasadas se anonimizan como P1…P8 y los clips no se identifican por nombre (ver [privacidad-ley-21719.md §7.2](privacidad-ley-21719.md#72-datos-de-evaluación-del-lpr-2026-10-20)).

### Metodología
1. **Grabación por eventos.** Se grabaron 9 clips desde el preview en vivo de `porton-hd`, todos de una misma tarde y de día: ~870 s de video y 6 960 cuadros muestreados a 8 fps. Tres clips solo tienen vehículos sin patente detectable.
2. **Verdad terreno visual.** Se armaron mosaicos con los recortes de cada pasada y la patente de cada una se verificó a ojo. Salieron 15 pasadas candidatas:
   - **8 con patente legible**, que son las que se puntúan: 6 entradas y 2 salidas;
   - 6 falsos positivos del detector: luces traseras, ventanas con reflejo de la reja y el frente de un auto;
   - 1 ilegible, con la patente a ≤ 33 px.

   El CSV de verdad terreno marca para cada pasada la ventana de tiempo, la patente, la certeza y si entra o sale.
3. **Harness reproducible.** `lpr/tools/replay_eval.py` corre cada clip por **el mismo código del worker** (`pipeline.process_frame`: zona → filtro de forma → OCR → formato chileno → seguimiento + voto), sin POST, y lo puntúa contra el CSV:
   - **correcta:** la pasada recibió una emisión con su patente real;
   - **incorrecta:** la pasada recibió al menos una emisión con otra patente. Es la métrica grave, porque una patente equivocada puede abrir el portón o registrar a otra persona;
   - **sin lectura:** la pasada no recibió ninguna emisión;
   - **latencia:** segundos desde que el vehículo aparece (inicio de la ventana) hasta la primera emisión correcta.

   El harness devuelve código 2 si hubo alguna incorrecta. Comando de la configuración recomendada:
   ```bash
   python -m lpr.tools.replay_eval --clips lpr/eval-data/clips --gt lpr/eval-data/gt.csv \
       --imgsz 1920 --fps 8 --confirm 3 --crop 60,250,0.8,6 --device cuda:0
   # con zona: --zone "x,y;x,y;x,y;x,y"  (normalizada 0-1)  o  --zone-file zona.json
   ```
4. **Datos fuera del repo.** Los clips, el CSV y las emisiones contienen patentes y personas. Viven en `lpr/eval-data/`, que está en `.gitignore` junto con todo video bajo `lpr/`. El reporte del harness enmascara las patentes (`AB**12`).
5. **Exploración previa.** Antes del harness se barrieron 3 600 configuraciones (imgsz × fps × filtro × validación × decisión × N) sobre detecciones precalculadas. Cada una se evaluó en el peor caso de la fase de muestreo, y se ordenaron por: (1) 0 incorrectas, (2) máximo de correctas, (3) menor costo. Las cifras finales de abajo **no** salen de esa simulación: se re-midieron con el harness y el código final.

Equipo: RTX 5060 Ti 16 GB (Blackwell, sm_120), torch 2.11.0+cu128 y ultralytics 8.3.0, con el detector y el OCR del repo.

### Resultados por pasada (configuración recomendada, sin zona)

| Pasada | Sentido real | Ancho máx. de la patente (px) | ¿Leída? | Latencia (s) | Dirección inferida |
|---|---|---|---|---|---|
| P1 | entra | 83 | sí | 4.0 | entrada ✓ |
| P2 | entra | 86 | sí | 6.2 | entrada ✓ |
| P3 | sale | 94 | sí | 1.1 | salida ✓ |
| P4 | entra | 86 | sí | 4.9 | desconocida |
| P5 | entra | 81 | sí | 4.4 | entrada ✓ |
| P6 | entra | 91 | sí | 5.2 | entrada ✓ |
| P7 | sale | 64 | sí | 0.3 | desconocida |
| P8 | entra | 90 | sí | 3.2 | desconocida |

- **Ancho máximo:** el de la caja de la patente en el cuadro nativo, con el detector a 1920 y confianza ≥ 0.3. Durante una misma pasada la patente se ve desde ~25–40 px (lejos) hasta ese máximo.
- **Dirección:** 5/8 correctas y 3/8 `unknown`, **ninguna equivocada**. El tracker prefiere no adivinar cuando la tendencia del ancho es plana.
- **Casos notables:**
  - P1 y P2 son autos distintos con patentes casi iguales, que difieren en dos caracteres. Con la patente chica, el OCR las confunde.
  - P3 y P6 son el mismo vehículo, que sale y vuelve a entrar.
  - En P4 el OCR repite la **misma lectura equivocada** en cuadros consecutivos mientras la patente mide < 50 px. Ese error está correlacionado, no es azar, y por eso el recorte mínimo es 60 px y no 50.
  - P7 es la más difícil: su patente nunca supera 64 px.

### Configuraciones comparadas (8 pasadas)

| Configuración | imgsz | fps | Recorte (ancho px / ratio) | Decisión | Correctas | Incorrectas | Latencia mediana | ms/cuadro (GPU) |
|---|---|---|---|---|---|---|---|---|
| **PROD previo** | 640 | 1 | ≥ 30 / 2–12 | conteo por texto (3 lecturas o 5 s) + gate de confianza, `[A-Z0-9]{3,8}` | **0/8** | 0 | — | — |
| **Recomendada** | 1920 | 8 | 60–250 / 0.8–6 | formato chileno + corrección posicional, seguimiento + voto, **N=3**, `winner_share` ≥ 0.6 | **8/8** | **0** | 4.2–4.3 s (máx. 6.2 s) | 13–15 |
| Recomendada + zona | 1920 | 8 | 60–250 / 0.8–6 | igual | 8/8 | 0 | ~4.2 s | ~12–13 |
| N=2 | 1920 | 8 | 60–250 / 0.8–6 | igual, N=2 | 7/8 | **1** | — | — |
| N=1 | 1920 | 8 | 60–250 / 0.8–6 | igual, N=1 | 5/8 | **4** | — | — |

- PROD previo no emitió nada en ninguna pasada (ni aciertos ni errores), igual que en vivo. El resultado es el mismo con imgsz 640, 960, 1280 o 1920 si se mantiene el resto de PROD.
- **Causa raíz del 0/8:**
  - la patente se ve inclinada ~20–25°, así que su caja alineada a los ejes es casi cuadrada (ratio mediana ~1.33, **ninguna ≥ 2.0**) y el filtro de forma la botaba;
  - el detector a 640 no ve las patentes lejanas;
  - a 1 fps, casi nada junta 3 lecturas iguales.
- **La zona** no cambia el resultado. Elimina el falso positivo fijo del cuadro (una caja de ~500x580 px) y los autos de la calle, y abarata la inferencia.
- Se rechazaron los N bajos: los errores del OCR se repiten en cuadros casi idénticos. En modo acceso, el sistema exige N ≥ 3.

**Ablación** (simulación exploratoria: 1920, 4 fps, recorte ≥ 50 px, N=3, una fase de muestreo; correctas / incorrectas / sin lectura / emisiones falsas):

| Validación del texto | Decisión PROD | Voto por texto | Voto por carácter |
|---|---|---|---|
| `[A-Z0-9]{3,8}` (PROD) | 6/4/0/1 | 6/2/0/1 | 3/5/0/1 |
| chileno estricto | 6/0/2/0 | 6/0/2/0 | 6/0/2/1 |
| **chileno + corrección posicional** | 8/1/0/0 | **8/0/0/0** | 7/1/0/1 |

Lecturas de la ablación:
- El formato estricto elimina las incorrectas, pero pierde lecturas por las confusiones 2/Z, 8/B y 0/D. La corrección posicional las recupera.
- El voto por texto completo es más seguro que el voto carácter a carácter, que puede componer una patente que ninguna lectura tuvo.

### CPU vs GPU (solo el detector, por cuadro)

Benchmark previo con capturas del mismo portón. Los valores son medianas y no incluyen el decode HEVC ni el OCR, que toma ~9 ms por recorte en CPU.

| Configuración | CPU Ryzen 5 7600X (8 hilos) | GPU RTX 5060 Ti |
|---|---|---|
| cuadro completo @640 | 21.7 ms | 7.7 ms |
| cuadro completo @1920 | **152.9 ms** | **11.5 ms** |
| ROI del portón x1.66 @1280 | 73.1 ms | 12.0 ms |
| ROI del portón x2 @1536 | 101.8 ms | 14.6 ms |

- **A 8 fps hay 125 ms por cuadro.** En CPU, el cuadro completo a 1920 **no alcanza ese ritmo** y satura los 8 hilos. En GPU sobra margen para varias cámaras: el costo marginal a 8 fps es de ~0–2 W.
- **ONNX en CPU no acelera** (1.0–1.6x más lento con el modelo nano). Lo que gana es peso de dependencias.
- **Para un edge sin GPU**, lo viable es la zona (ROI) a resolución nativa, que es lo que implementa `lprSettings.zone`. Hay que medirlo en el equipo candidato en la Fase 5 (D5).
- Receta de GPU validada: comentario en `lpr/requirements.txt`.

### Límite físico y recomendación de cámara
- **El límite es la cámara, no el software.** El OCR es confiable desde ~55–60 px de ancho de patente, con caracteres de ~15 px de alto. `porton-hd` entrega entre ~40 y ~94 px según la distancia, así que el sistema solo lee en el tramo final de la pasada, cuando el vehículo está cerca.
- **El preprocesado no rescata patentes de ~40 px.** Se probaron upscale, CLAHE, sharpening y rotación con 3 modelos de OCR, y ninguna combinación dio lecturas consistentes: no se puede recuperar información que el sensor y el códec no capturaron.
- **Para abrir el portón** (modo `access`) hace falta una **cámara dedicada a LPR** que encuadre solo el carril del portón desde afuera. La propuesta es la **Hikvision DS-2CD2643G2-IZS** (4 MP, varifocal motorizado, IR; ~CLP 200–235 mil con IVA, más instalación), configurada para:
  - una patente de **≥ 100–130 px de ancho**, la referencia habitual de LPR, que deja margen para la noche, la lluvia y el movimiento;
  - shutter rápido (≤ 1/500 s) e IR para la noche;
  - ángulo lo más frontal posible, para reducir la inclinación;
  - bitrate alto en el stream principal.
- **Limitaciones de esta evaluación:**
  - Son solo 8 pasadas, de día, con el mismo ángulo y de una sola tarde. Por la **regla del 3**, 0 incorrectas en 8 es compatible con una tasa real de error de hasta ~37 % (IC 95 %). La diferencia entre 7/8 y 8/8 no es estadísticamente significativa.
  - **Antes del piloto** falta muestra de noche, con lluvia, con motos (sin formato soportado todavía) y con vehículos detenidos frente a la cámara.

## Configuración LPR por cámara (`lprSettings`)

Cada cámara guarda su configuración de visión en `Camera.lprSettings` (D7). Si queda en `null`, se usan los defaults del env del worker. Hay dos formas de editarla:

- **UI:** en el panel de cámaras, abrir el menú de la cámara y elegir **"Configurar LPR"**. Requiere `cameras.enable-ia`; sin ese permiso aparece "Ver configuración LPR", solo de lectura. El diálogo tiene las secciones Política (modo y dirección), Detección (resolución y FPS), Recorte de la patente, Confirmación (lecturas) y **"Dibujar zona de detección"**, que abre el lienzo sobre el video en vivo. "Restablecer valores por defecto" deja la config en `null`.
- **API:** `PATCH /api/v1/cameras/:id/lpr-settings`, con sesión y `cameras.enable-ia`. El body **reemplaza** la config completa, y `{}` la resetea. Las reglas de validación están en [`contracts/lpr-settings.cases.json`](../../contracts/lpr-settings.cases.json).

El worker recoge los cambios por pull, **sin reiniciar**, en ≤ `LPR_ZONES_REFETCH_SECONDS` (60 s).

**Configuración recomendada para `porton-hd`** (solo registra: no abre ni escala, porque mira desde adentro):

```json
{
  "action": "register",
  "direction": "both",
  "zone": [[{ "x": 0.36, "y": 0.33 }, { "x": 0.90, "y": 0.33 }, { "x": 0.90, "y": 0.98 }, { "x": 0.36, "y": 0.98 }]],
  "detectorImgsz": 1920,
  "sampleFps": 8,
  "crop": { "minWidth": 60, "maxWidth": 250, "minRatio": 0.8, "maxRatio": 6 },
  "confirmReads": 3
}
```

- `zone` es un ejemplo: la zona real se **dibuja en el lienzo** y debe cubrir el portón y la entrada, no la calle.
- **Host del worker:** `LPR_DEVICE=cuda:0`, porque 1920 a 8 fps necesita GPU. `LPR_OCR_DEVICE` queda en `cpu`.
- **Fail-closed:**
  - una zona inválida conserva la última válida, o, si nunca hubo una, deja la cámara sin detectar;
  - un `action` desconocido se trata como "solo registrar";
  - en modo `access`, `confirmReads` no puede bajar de 3.

## Fuentes clave (2025–2026)
- YOLO26: arXiv 2509.25164, docs.ultralytics.com/models/yolo26, anuncio 14-ene-2026.
- RPi5 runtimes: docs.ultralytics.com/guides/raspberry-pi.
- INT8: arXiv 2506.09300 (YOLOv4-Tiny), arXiv 2303.05016.
- RF-DETR: arXiv 2511.09554, rfdetr.roboflow.com.
- OCR/ALPR: github.com/ankandrew/fast-plate-ocr, github.com/ankandrew/fast-alpr.
- VLM: roboflow playground (Gemini 2.5 Flash vs GPT-4o mini), MDPI J.Imaging 11(11):400.
- Patentes chilenas: Wikipedia "Vehicle registration plates of Chile".
