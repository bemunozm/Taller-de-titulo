# Documentación de Deployment - Vigilia Hub

## 🏗️ Arquitectura de Deployment

```
┌─────────────────────────────────────────────────────────────────┐
│                         INFRAESTRUCTURA                          │
└─────────────────────────────────────────────────────────────────┘

                Internet
                   │
                   │ HTTPS
                   ▼
          ┌────────────────┐
          │  Cloud Backend │
          │   NestJS API   │
          │  (AWS/GCP/...)  │
          └────────┬───────┘
                   │
                   │ WebSocket (Port 3000)
                   │ HTTPS REST
                   │
    ┌──────────────┴──────────────┐
    │                             │
    │  Red Local Condominio       │
    │  (192.168.1.0/24)           │
    │                             │
    ├─────────────────────────────┼──────────────────┐
    │                             │                  │
    ▼                             ▼                  ▼
┌───────────────┐      ┌──────────────────┐    [Otros Hubs]
│ Raspberry Pi 3│      │   Router WiFi    │
│  Vigilia Hub  │◄─────┤   (Gateway)      │
│  10.0.0.50    │      │   10.0.0.1       │
└───────┬───────┘      └──────────────────┘
        │
        │ GPIO
        │
        ▼
┌───────────────────┐
│  Citófono AIPHONE │
│     GT System     │
│                   │
│  - GT-DB Panel    │
│  - GT-NSB Station │
│  - GT-10K Keypad  │
│  - GT-BC Audio    │
└───────────────────┘
```

---

## 🌐 Topología de Red

### Opción 1: Conexión Directa a Internet (Recomendada)

```
Internet ─► Router ─► Switch ─┬─► Raspberry Pi 3 (WiFi/Ethernet)
                              ├─► Otros dispositivos
                              └─► Backend (Cloud/Local)
```

**Ventajas:**
- Menor latencia
- Conexión estable
- Fácil de configurar

**Configuración:**
```bash
# /etc/dhcpcd.conf
interface eth0
static ip_address=192.168.1.50/24
static routers=192.168.1.1
static domain_name_servers=8.8.8.8 8.8.4.4
```

### Opción 2: Red Aislada con Gateway

```
Internet ─► Firewall ─► Red DMZ ─► Raspberry Pi 3
                           │
                           └─► VPN Tunnel ─► Backend
```

**Ventajas:**
- Mayor seguridad
- Aislamiento de red
- Control de tráfico

**Requiere:**
- VPN (WireGuard, OpenVPN)
- Firewall rules
- Gestión de certificados

---

## 🖥️ Configuración del Backend

### Variables de Entorno Backend

```bash
# .env en backend NestJS (ver backend/.env.example)

PORT=3000

# Orígenes del WebSocket: los controla VigiliaIoAdapter con FRONTEND_URL
# (https:// obligatorio en producción). NO existe WEBSOCKET_CORS_ORIGIN ni
# se usa "*". El hub es un cliente Node sin cabecera Origin: el adapter lo
# acepta, pero igual debe autenticarse en el namespace /hub (ver
# "Autenticación del Backend").
FRONTEND_URL=https://app.vigilia.example.cl

# Database
DB_HOST=localhost
DB_PORT=5455
DB_USER=...
DB_PASSWORD=...
DB_NAME=...
```

> El hub **no** usa un `HUB_SECRET` en el `.env` del backend: cada hub tiene su
> propio secret, que se crea al provisionarlo y del que el backend solo guarda
> el hash (sección "Autenticación del Backend").

### Firewall Rules (Backend)

```bash
# Permitir conexiones del Hub
sudo ufw allow from 192.168.1.50 to any port 3000

# O si es IP pública del backend
sudo ufw allow 3000/tcp
```

---

## 📡 Configuración de Raspberry Pi

### IP Estática (Recomendada)

```bash
# /etc/dhcpcd.conf
interface wlan0  # O eth0 para Ethernet
static ip_address=192.168.1.50/24
static routers=192.168.1.1
static domain_name_servers=8.8.8.8 1.1.1.1

# Aplicar cambios
sudo systemctl restart dhcpcd
```

