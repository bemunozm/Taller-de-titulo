import os
import json
from PIL import Image
import logging
import requests
import base64
import hmac
import hashlib
import time
from urllib.parse import urlencode
from lpr.settings import settings


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


def upload_to_cloudinary(path: str, public_id: str = None) -> str:
    """Sube una imagen a Cloudinary usando la API REST y devuelve la URL.

    Requiere las env vars CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
    Si no están definidas lanza excepción.
    """
    cloud = settings.CLOUDINARY_CLOUD_NAME
    key = settings.CLOUDINARY_API_KEY
    secret = settings.CLOUDINARY_API_SECRET
    if not cloud or not key or not secret:
        raise RuntimeError('Cloudinary no configurado (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)')

    # retries/backoff configurables vía env
    try:
        retries = int(settings.CLOUDINARY_UPLOAD_RETRIES)
    except Exception:
        retries = 3
    try:
        base_backoff = float(settings.CLOUDINARY_RETRY_BACKOFF)
    except Exception:
        base_backoff = 1.0

    url = f'https://api.cloudinary.com/v1_1/{cloud}/image/upload'

    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            timestamp = int(time.time())
            params = {'timestamp': timestamp}
            if public_id:
                params['public_id'] = public_id

            # signature: sorted params joined by '&' + secret
            to_sign = '&'.join(f"{k}={params[k]}" for k in sorted(params))
            signature = hashlib.sha1((to_sign + secret).encode('utf-8')).hexdigest()

            with open(path, 'rb') as f:
                files = {'file': f}
                data = {'api_key': key, 'timestamp': timestamp, 'signature': signature}
                if public_id:
                    data['public_id'] = public_id
                resp = requests.post(url, data=data, files=files, timeout=10)
                resp.raise_for_status()
                j = resp.json()
                return j.get('secure_url') or j.get('url')
        except Exception as e:
            last_exc = e
            logging.warning('Cloudinary upload attempt %d/%d failed for %s: %s', attempt, retries, path, e)
            if attempt < retries:
                backoff = base_backoff * (2 ** (attempt - 1))
                time.sleep(backoff)
            else:
                logging.exception('All Cloudinary upload attempts failed for %s', path)
    # Si llegamos aquí, todos los intentos fallaron
    raise last_exc
