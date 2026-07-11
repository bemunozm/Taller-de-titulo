#!/usr/bin/env sh
# Auto-sync de todos los sub-indices de CodeGraph del workspace.
# Lee codegraph.workspace.json (campo .projects[].path) y corre `codegraph sync -q`
# en cada subproyecto. Pensado para ser invocado por git hooks o a mano.
#
# Uso:  ./codegraph-sync-all.sh          (silencioso, para hooks)
#       ./codegraph-sync-all.sh -v       (verbose)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$ROOT/codegraph.workspace.json"

VERBOSE=""
[ "$1" = "-v" ] && VERBOSE="1"

if ! command -v codegraph >/dev/null 2>&1; then
  [ -n "$VERBOSE" ] && echo "[codegraph] CLI no encontrado en PATH, se omite sync"
  exit 0
fi

# Extrae los paths de projects[].path del manifest sin depender de jq.
PROJECTS=$(grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST" 2>/dev/null | sed 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ -z "$PROJECTS" ]; then
  # Fallback: subproyectos por defecto
  PROJECTS="backend
frontend
lpr
vigilia-hub"
fi

# Sync del indice raiz unificado primero (si existe)
if [ -d "$ROOT/.codegraph" ]; then
  if [ -n "$VERBOSE" ]; then
    echo "[codegraph] sync . (indice raiz)"
    codegraph sync "$ROOT" || echo "[codegraph] sync fallo en raiz (continuo)"
  else
    codegraph sync -q "$ROOT" >/dev/null 2>&1 || true
  fi
fi

echo "$PROJECTS" | while IFS= read -r p; do
  [ -z "$p" ] && continue
  if [ -d "$ROOT/$p/.codegraph" ]; then
    if [ -n "$VERBOSE" ]; then
      echo "[codegraph] sync $p"
      codegraph sync "$ROOT/$p" || echo "[codegraph] sync fallo en $p (continuo)"
    else
      codegraph sync -q "$ROOT/$p" >/dev/null 2>&1 || true
    fi
  fi
done

[ -n "$VERBOSE" ] && echo "[codegraph] sync-all completo"
exit 0