### DNS

```bash
# /etc/resolv.conf
nameserver 8.8.8.8
nameserver 8.8.4.4
```

### NTP (Sincronización de tiempo)

```bash
# Verificar NTP
timedatectl status

# Si no está sincronizado
sudo systemctl enable systemd-timesyncd
sudo systemctl start systemd-timesyncd
```

---

## 🔐 Seguridad

### 1. SSH Hardening

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
Port 2222  # Cambiar puerto por defecto

# Aplicar
sudo systemctl restart ssh
```

### 2. Firewall Local

```bash
# Instalar UFW
sudo apt install -y ufw

# Reglas básicas
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 2222/tcp  # SSH
sudo ufw enable

# Verificar
sudo ufw status
```

### 3. Autenticación del Backend

Cada hub tiene su **propio secret**; no hay un `HUB_SECRET` global compartido.

**Provisionar un hub** (una vez por equipo), con un usuario con el permiso
`platform.manage-hubs` (Super Administrador):

```bash
curl -X POST https://vigilia.example.cl/api/v1/hubs \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
    "hubId": "hub-main-entrance",
    "location": "Edificio A - Panel de Calle",
    "organizationId": "<uuid del condominio>",
    "type": "physical-hub",
    "description": "opcional"
  }'
```

- `hubId`: letras, números, `-` y `_` (máx. 64); es el `HUB_ID` del `.env`.
- `type` es opcional: `physical-hub` (default, Raspberry Pi con relés) o
  `web-kiosk` (totem web, sin relés). `description` es opcional (máx. 128).
- Un hub sirve a **un** condominio (`organizationId`); sin él el citófono no
  ve unidades ni residentes.
- La respuesta incluye `secret` en texto plano **una sola vez**: cópialo al
  `HUB_SECRET` del `.env` de ese hub (`chmod 600`). En la base de datos solo
  queda `secretHash`; si se pierde, no hay forma de recuperarlo, hay que rotarlo.

**Rotar el secret** (pérdida o sospecha de compromiso):

```bash
curl -X POST https://vigilia.example.cl/api/v1/hubs/hub-main-entrance/rotate-secret \
  -H "Authorization: Bearer <token>"
