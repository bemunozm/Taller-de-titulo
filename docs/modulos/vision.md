# Fase 3 — Modelos de visión: research y plan (D3/D5)

> Estado: 🟡 research hecho (2026-07-12), decisión **pendiente de benchmark propio**. Deep-research con verificación adversarial (23/25 claims confirmados, 2 refutados). Fuentes 2025–2026.

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

## Fuentes clave (2025–2026)
- YOLO26: arXiv 2509.25164, docs.ultralytics.com/models/yolo26, anuncio 14-ene-2026.
- RPi5 runtimes: docs.ultralytics.com/guides/raspberry-pi.
- INT8: arXiv 2506.09300 (YOLOv4-Tiny), arXiv 2303.05016.
- RF-DETR: arXiv 2511.09554, rfdetr.roboflow.com.
- OCR/ALPR: github.com/ankandrew/fast-plate-ocr, github.com/ankandrew/fast-alpr.
- VLM: roboflow playground (Gemini 2.5 Flash vs GPT-4o mini), MDPI J.Imaging 11(11):400.
- Patentes chilenas: Wikipedia "Vehicle registration plates of Chile".
