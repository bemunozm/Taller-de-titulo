import requests
import logging


def post_event(backend_url: str, payload: dict, dry_run: bool = True) -> int:
    if dry_run:
        logging.info('DRY RUN - evento (no enviado): %s', payload)
        return 200
    try:
        resp = requests.post(backend_url, json=payload, timeout=5)
        logging.info('POST %s -> %s', backend_url, resp.status_code)
        return resp.status_code
    except Exception:
        logging.exception('Error POST hacia backend %s', backend_url)
        return -1
