#!/usr/bin/env bash
# =============================================================================
# scripts/gate.sh — gate local de Vigilia (Fase 4 · P8.C)
# =============================================================================
# Corre en local lo mismo que bloquea en CI (.github/workflows/ci.yml), en orden:
#   1. backend: typecheck, build, test (unit) y migration:run + migration:check
#      contra una BD TEMPORAL creada en el Postgres local y borrada al final
#      (scripts/gate-db.cjs; la BD de desarrollo no se toca)
#   2. vigilia-hub: typecheck, test (con umbral de cobertura) y build
#   3. frontend: test:run y build
#   4. lpr: python -m pytest lpr/tests
#   5. con --with-e2e: npm --prefix backend run test:e2e
# Lint y `npm audit` no se corren aquí: en CI son no bloqueantes.
#
# Uso (Git Bash en Windows o Linux, desde cualquier carpeta):
#   bash scripts/gate.sh [--with-e2e] [--require-db] [-h|--help]
#
# Detalle, variables y requisitos: scripts/README.md.
# Salida: resumen OK/FAIL/SKIP por paso; código 0 si ningún paso falló, 1 si no.
# =============================================================================
set -uo pipefail

usage() {
  cat <<'EOF'
Uso: bash scripts/gate.sh [--with-e2e] [--require-db] [-h|--help]

  --with-e2e    agrega los e2e del backend (npm --prefix backend run test:e2e)
  --require-db  sin Postgres disponible, las migraciones cuentan como FAIL
                (por defecto se marcan SKIP y el gate sigue)

Variables: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD (Postgres local; por defecto
las de backend/.env), VIGILIA_ALLOW_REMOTE_TEST_DB=true (permite un DB_HOST no
local) y PYTHON (intérprete >= 3.11 para el LPR).
EOF
}

