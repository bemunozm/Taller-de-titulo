# LPR worker PoC (carpeta raíz)

Este directorio contiene un PoC (Python) para reconocimiento de patentes (LPR) usando los modelos de Hugging Face:

- Detector: morsetechlab/yolov11-license-plate-detection
- OCR: DunnBC22/trocr-base-printed_license_plates_ocr

Descripción:
- `lpr_worker.py` conecta a una URL RTSP (p. ej. el mountPath en MediaMTX) y cada N segundos captura un frame.
- Usa YOLOv11 para detectar bounding boxes de placas, luego recorta y pasa esas imágenes a TroCR para OCR.
- Envía un POST al backend con los resultados (JSON con snapshot base64, bbox, scores, texto).

Requisitos (Windows PowerShell):

1. Crear un venv y activar

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Instalar dependencias

```powershell
pip install -r requirements.txt
```

Ejecutar PoC:

```powershell
python lpr_worker.py "rtsp://127.0.0.1:8554/your_mount" "camera-01" "http://127.0.0.1:3000/lpr/events" 1.0
```

Notas y mejoras sugeridas:
- Para producción: usar ffmpeg input pipe en lugar de VideoCapture, manejar reconexiones y watchdog.
- Batching y uso de GPU: procesar múltiples recortes por batch para aprovechar la GPU en TroCR.
- Pre-filtrado por movimiento para ahorrar cómputo.
- Deduplicación y tolerancia a falsos positivos: agrupar lecturas por ventana temporal.
- En producción conviene subir snapshots a S3/MinIO y guardar solo URL en DB.

Limitaciones de este PoC:
- No calcula una probabilidad real del OCR; TroCR no expone confidence directamente en este wrapper.
- El modelo YOLOv11 en HF puede requerir descargar el checkpoint localmente (ultralytics) — adapta si es necesario.
