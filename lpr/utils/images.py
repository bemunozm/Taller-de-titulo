from PIL import Image
import cv2
import numpy as np
import io
import base64


def frame_to_pil(img: np.ndarray) -> Image.Image:
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return Image.fromarray(img_rgb)


def pil_to_base64(img: Image.Image, quality: int = 80) -> str:
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=quality)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def pil_from_array(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(arr)
