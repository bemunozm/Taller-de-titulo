"""Launcher para el Worker Manager.

Este script arranca la app FastAPI definida en `lpr.api.manager` usando uvicorn.
Mantener el lanzador en la raíz permite configurar opciones (host/port, reload)
y mantener `lpr.api.manager` exclusivamente como definición de rutas y eventos.

Uso:
  python -m lpr.manager [--host HOST] [--port PORT] [--reload]

O con uvicorn directamente:
  uvicorn lpr.api.manager:APP --host 0.0.0.0 --port 8000

"""

from importlib import import_module
import os
import sys
from pathlib import Path
import argparse
from lpr.settings import settings

def load_app():
  try:
    mod = import_module('lpr.api.manager')
    return getattr(mod, 'APP')
  except Exception as e:
    # Intento de reparación automática: si la importación falló porque
    # el script fue ejecutado desde dentro de la carpeta `lpr/`, añadimos
    # la carpeta padre (raíz del proyecto) a sys.path y reintentamos.
    err_msg = str(e)
    try:
      if isinstance(e, ModuleNotFoundError) and 'lpr' in err_msg:
        this_file = Path(__file__).resolve()
        project_root = this_file.parent.parent
        project_root_str = str(project_root)
        if project_root_str not in sys.path:
          sys.path.insert(0, project_root_str)
        # reintentar import una vez
        mod = import_module('lpr.api.manager')
        return getattr(mod, 'APP')
    except Exception:
      # si el reintento también falla, caemos al fallback
      pass

    # fallback mínimo: crear una app sencilla para evitar crash
    from fastapi import FastAPI
    app = FastAPI(title='LPR Worker Manager (stub)')

    @app.get('/')
    def index():
      return {'ok': True, 'note': f'manager module not available: {err_msg}'}

    return app


def main(argv=None):
  argv = argv if argv is not None else sys.argv[1:]
  parser = argparse.ArgumentParser(prog='lpr.manager')
  parser.add_argument('--host', default=settings.WORKER_MANAGER_HOST)
  parser.add_argument('--port', type=int, default=int(settings.WORKER_MANAGER_PORT))
  parser.add_argument('--reload', action='store_true', default=bool(settings.WORKER_MANAGER_RELOAD))
  parser.add_argument('--workers', type=int, default=int(settings.WORKER_MANAGER_WORKERS))
  args = parser.parse_args(argv)

  app = load_app()

  # run with uvicorn programmatically
  try:
    import uvicorn
  except Exception:
    print('uvicorn is required to run the manager. Install with: pip install uvicorn[standard]', file=sys.stderr)
    raise

  uvicorn.run(app, host=args.host, port=args.port, reload=args.reload, workers=args.workers)


if __name__ == '__main__':
  main()
