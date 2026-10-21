# scripts/

## `gate.sh` — gate local (Fase 4 · P8.C)

Corre en local lo mismo que bloquea en CI (`.github/workflows/ci.yml`) y
termina con un resumen `OK` / `FAIL` / `SKIP` por paso. Sale con código 1 si
algún paso falló.

```bash
bash scripts/gate.sh                 # backend, hub, frontend y lpr (sin e2e)
bash scripts/gate.sh --with-e2e      # + e2e del backend (los corre el Gate P9)
bash scripts/gate.sh --require-db    # sin Postgres, las migraciones son FAIL y no SKIP
```

Funciona en Git Bash (Windows) y en Linux, desde cualquier carpeta: usa
`npm --prefix` y no depende del `cd` del perfil (fnm lo redefine).

**Orden de los pasos**

1. backend:
   - `typecheck`, `build` y `test` (unit);
   - `migration:run` + `migration:check` contra una **BD temporal**
     (`vigilia_gate_*`) que `gate-db.cjs` crea en el Postgres local y borra al
     terminar, también si cortas con Ctrl+C. La BD de desarrollo no se toca.
2. vigilia-hub: `typecheck`, `test:coverage` (aplica el umbral de
   `jest.config.js`) y `build`.
3. frontend: `test:run` y `build` (el build tarda varios minutos).
4. lpr: `python -m pytest lpr/tests`.
5. Solo con `--with-e2e`: `npm --prefix backend run test:e2e`.

Lint y `npm audit` no se corren: en CI son no bloqueantes.

**Requisitos**

- Node >= 22.12 (`.nvmrc`). Con una versión menor, el gate avisa.
- `node_modules` en `backend/`, `vigilia-hub/` y `frontend/` (`npm --prefix <proyecto> ci`).
- Postgres para las migraciones (y los e2e):
  - `docker compose -f backend/docker-compose.yml up -d postgres` (puerto 5455);
  - conexión: `DB_HOST`, `DB_PORT`, `DB_USER` y `DB_PASSWORD` del entorno o, si
    faltan, de `backend/.env`; el usuario necesita permiso para crear bases;
  - el Postgres debe ser **local** (`localhost`, `127.0.0.0/8` o `::1`): ver
    [Candado de host local](#candado-de-host-local). Con un `DB_HOST` remoto,
    las migraciones quedan en `FAIL` (no en `SKIP`);
  - si no hay Postgres, las migraciones quedan en `SKIP`, el gate sigue y
    avisa "gate INCOMPLETO".
- Python >= 3.11 con las dependencias de test del LPR. Se recomienda un venv:

  ```bash
  python -m venv ~/.venvs/vigilia-lpr      # fuera del repo
  ~/.venvs/vigilia-lpr/Scripts/python -m pip install -r lpr/requirements-ci.txt
  PYTHON=~/.venvs/vigilia-lpr/Scripts/python bash scripts/gate.sh
  # En Linux: ~/.venvs/vigilia-lpr/bin/python
  ```

  Sin `PYTHON`, el gate busca `python3`, `python` o `py` (>= 3.11).

## E2E del backend (Fase 4 · P8.B)

`npm --prefix backend run test:e2e` compila y corre los e2e de caja negra
(`backend/test/e2e`). Si ya compilaste, usa `test:e2e:run`. El `globalSetup`:

- crea una BD `vigilia_e2e_*` y la migra;
- arranca `dist/main.js` con un env generado en memoria, con OpenAI y SMTP
  falsos y locales;
- siembra el super-admin.

Al terminar borra la BD y mata los procesos. Variables opcionales:

| Variable | Uso |
|---|---|
| `E2E_DATABASE_URL` | `postgres://usuario:clave@host:5432/postgres`. Tiene prioridad sobre `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD` del entorno, que a su vez tienen prioridad sobre `backend/.env` (del que solo se toma la conexión). La BD del path es la de mantenimiento: se puede cambiar con `E2E_ADMIN_DATABASE` (default `postgres`). Su host también debe ser local (ver abajo). |
| `VIGILIA_ALLOW_REMOTE_TEST_DB` | `true`: permite un Postgres **no local** (ver [Candado de host local](#candado-de-host-local)). Sin definir, el harness se niega. |
| `E2E_KEEP_DATABASE` | `true`: no borra la BD de la corrida, para inspeccionarla. Bórrala a mano después. |
| `E2E_BACKEND_LOG_LEVEL` | `LOG_LEVEL` de la app de prueba (default `warn`; `debug` para diagnosticar). |
| `E2E_ARTIFACTS_DIR` | Dónde quedan `backend.log`, `migrations.log` y `seed-admin.log` de cada corrida (default: temporal del SO, `vigilia-e2e/<corrida>`). |
| `E2E_BOOT_TIMEOUT_MS` | Espera máxima a que la app responda (default `60000`). |

## `gate-db.cjs`

Helper del gate: `node scripts/gate-db.cjs create` crea la BD temporal e
imprime su nombre; `drop <nombre>` la borra. Solo acepta nombres
`vigilia_gate_*`. Usa `pg` y `dotenv` de `backend/node_modules`.

Códigos de salida:

| Código | Significado | El gate lo marca |
|---|---|---|
| 0 | ok | — |
| 1 | otro error (p. ej. sin permiso para crear bases) | `FAIL` |
| 3 | Postgres no disponible | `SKIP` (`FAIL` con `--require-db`) |
| 4 | `DB_HOST` no es local (candado) | `FAIL` |

## Candado de host local

Los e2e (`backend/test/e2e/harness/database.ts`) y `gate-db.cjs` **crean,
migran y borran** bases en el Postgres que resuelven. Si `backend/.env`
apuntara a un servidor remoto (por ejemplo, el Postgres del piloto), lo
harían ahí. Por eso solo aceptan un host local:

- `localhost`, `127.0.0.0/8` o `::1` (también `::ffff:127.x.y.z` y `[::1]`);
- un socket Unix (ruta absoluta en `DB_HOST`).

El candado se aplica venga de donde venga la conexión: `E2E_DATABASE_URL`,
`DB_*` del entorno o `backend/.env`. Un host que no es local se rechaza con
un mensaje que nombra el host (nunca la contraseña). No se resuelve DNS: un
nombre como `postgres` (el service de un docker compose) cuenta como remoto.

Para usar un Postgres remoto **a propósito**, define
`VIGILIA_ALLOW_REMOTE_TEST_DB=true`. CI no lo necesita: usa `localhost`
(`.github/workflows/ci.yml`).
