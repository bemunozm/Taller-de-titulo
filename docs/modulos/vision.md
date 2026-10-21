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

## Dirección por trayectoria (ByteTrack + línea)

> Fecha: 2026-10-21. Decisión [D8](../05-decisiones-tecnicas.md#d8--dirección-por-trayectoria-del-vehículo-y-pasadas-multicámara--implementado-2026-10-21-falta-gate-completo-y-pr). Mismos clips, verdad terreno y anonimización (P1…P8) que la evaluación de arriba.

**Problema.** La dirección de D7 salía de la tendencia del ancho de la patente: crece si el auto se acerca y decrece si se aleja. En el portón acertó 5/8, con 3 `unknown` (P4, P7 y P8). Falla cuando la patente se lee pocas veces, el auto pasa de lado o se detiene.

**Cómo funciona ahora:**
1. **Seguimiento del vehículo.** Si la cámara tiene `directionLine` y no fija la dirección, el worker corre un segundo modelo, `yolo11n.pt` (COCO: auto, moto, bus y camión), con **ByteTrack** (`model.track(persist=True)`), a imgsz 640 sobre el mismo recorte de la zona que el detector de patentes. El vehículo es un objeto grande y estable: su trayectoria existe aunque la patente no se lea en todos los cuadros. Se sigue el **borde inferior central** de su caja, que es donde toca el piso y lo menos sensible a la altura del vehículo.
2. **Asociación.** Cada lectura de patente se liga al vehículo cuya caja contiene el centro de la patente. El voto por texto (N=3) no cambia.
3. **Cruce de la línea** (`lpr/utils/direction.py`, puro). Cruzar el **segmento** hacia `exitSide` es `exit` y hacia el otro lado, `entry`. Hay dos defensas contra el ruido: solo cuentan los puntos a ≥ 2 % de la diagonal del cuadro, para que un auto detenido sobre la línea no "cruce" por el jitter de su caja, y rodear un extremo del segmento no es cruzar.
4. **Respaldos** si no hubo cruce: `motion` (desplazamiento neto hacia un lado de la línea, ≥ 15 % del ancho del cuadro), luego la dirección fija de la cámara (`camera`), después `width` (lo de D7, solo con `direction=both`) y por último `none`. La línea manda aunque la cámara tenga dirección fija: esa dirección es solo el respaldo cuando no hubo ni cruce ni movimiento.
5. **Espera.** Confirmada la patente, la emisión espera hasta que el vehículo cruce, o hasta `LPR_DIRECTION_WAIT_SECONDS` (4 s), y luego emite con el mejor respaldo. La fuente viaja en `meta.direction_source`, y el backend la valida contra la configuración de la cámara.

**Metodología.** El mismo harness (`replay_eval`, mismo código del worker) con el tracker de vehículos activo, una instancia nueva por clip. Al final de cada clip se emiten las patentes confirmadas que seguían esperando, como hace el worker al detenerse. El reporte separa la dirección por fuente (`line`, `motion`, `width`, `none`) y distingue **equivocada** (sentido opuesto, la métrica grave) de `unknown`.

```bash
python -m lpr.tools.replay_eval --clips lpr/eval-data/clips --gt lpr/eval-data/gt.csv \
    --imgsz 1920 --fps 8 --confirm 3 --crop 60,250,0.8,6 --device cuda:0 \
    --zone-file zona-porton.json --direction-line "0.45,0.62;0.92,0.62;left"
```

Línea de la evaluación: horizontal, a través del carril del portón (de x=0.45 a x=0.92, a y=0.62), con `exitSide=left`, es decir, salida = el vehículo cruza hacia **arriba** en la imagen, alejándose de la cámara hacia el portón. Equipo: RTX 5060 Ti con 1920 / 8 fps / N=3 y la zona del portón.

**Resultados (8 pasadas):**

| | Antes (D7: ancho de la patente) | Ahora (D8: trayectoria + línea) |
|---|---|---|
| Patentes correctas / incorrectas | 8/8 / 0 | 8/8 / 0 |
| Dirección correcta | 5/8 | **8/8** |
| Dirección equivocada | 0 | **0** |
| Dirección `unknown` | 3 (P4, P7, P8) | **0** |
| Fuente de la dirección | `width` | `line` 6 · `motion` 2 |
| Latencia mediana (máx.) | 4.2–4.3 s (6.2 s) | ~4.6 s (6.5 s) |
| ms por cuadro (GPU) | ~13–21 | ~33–48 |

- **Los respaldos importan.** En 2 de las 8 pasadas el vehículo no alcanzó a cruzar la línea dentro de lo que se vio, y la dirección salió de `motion`, sin errores. La línea debe atravesar un tramo que el auto recorra completo dentro de la zona.
- **Costo.** El tracker de vehículos duplica o triplica el costo por cuadro en GPU. En CPU o en una RPi es un segundo modelo por cuadro, así que hay que medirlo en el benchmark de la Fase 5 (D5). Sin línea configurada no corre.
- **Latencia.** La espera de dirección suma ~0.3 s a la mediana.
- **Misma limitación que arriba:** 8 pasadas, de día, un ángulo (regla del 3).

**Cómo configurar la línea:**
1. En el panel de cámaras, menú de la cámara → **"Configurar LPR"** → sección **"Línea de dirección"** → **"Dibujar línea de dirección"** (o "Editar línea de dirección"). Se abre el lienzo sobre el video en vivo con la herramienta "Línea de dirección".
2. Marca **dos puntos** atravesando el carril, de lado a lado; el clic derecho cancela el primero. La línea debe tener cierto largo (≥ 0.05 normalizado) y quedar dentro del cuadro.
3. Revisa la **flecha "Salida →"**: debe apuntar hacia donde va el auto cuando **sale**. Si apunta al revés, usa **"Invertir sentido"**. Los extremos se pueden arrastrar.
4. Guarda. El worker toma la línea por pull en ≤ 60 s, sin reiniciar.

Sin línea, la dirección vuelve a inferirse por el tamaño de la patente.

**Convención** (contrato [`contracts/direction-line.cases.json`](../../contracts/direction-line.cases.json), probado en el worker y en el frontend):
- Coordenadas de imagen normalizadas 0–1, con x hacia la derecha e y hacia **abajo**.
- Con `d = to − from` y `v = p − from`, `cross = d.x·v.y − d.y·v.x`: `cross < 0` es el lado `left` y `cross > 0` el lado `right`. Son los lados de quien avanza de `from` a `to`.
- Ejemplos en pantalla: con una línea horizontal dibujada de izquierda a derecha, `left` es **arriba**; con una vertical dibujada hacia abajo, `left` es la **derecha** de la pantalla.
- Cruzar hacia `exitSide` es `exit`, y hacia el lado opuesto, `entry`. La UI calcula la flecha con la misma fórmula, así que basta con mirarla.

## Pasadas multicámara

Una **pasada** (`vehicle_passages`, D8) agrupa todas las lecturas de **una patente** en **un condominio**, vistas por **cualquier cámara**, dentro de una ventana deslizante de `LPR_PASSAGE_WINDOW_SECONDS`.
- **Una pasada tiene un solo intento de acceso.** Lo garantiza un índice único en la BD. Solo el líder de la pasada notifica, abre o escala al conserje. Las demás lecturas quedan como evidencia (`plate_detections.passageId`).
- **Serialización.** El reclamo de la pasada corre bajo `pg_advisory_xact_lock` por (condominio, patente). Dos cámaras que leen la misma patente a la vez producen **una** apertura.
- **Cámaras de registro y de acceso.** Si una cámara de acceso lee una pasada abierta por una de solo registro, la **promueve** y decide una sola vez, sobre el mismo intento.
- **Dirección de la pasada.** Una lectura con mejor fuente la corrige (`line` > `motion` > `camera` > `width`). Solo una lectura por **línea**, con el sentido opuesto al de la pasada (también por línea) y pasados `LPR_PASSAGE_REVERSE_MIN_SECONDS`, abre una pasada nueva dentro de la ventana: es el auto que entra y sale enseguida.
- **Trazabilidad.** El detalle del intento muestra la dirección, su fuente y **"Cámaras que vieron este paso"** (las últimas 10 lecturas, con imagen).

**Variables de entorno:**

| Variable | Dónde | Default | Qué hace |
|---|---|---|---|
| `LPR_PASSAGE_WINDOW_SECONDS` | backend | 60 (1–600) | Ventana deslizante en que las lecturas de una patente son la misma pasada |
| `LPR_PASSAGE_REVERSE_MIN_SECONDS` | backend | 15 (1–600) | Edad mínima de la pasada para que una dirección opuesta por línea abra otra |
| `LPR_PASSAGE_ORPHAN_SECONDS` | backend | 30 (1–600) | Una pasada sin intento cede el liderazgo tras este tiempo (el líder cayó o se colgó) |
| `LPR_DIRECTION_WAIT_SECONDS` | worker | 4 (0–30) | Cuánto espera una patente confirmada a que el vehículo cruce la línea; 0 = no esperar |
| `LPR_VEHICLE_MODEL` | worker | vacío = `lpr/yolo11n.pt` | Ruta **local** del modelo COCO para seguir vehículos. Nunca se descarga: si no existe, la dirección cae a los respaldos |

## Configuración LPR por cámara (`lprSettings`)

Cada cámara guarda su configuración de visión en `Camera.lprSettings` (D7). Si queda en `null`, se usan los defaults del env del worker. Hay dos formas de editarla:

- **UI:** en el panel de cámaras, abrir el menú de la cámara y elegir **"Configurar LPR"**. Requiere `cameras.enable-ia`; sin ese permiso aparece "Ver configuración LPR", solo de lectura. El diálogo tiene las secciones Política (modo y dirección), Detección (resolución y FPS), Recorte de la patente, Confirmación (lecturas), **"Dibujar zona de detección"**, que abre el lienzo sobre el video en vivo, y **"Línea de dirección"** (ver [Dirección por trayectoria](#dirección-por-trayectoria-bytetrack--línea)). "Restablecer valores por defecto" deja la config en `null`.
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
  "confirmReads": 3,
  "directionLine": { "from": { "x": 0.45, "y": 0.62 }, "to": { "x": 0.92, "y": 0.62 }, "exitSide": "left" }
}
```

- `zone` es un ejemplo: la zona real se **dibuja en el lienzo** y debe cubrir el portón y la entrada, no la calle.
- `directionLine` es la línea de la evaluación de D8 (salida = cruce hacia arriba en la imagen). También se dibuja en el lienzo, atravesando el carril que cubre la zona.
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
