#!/usr/bin/env python3
"""
Script de compatibilidad que permite ejecutar el worker con la misma sintaxis antigua:

    python execute_worker "rtsp://..." "camera-id" "http://backend/..." 1.0

Si no se pasan argumentos, se delega en `lpr.cli.main()` que leerá las variables de entorno.
"""
import sys


def _run_from_args_or_env():
    # Import robusto de `main` desde lpr.cli.
    # Intentamos en este orden:
    # 1) import relativo (cuando se ejecuta como paquete: python -m lpr.execute_worker)
    # 2) import absoluto (cuando el paquete lpr está en sys.path)
    # 3) fallback: añadir el padre del paquete al sys.path e importar por nombre
    try:
        # cuando se importa como paquete (python -m lpr.execute_worker)
        from .cli import main  # type: ignore
    except Exception:
        try:
            # import absoluto habitual
            from lpr.cli import main  # type: ignore
        except Exception:
            import os
            import sys
            import importlib
            script_dir = os.path.dirname(__file__)
            parent_dir = os.path.abspath(os.path.join(script_dir, os.pardir))
            if parent_dir not in sys.path:
                sys.path.insert(0, parent_dir)
            try:
                main = importlib.import_module('lpr.cli').main
            except Exception as e:
                print('Error importando lpr.cli (fallback):', e)
                raise

    args = sys.argv[1:]
    if not args:
        # delegar a la lectura de env vars
        main()
        return

    rtsp = args[0]
    camera_id = args[1] if len(args) > 1 else None
    backend = args[2] if len(args) > 2 else None
    poll_interval = None
    if len(args) > 3:
        try:
            poll_interval = float(args[3])
        except Exception:
            poll_interval = None

    main(rtsp, camera_id, backend, poll_interval)


if __name__ == '__main__':
    _run_from_args_or_env()
