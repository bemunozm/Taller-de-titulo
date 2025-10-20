import os
import json
from PIL import Image
import logging


def save_image_pil(dirpath: str, filename: str, pil_img: Image.Image, quality: int = 85) -> str:
    os.makedirs(dirpath, exist_ok=True)
    path = os.path.join(dirpath, filename)
    try:
        pil_img.save(path, format='JPEG', quality=quality)
        return path
    except Exception:
        logging.exception('Error guardando imagen %s', path)
        raise


def save_ndarray_image(dirpath: str, filename: str, ndarr, quality: int = 90) -> str:
    from PIL import Image
    img = Image.fromarray(ndarr)
    return save_image_pil(dirpath, filename, img, quality=quality)


def save_json(dirpath: str, filename: str, data: dict) -> str:
    os.makedirs(dirpath, exist_ok=True)
    path = os.path.join(dirpath, filename)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return path
    except Exception:
        logging.exception('Error guardando json %s', path)
        raise