WITH_E2E=0
REQUIRE_DB=0
for arg in "$@"; do
  case "$arg" in
    --with-e2e) WITH_E2E=1 ;;
    --require-db) REQUIRE_DB=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Raíz del repo sin depender del `cd` del perfil (fnm lo redefine en shells
# interactivos). En Git Bash, `pwd -W` da la ruta Windows (C:/...), que entiende
# node/npm; en Linux no existe y se usa `pwd`.
ROOT="$(builtin cd "$(dirname "${BASH_SOURCE[0]}")/.." && { pwd -W 2>/dev/null || pwd; })"
BACKEND="$ROOT/backend"
HUB="$ROOT/vigilia-hub"
FRONTEND="$ROOT/frontend"
LPR_TESTS="$ROOT/lpr/tests"
GATE_DB="$ROOT/scripts/gate-db.cjs"

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi

STEP_NAMES=()
STEP_RESULTS=()
STEP_SECONDS=()

record() {
  STEP_NAMES+=("$1")
  STEP_RESULTS+=("$2")
  STEP_SECONDS+=("$3")
}

header() {
  printf '\n%s==> %s%s\n' "$BOLD" "$1" "$RESET"
}

warn() {
  printf '%s[gate] %s%s\n' "$YELLOW" "$1" "$RESET" >&2
}

# run_step "<nombre>" <comando...>: corre el comando y registra OK/FAIL.
run_step() {
  local name="$1"
  shift
  header "$name"
  local start=$SECONDS
  if "$@"; then
    record "$name" OK $((SECONDS - start))
    return 0
  fi
  record "$name" FAIL $((SECONDS - start))
  return 1
}

skip_step() {
  header "$1"
  warn "SKIP: $2"
  record "$1" SKIP 0
}

fail_step() {
  header "$1"
  printf '%s[gate] FAIL: %s%s\n' "$RED" "$2" "$RESET" >&2
  record "$1" FAIL 0
}

# Sin node_modules el proyecto no se puede verificar: un FAIL claro en vez de
# varios errores confusos.
has_deps() {
  local project_dir="$1" label="$2"
  if [[ -d "$project_dir/node_modules" ]]; then
    return 0
  fi
  fail_step "$label: dependencias" "falta $project_dir/node_modules (corre: npm --prefix \"$project_dir\" ci)"
  return 1
}

# --- BD temporal para las migraciones ----------------------------------------
TEMP_DB=""

drop_temp_db() {
  if [[ -n "$TEMP_DB" ]]; then
    if node "$GATE_DB" drop "$TEMP_DB"; then
      echo "[gate] BD temporal $TEMP_DB borrada"
    else
      warn "no se pudo borrar la BD temporal $TEMP_DB: bórrala a mano"
    fi
    TEMP_DB=""
  fi
}

trap drop_temp_db EXIT
trap 'warn "interrumpido"; exit 130' INT TERM

backend_migrations() {
  header "backend: BD temporal para migraciones"
  local output status
  output="$(node "$GATE_DB" create)"
  status=$?
  if [[ $status -eq 3 ]]; then
    if [[ $REQUIRE_DB -eq 1 ]]; then
      fail_step "backend: migraciones" "Postgres no disponible y se pidió --require-db (levántalo: docker compose -f backend/docker-compose.yml up -d postgres)"
    else
      skip_step "backend: migraciones" "Postgres no disponible (levántalo: docker compose -f backend/docker-compose.yml up -d postgres)"
    fi
    return
  fi
  # 4: DB_HOST no es local (candado de gate-db.cjs, Fase 4 · P9). Es FAIL, no
  # SKIP: el gate no crea ni borra bases fuera de este equipo.
  if [[ $status -eq 4 ]]; then
    fail_step "backend: migraciones" "DB_HOST no es local: el gate no crea bases en un Postgres remoto (usa uno local o VIGILIA_ALLOW_REMOTE_TEST_DB=true)"
    return
  fi
  if [[ $status -ne 0 ]]; then
    fail_step "backend: migraciones" "no se pudo crear la BD temporal"
    return
  fi
  TEMP_DB="$(printf '%s\n' "$output" | tail -n 1)"
  echo "[gate] BD temporal: $TEMP_DB"

  # DB_SYNCHRONIZE=false: con synchronize, TypeORM crearía el esquema solo y
  # las migraciones no se estarían probando.
  if run_step "backend: migration:run (BD temporal)" \
    env DB_NAME="$TEMP_DB" DB_SYNCHRONIZE=false npm --prefix "$BACKEND" run migration:run; then
    run_step "backend: migration:check (drift)" \
      env DB_NAME="$TEMP_DB" DB_SYNCHRONIZE=false npm --prefix "$BACKEND" run migration:check
  else
    skip_step "backend: migration:check (drift)" "migration:run falló"
  fi
  drop_temp_db
}

# --- Python para el LPR -------------------------------------------------------
find_python() {
  local candidates=()
  if [[ -n "${PYTHON:-}" ]]; then
    candidates=("$PYTHON")
  else
    candidates=(python3 python py)
  fi
  local candidate
  for candidate in "${candidates[@]}"; do
    command -v "$candidate" > /dev/null 2>&1 || continue
    # Descarta el alias de la Microsoft Store (python3.exe) y versiones viejas.
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' > /dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

lpr_tests() {
  local python
  if ! python="$(find_python)"; then
    fail_step "lpr: pytest" "no hay Python >= 3.11 (define PYTHON=/ruta/al/python)"
    return
  fi
  if ! "$python" -c 'import pytest, fastapi, httpx, cv2, numpy, PIL, requests, pydantic_settings' > /dev/null 2>&1; then
    fail_step "lpr: pytest" "faltan dependencias de test en $python (pip install -r lpr/requirements-ci.txt, idealmente en un venv)"
    return
  fi
  run_step "lpr: pytest" "$python" -m pytest "$LPR_TESTS" -q -p no:cacheprovider
}

# --- Ejecución -----------------------------------------------------------------
echo "${BOLD}Gate de Vigilia${RESET} (raíz: $ROOT)"
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' 2> /dev/null; then
  warn "Node $(node -v 2> /dev/null || echo 'no encontrado') < 22.12: usa la versión de .nvmrc (better-auth requiere require(esm))"
fi

if has_deps "$BACKEND" "backend"; then
  run_step "backend: typecheck" npm --prefix "$BACKEND" run typecheck
  run_step "backend: build" npm --prefix "$BACKEND" run build
  run_step "backend: test (unit)" npm --prefix "$BACKEND" test -- --ci
  backend_migrations
fi

if has_deps "$HUB" "vigilia-hub"; then
  run_step "vigilia-hub: typecheck" npm --prefix "$HUB" run typecheck
  run_step "vigilia-hub: test (+ umbral de cobertura)" npm --prefix "$HUB" run test:coverage -- --ci
  run_step "vigilia-hub: build" npm --prefix "$HUB" run build
fi

if has_deps "$FRONTEND" "frontend"; then
  run_step "frontend: test:run" npm --prefix "$FRONTEND" run test:run
  run_step "frontend: build" npm --prefix "$FRONTEND" run build
fi

lpr_tests

if [[ $WITH_E2E -eq 1 ]]; then
  if [[ -d "$BACKEND/node_modules" ]]; then
    run_step "backend: test:e2e" npm --prefix "$BACKEND" run test:e2e
  else
    fail_step "backend: test:e2e" "falta $BACKEND/node_modules"
  fi
fi

# --- Resumen ---------------------------------------------------------------------
ok=0
failed=0
skipped=0
printf '\n%s================ Resumen del gate ================%s\n' "$BOLD" "$RESET"
for i in "${!STEP_NAMES[@]}"; do
  case "${STEP_RESULTS[$i]}" in
    OK) color="$GREEN"; ok=$((ok + 1)) ;;
    FAIL) color="$RED"; failed=$((failed + 1)) ;;
    *) color="$YELLOW"; skipped=$((skipped + 1)) ;;
  esac
  printf '%s%-5s%s %-48s %5ss\n' "$color" "${STEP_RESULTS[$i]}" "$RESET" "${STEP_NAMES[$i]}" "${STEP_SECONDS[$i]}"
done
printf -- '--------------------------------------------------\n'
printf '%d OK, %d FAIL, %d SKIP en %ss\n' "$ok" "$failed" "$skipped" "$SECONDS"
if [[ $WITH_E2E -eq 0 ]]; then
  echo "(sin e2e: agrega --with-e2e para correrlos)"
fi
if [[ $skipped -gt 0 ]]; then
  warn "gate INCOMPLETO: hay pasos en SKIP"
fi

if [[ $failed -gt 0 ]]; then
  exit 1
fi
exit 0