```

Invalida el secret anterior, **desconecta el socket** del hub y devuelve el
nuevo secret (también una sola vez). Actualiza el `.env` del hub y reinicia
`vigilia-hub`. Desactivar el hub o cambiar su `type` / `organizationId`
(`PATCH /api/v1/hubs/:hubId`) también corta su socket.

**Cómo se autentica el hub:**

- WebSocket: se conecta al namespace `/hub` con
  `auth: { hubId, hubSecret }`; el backend lo valida en el middleware del
  namespace contra el `secretHash` del hub activo, antes de aceptar la conexión.
- HTTP (`/concierge/*`, `/units/ai-enabled`): cabeceras `X-Hub-Id` y
  `X-Hub-Secret`, que `HubAuthGuard` verifica contra ese mismo hub.
- Los orígenes del socket los controla `VigiliaIoAdapter` con `FRONTEND_URL`
  (el hub, al no ser un navegador, no envía `Origin`).

Referencia: `backend/src/hub/hub.controller.ts`, `hub.gateway.ts` y
`guards/hub-auth.guard.ts`.

### 4. TLS/SSL

Desde la Fase 4 · P6.M el hub **exige** `https://` en producción
(`src/config.ts`): con `NODE_ENV=production` (o `staging`, o sin `NODE_ENV`)
no arranca si `BACKEND_URL` es `http://`. El WebSocket usa `wss://`, derivado
de la misma URL. Ver la sección siguiente para la LAN del piloto.

### 5. TLS en la LAN del piloto

En el piloto el backend corre en un servidor de la LAN del condominio, sin
nombre público. El hub habla con él por TLS a través de un **reverse proxy con
certificado** delante del backend (Node no termina TLS):

```
Raspberry (vigilia-hub) ──https/wss──▶ reverse proxy :443 ──http──▶ backend 127.0.0.1:3000
```

1. **Nombre y certificado.** Elige un nombre estable para el servidor (p. ej.
   `vigilia.lan`, resuelto por el DNS del router o en `/etc/hosts` de la
   Raspberry) y emite un certificado para ese nombre:
   - con una **CA propia** (p. ej. `step-ca`, `mkcert` o la CA interna de
     Caddy: `tls internal`), o
   - con un dominio público y desafío DNS de Let's Encrypt (sin abrir puertos).
2. **Reverse proxy** (Caddy o nginx) en el servidor:
   - escucha en `:443` y reenvía a `http://127.0.0.1:3000`;
   - reenvía el *upgrade* de WebSocket (`/socket.io/`, namespaces `/` y `/hub`);
   - **no** expone `/api/v1/internal/` (lo usa solo MediaMTX, por loopback);
   - en el backend: `TRUST_PROXY=1`.

   Ejemplo con Caddy y CA interna:

   ```caddyfile
   vigilia.lan {
     tls internal
     @internal path /api/v1/internal/*
     respond @internal 404
     reverse_proxy 127.0.0.1:3000
   }
   ```
3. **Confianza en la Raspberry** (solo si la CA es propia). Copia el
   certificado **raíz** de la CA (no la clave) a `/etc/vigilia/ca.crt` y
   agrégalo a la unidad systemd:

   ```ini
   Environment="NODE_EXTRA_CA_CERTS=/etc/vigilia/ca.crt"
   ```

   Node lo lee al arrancar y lo usan tanto `axios` (HTTPS) como socket.io
   (`wss`). **Nunca** uses `NODE_TLS_REJECT_UNAUTHORIZED=0`.
4. **`.env` del hub:** `NODE_ENV=production` y `BACKEND_URL=https://vigilia.lan`
   (solo el origen, sin `/api/v1`).
5. **Verificación** (en la Raspberry):

   ```bash
   # Cadena válida para el nombre: "Verify return code: 0 (ok)"
   openssl s_client -connect vigilia.lan:443 -servername vigilia.lan \
     -CAfile /etc/vigilia/ca.crt </dev/null | grep "Verify return code"

   # El backend responde por HTTPS con la CA y acepta la credencial del hub:
   # HTTP 200 con {hubId, type, organizationId}; 401 si hubId/secret son
   # incorrectos (límite: 10/min). No hay un /health público: este endpoint
   # valida TLS y credencial a la vez. Las credenciales se leen del .env y el
   # secret viaja por stdin (no queda en el historial ni en `ps`).
   HUB_ID=$(grep '^HUB_ID=' /opt/vigilia-hub/.env | cut -d= -f2-)
   grep '^HUB_SECRET=' /opt/vigilia-hub/.env | sed 's/^HUB_SECRET=/X-Hub-Secret: /' \
     | curl -sS --cacert /etc/vigilia/ca.crt https://vigilia.lan/api/v1/concierge/device \
         -H "X-Hub-Id: $HUB_ID" -H @- -w '\nHTTP %{http_code}\n'

   # Node confía en la CA igual que el hub (cualquier respuesta HTTP, incluso 401,
   # prueba que el TLS valida; un error de certificado lanza excepción)
   NODE_EXTRA_CA_CERTS=/etc/vigilia/ca.crt node -e \
     "fetch('https://vigilia.lan/api/v1/concierge/device').then(r => console.log(r.status))"

   # El hub conectó por wss
   sudo journalctl -u vigilia-hub -n 50 | grep -E "Conectando a wss://|Conectado al backend"
   ```

   Si el hub no arranca, el log dice qué variable falla (nunca su valor).

### 6. Verificación de hardware: pigpio y usuario del servicio

La unidad systemd corre como `User=pi` (no root), con acceso a GPIO por
`/dev/gpiomem`. El autor de `pigpio` indica que las aplicaciones que lo usan
suelen correr como root, y esto **no se ha probado en hardware**: verifícalo
la primera vez que arranques el servicio en la Raspberry.

```bash
sudo systemctl restart vigilia-hub
sudo journalctl -u vigilia-hub -n 100 | grep -i "pigpio"
```

- El log **no** debe mostrar `pigpio no se pudo cargar o inicializar`.
- Si lo muestra, relés y teclado quedan **simulados** y el portón **no abre**.
  Cambia `User=pi` por `User=root` en `/etc/systemd/system/vigilia-hub.service`
  (y quita `SupplementaryGroups`/`Group` si estorban), **conservando todo el
  endurecimiento** (`NoNewPrivileges`, `ProtectSystem=strict`,
  `ReadWritePaths`, etc.; ahora es la única barrera), y haz
  `sudo systemctl daemon-reload && sudo systemctl restart vigilia-hub`.
  El `.env` debe seguir en `chmod 600`; si pasa a root, `chown root:root`.
- Complementa con `npm run test:relays` y `npm run test:keypad` antes de
  dejarlo en servicio.

---

## 📊 Monitoreo

### Logs

```bash
# Systemd journal
sudo journalctl -u vigilia-hub -f

# Archivos locales
tail -f /opt/vigilia-hub/logs/vigilia-hub.log
tail -f /opt/vigilia-hub/logs/errors.log
```

### Metrics

```bash
# CPU y temperatura
vcgencmd measure_temp
top -b -n 1 | head -15

# Memoria
free -h

# Disco
df -h

# Network
ifconfig wlan0
ping -c 5 8.8.8.8
```

### Health Check Script

```bash
#!/bin/bash
# /usr/local/bin/vigilia-health-check.sh

set -e

# Verificar servicio
if ! systemctl is-active --quiet vigilia-hub; then
    echo "❌ Servicio no está activo"
    exit 1
fi

# Verificar GPIO
if [ ! -d /sys/class/gpio/gpio17 ]; then
    echo "⚠️ GPIO 17 no exportado"
fi

# Verificar audio
if ! aplay -l | grep -q "USB Audio"; then
    echo "❌ Tarjeta de audio no detectada"
    exit 1
fi

# Verificar conectividad
if ! ping -c 1 8.8.8.8 > /dev/null 2>&1; then
    echo "❌ Sin conectividad a Internet"
    exit 1
fi

echo "✅ Sistema OK"
exit 0
```

Ejecutar cada 5 minutos con cron:

```bash
# crontab -e
*/5 * * * * /usr/local/bin/vigilia-health-check.sh >> /var/log/vigilia-health.log 2>&1
```

---

## 🔄 Actualización y Rollback

### Estrategia de Actualización

```bash
# Script de actualización
#!/bin/bash
# /opt/vigilia-hub/update.sh

set -e

echo "🔄 Actualizando Vigilia Hub..."

# Backup de configuración
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Detener servicio
sudo systemctl stop vigilia-hub

# Pull cambios (si es Git)
git pull origin main

# O copiar archivos manualmente

# Reinstalar dependencias (reproducible, según package-lock.json)
npm ci

# Recompilar (necesita las devDependencies) y quitarlas después
npm run build
npm prune --omit=dev

# Reiniciar
sudo systemctl start vigilia-hub

# Verificar
sleep 3
sudo systemctl status vigilia-hub

echo "✅ Actualización completada"
```

### Rollback

```bash
# Si la actualización falla, hacer rollback
git reset --hard HEAD~1
npm ci
npm run build
npm prune --omit=dev
sudo systemctl restart vigilia-hub
```

---

## 🚀 Deployment Multi-Hub

Para condominios con múltiples entradas:

```
Backend
   │
   ├─► Hub 1 (Entrada Principal)   HUB_ID=hub-main-entrance
   ├─► Hub 2 (Entrada Estacionamiento) HUB_ID=hub-parking
   └─► Hub 3 (Entrada Peatonal)    HUB_ID=hub-pedestrian
```

### Configuración para cada Hub

Cada hub se provisiona por separado (`POST /api/v1/hubs`, ver "Autenticación
del Backend") y recibe **su propio** secret. Nunca se reutiliza un secret entre
hubs: si uno se compromete, se rota solo ese (`rotate-secret`).

```bash
# Hub 1: /opt/vigilia-hub/.env
HUB_ID=hub-main-entrance
HUB_SECRET=<secret devuelto al provisionar hub-main-entrance>

# Hub 2: /opt/vigilia-hub/.env
HUB_ID=hub-parking
HUB_SECRET=<secret devuelto al provisionar hub-parking>

# Hub 3: /opt/vigilia-hub/.env
HUB_ID=hub-pedestrian
HUB_SECRET=<secret devuelto al provisionar hub-pedestrian>
```

---

## 🏭 Ambientes

### Development

```bash
# Local en laptop con mock GPIO
NODE_ENV=development
BACKEND_URL=http://localhost:3000
MOCK_GPIO=true
```

### Staging

```bash
# Raspberry Pi de pruebas
NODE_ENV=staging
BACKEND_URL=https://staging.vigilia.com:3000
HUB_ID=hub-staging-test
```

> **Fase 4 · P6.M:** `staging` (y cualquier valor distinto de `development` o
> `test`, o `NODE_ENV` ausente) aplica las **reglas de producción**:
> `https://` obligatorio, `HUB_ID` y `HUB_SECRET` obligatorios y
> `DEBUG_OPENAI_KEY` prohibida. Solo `NODE_ENV=development` acepta `http://`.

### Production

```bash
# Raspberry Pi en sitio cliente
NODE_ENV=production
BACKEND_URL=https://api.vigilia.com:3000
HUB_ID=hub-condominio-xyz-entrance-1
LOG_LEVEL=warn
```

---

## 📦 Backup y Disaster Recovery

### Backup Automático

```bash
#!/bin/bash
# /opt/vigilia-hub/backup.sh

BACKUP_DIR="/opt/vigilia-hub/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup de configuración
tar -czf "$BACKUP_DIR/config_$DATE.tar.gz" \
    /opt/vigilia-hub/.env \
    /opt/vigilia-hub/data/ai-units.json

# Mantener solo últimos 7 backups
find "$BACKUP_DIR" -name "config_*.tar.gz" -mtime +7 -delete

echo "✅ Backup completado: $BACKUP_DIR/config_$DATE.tar.gz"
```

Ejecutar diariamente:

```bash
# crontab -e
0 3 * * * /opt/vigilia-hub/backup.sh
```

### Restauración

```bash
# Restaurar desde backup
tar -xzf /opt/vigilia-hub/backups/config_20250115_030000.tar.gz -C /

# Reiniciar servicio
sudo systemctl restart vigilia-hub
```

---

## 📈 Escalabilidad

### Load Balancing (Futuro)

Para múltiples backends:

```bash
# .env
BACKEND_URL=https://lb.vigilia.com:3000
# Load balancer distribuye a backend-1, backend-2, backend-3
```

### Redis Cache (Futuro)

Para caché distribuido entre hubs:

```bash
# .env
REDIS_URL=redis://10.0.0.10:6379
CACHE_TTL_SECONDS=300
```

---

## ✅ Checklist de Deployment

- [ ] Raspberry Pi actualizado (apt upgrade)
- [ ] Raspberry Pi OS 64-bit (`uname -m` = `aarch64`; 32-bit no soportado)
- [ ] Node.js 22 LTS (>= 22.12) instalado
- [ ] Dependencias del sistema (ALSA, Sox)
- [ ] Proyecto compilado (npm run build)
- [ ] .env configurado con valores reales
- [ ] Hardware conectado y testeado
- [ ] Test de relés OK
- [ ] Test de teclado OK
- [ ] Test de audio OK
- [ ] Conectividad al backend OK
- [ ] Servicio systemd habilitado
- [ ] Servicio iniciado sin errores
- [ ] Logs sin errores críticos
- [ ] IP estática configurada
- [ ] DNS funcionando
- [ ] NTP sincronizado
- [ ] SSH hardening aplicado
- [ ] Firewall configurado
- [ ] Backup configurado
- [ ] Health check configurado
- [ ] Documentación entregada al cliente
- [ ] Test end-to-end OK

---

**Vigilia Hub v1.0.0**  
Deployment Guide - Última actualización: 2025
