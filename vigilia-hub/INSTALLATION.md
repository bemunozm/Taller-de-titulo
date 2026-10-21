# Guía de Instalación Completa - Vigilia Hub

Esta guía te llevará paso a paso desde una Raspberry Pi nueva hasta tener el sistema completamente funcional.

## 📋 Tabla de Contenidos

1. [Hardware Necesario](#hardware-necesario)
2. [Preparación de Raspberry Pi](#preparación-de-raspberry-pi)
3. [Instalación de Software](#instalación-de-software)
4. [Conexiones de Hardware](#conexiones-de-hardware)
5. [Configuración del Proyecto](#configuración-del-proyecto)
6. [Pruebas](#pruebas)
7. [Configuración del Servicio](#configuración-del-servicio)
8. [Troubleshooting](#troubleshooting)

---

## 1. Hardware Necesario

### Componentes Principales

| Componente | Especificación | Cantidad | Notas |
|------------|---------------|----------|-------|
| Raspberry Pi 3 Model B | o superior | 1 | Con tarjeta SD ≥16GB |
| Fuente de alimentación | 5V 2.5A | 1 | Oficial recomendada |
| Tarjeta USB Audio | 48kHz compatible | 1 | Behringer UCA222 o similar |
| Módulo Relé Dual | 5V, optoacoplado | 1 | Con entrada HIGH = ON |
| Multiplexor CD74HC4067 | 16 canales | 1 | Breakout board recomendado |
| Resistencias | 10kΩ pull-down | 12 | Para matriz de teclado |
| Cables Dupont | M-F, M-M | ~30 | Para conexiones GPIO |
| Protoboard | 830 puntos | 1 | Para pruebas |

### Tools Necesarios

- Soldador (si requiere soldar)
- Multímetro
- Destornillador pequeño (para bornes de relés)
- Pinzas de corte
- Pelacables

---

## 2. Preparación de Raspberry Pi

### 2.1 Instalar Raspberry Pi OS

1. **Descargar Raspberry Pi Imager**
   ```
   https://www.raspberrypi.com/software/
   ```

2. **Flashear tarjeta SD**
   - OS: **Raspberry Pi OS (64-bit)** Lite o Desktop
   - Versión: Bookworm
   - Habilitar SSH en opciones avanzadas
   - Configurar WiFi/Ethernet
   - Establecer usuario: `pi`, password: `[tu-password]`

3. **Primer boot**
   ```bash
   # Conectar por SSH
   ssh pi@raspberrypi.local
   
   # Verificar que el sistema es 64-bit (ambos son obligatorios)
   uname -m                      # Debe ser: aarch64
   dpkg --print-architecture     # Debe ser: arm64

   # Actualizar sistema
   sudo apt update
   sudo apt upgrade -y
   sudo reboot
   ```

> **Solo 64-bit (Fase 4 · P8.C).** El hub exige Node.js >= 22.12, y NodeSource
> publica Node 22 para arm64, no para 32-bit. Un sistema 32-bit (`armv7l` /
> `armhf`) **no está soportado**: `install.sh` aborta. Si `uname -m` o
> `dpkg --print-architecture` no dan `aarch64` / `arm64`, reinstala la microSD
> con la imagen "Raspberry Pi OS (64-bit)" desde Raspberry Pi Imager. La Pi 3
> Model B (Cortex-A53) la soporta.

### 2.2 Configurar GPIO

```bash
# Verificar GPIO disponibles
gpio readall

# Si no está instalado gpio command
sudo apt install -y wiringpi

# Verificar que no haya conflictos
ls /sys/class/gpio/
```

### 2.3 Configurar Audio

```bash
# Listar tarjetas de audio
aplay -l
arecord -l

# Debería aparecer algo como:
# card 1: CODEC [USB Audio CODEC], device 0

# Si no aparece, verificar conexión USB

# Probar captura
arecord -D hw:1,0 -f S16_LE -c 1 -r 48000 -d 3 test.wav
# Hablar por 3 segundos

# Probar reproducción
aplay -D hw:1,0 test.wav

# Si hay problemas, editar /boot/config.txt
sudo nano /boot/config.txt
# Asegurar que contenga:
# dtparam=audio=on

# Reiniciar
sudo reboot
```

---

## 3. Instalación de Software

### 3.1 Node.js 22 LTS

El hub exige Node.js >= 22.12 (`engines` en `package.json`, igual que CI con
`.nvmrc`). Node 18 está EOL y Node 20 lo estará antes del piloto.

```bash
# NodeSource (requiere Raspberry Pi OS 64-bit, ver 2.1)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar
node -v  # Debe ser v22.12.0 o superior
npm -v
```

### 3.2 Dependencias del Sistema

```bash
# ALSA tools
sudo apt install -y alsa-utils

# Sox (para conversión de sample rate)
sudo apt install -y sox

# Build tools (para compilar módulos nativos)
sudo apt install -y build-essential python3

# Git (si vas a clonar)
sudo apt install -y git
```

### 3.3 Permisos para GPIO

```bash
# Agregar usuario pi al grupo gpio
sudo usermod -a -G gpio pi

# Reiniciar sesión para aplicar cambios
exit
# Volver a conectar por SSH
```

---

## 4. Conexiones de Hardware

### 4.1 Esquema de Pines (BCM Numbering)

```
Raspberry Pi 3 GPIO Pinout (BCM):

        3.3V  (1) (2)  5V
       GPIO2  (3) (4)  5V
       GPIO3  (5) (6)  GND
       GPIO4  (7) (8)  GPIO14
         GND  (9) (10) GPIO15
      GPIO17 (11) (12) GPIO18
      GPIO27 (13) (14) GND
      GPIO22 (15) (16) GPIO23
        3.3V (17) (18) GPIO24
      GPIO10 (19) (20) GND
       GPIO9 (21) (22) GPIO25
      GPIO11 (23) (24) GPIO8
         GND (25) (26) GPIO7
       GPIO0 (27) (28) GPIO1
       GPIO5 (29) (30) GND    ← MUX S0
       GPIO6 (31) (32) GPIO12 ← MUX S1
      GPIO13 (33) (34) GND    ← MUX S2
      GPIO19 (35) (36) GPIO16 ← MUX S3
      GPIO26 (37) (38) GPIO20 ← MUX SIG
         GND (39) (40) GPIO21

Relés:
- GPIO17 (pin 11) → Relay 1 IN
- GPIO27 (pin 13) → Relay 2 IN
```

### 4.2 Conexión del Multiplexor CD74HC4067

```bash
# Multiplexor → Raspberry Pi
VCC  → 3.3V (pin 1)
GND  → GND (pin 6)
S0   → GPIO5 (pin 29)
S1   → GPIO6 (pin 31)
S2   → GPIO13 (pin 33)
S3   → GPIO19 (pin 35)
SIG  → GPIO26 (pin 37)

# Multiplexor → Teclado Citófono
C0-C11 → Teclas con resistencias pull-down de 10kΩ

Mapeo de teclas:
C0  → Tecla 0
C1  → Tecla 1
C2  → Tecla 2
C3  → Tecla 3
C4  → Tecla 4
C5  → Tecla 5
C6  → Tecla 6
C7  → Tecla 7
C8  → Tecla 8
C9  → Tecla 9
C10 → Tecla * (asterisco)
C11 → Tecla # (numeral)
```

### 4.3 Conexión de Relés

```bash
# Módulo Relé → Raspberry Pi
VCC  → 5V (pin 2 o 4)
GND  → GND (pin 6)
IN1  → GPIO17 (pin 11)
IN2  → GPIO27 (pin 13)

# Módulo Relé → Citófono AIPHONE GT
Relay 1:
COM  → Audio OUT del citófono (micrófono)
NO   → USB Audio IN (captura)
NC   → (no conectado)

Relay 2:
COM  → Audio IN del citófono (bocina)
NO   → USB Audio OUT (reproducción)
NC   → (no conectado)

Nota: Los relés deben ser de tipo "Normally Open" (NO)
para que en estado OFF (LOW) el citófono funcione normal.
```

### 4.4 Diagrama Visual

```
┌──────────────────────┐
│   Citófono AIPHONE   │
│       GT-DB          │
│                      │
│  ┌────────────────┐  │
│  │   Teclado 4x3  │  │ ───┬─── Resistencias 10kΩ ───┬─── CD74HC4067
│  └────────────────┘  │    │                          │    (S0-S3, SIG)
│                      │    │                          │        │
│  ┌────────────────┐  │    │                          │        V
│  │  Micrófono ───────┼────┴─ COM Relay1 NO ─────── USB Audio IN
│  └────────────────┘  │                                        │
│                      │                               Raspberry Pi 3
│  ┌────────────────┐  │                                        │
│  │  Bocina ──────────┼────── COM Relay2 NO ─────── USB Audio OUT
│  └────────────────┘  │
│                      │
└──────────────────────┘

Relés controlados por GPIO17, GPIO27
Multiplexor controlado por GPIO5,6,13,19,26
```

---

## 5. Configuración del Proyecto

### 5.1 Clonar/Copiar el Proyecto

```bash
# Método 1: Crear directorio y copiar archivos
sudo mkdir -p /opt/vigilia-hub
sudo chown pi:pi /opt/vigilia-hub
cd /opt/vigilia-hub

# Copiar todos los archivos del proyecto
# (Asumiendo que tienes los archivos en tu máquina local)

# Método 2: Git (si tienes repositorio)
git clone https://github.com/tu-usuario/vigilia-hub.git /opt/vigilia-hub
cd /opt/vigilia-hub
```

### 5.2 Instalar Dependencias

```bash
# Reproducible (package-lock.json); incluye las devDependencies para compilar
npm ci

# Si hay errores con módulos nativos
npm rebuild

# Verificar que pigpio (GPIO real) se compiló y carga
node -e "require('pigpio')" && echo "pigpio OK"
```

> **`pigpio` es dependencia opcional (Fase 4 · P8.C).** Se declara en
> `optionalDependencies` para que `npm ci` funcione fuera de la Raspberry
> (CI y desarrollo, donde el GPIO se simula). En la Raspberry `npm ci`
> **sigue intentando instalarlo y compilarlo**, pero si falla (falta la
> librería C de pigpio, p. ej. en Raspberry Pi OS Lite: `sudo apt install -y pigpio`)
> la instalación termina igual y el hub arrancaría con relés y teclado
> **simulados**. Por eso `install.sh` aborta si `require('pigpio')` falla en una
> Raspberry (existe `/dev/gpiomem`), y el hub lo registra como `error` al arrancar. Si ves ese
> error: instala la librería, corre `npm ci` de nuevo y repite la
> verificación de arriba.

### 5.3 Configurar .env

```bash
cp .env.example .env
nano .env
```

Editar con tus valores reales:

```bash
# Backend: solo el origen. En producción (el servicio systemd usa
# NODE_ENV=production) el hub exige https:// y no arranca con http://.
# Solo con NODE_ENV=development se acepta http://IP:3000.
BACKEND_URL=https://vigilia.tu-dominio.cl
HUB_ID=hub-rpi3-living-room
# Secret propio de este hub: lo devuelve POST /hubs al provisionarlo (64 caracteres)
HUB_SECRET=<secret devuelto por POST /hubs>

# (El hub NO usa una API key de OpenAI: pide un token efímero al backend.
# DEBUG_OPENAI_KEY existe solo para desarrollo y está prohibida en producción.)

# Audio (ajustar según tu tarjeta USB; ver .env.example)
AUDIO_DEVICE=plughw:CARD=Headphones,DEV=0
CAPTURE_DEVICE=plughw:CARD=Device,DEV=0
SAMPLE_RATE=24000
TARGET_SAMPLE_RATE=24000
AUDIO_CHANNELS=1

# GPIO (verificar con gpio readall)
RELAY_PIN_1=17
RELAY_PIN_2=27

# Timeouts (valores por defecto OK)
KEYPAD_TIMEOUT_MS=5000
COOLDOWN_MS=3000
MAX_INTERCEPT_TIME_MS=180000
RELAY_SETTLING_TIME_MS=200

# Echo Suppression
RMS_THRESHOLD_DB=-45
SUPPRESSION_TAIL_MS=300
HALF_DUPLEX_ENABLED=true

# Logging
LOG_LEVEL=info
```

### 5.4 Crear Directorios de Datos

```bash
mkdir -p data
mkdir -p logs

# Permisos
chmod 755 data logs
```

### 5.5 Compilar TypeScript

```bash
npm run build

# Debe existir dist/main.js (es lo que ejecuta la unidad systemd).
# `npm run build` limpia dist/ y compila solo src/ (tsconfig.build.json).
ls -la dist/main.js
```

---

## 6. Pruebas

### 6.1 Test de Relés

```bash
npm run test:relays
```

**Resultado esperado:**
- Deberías escuchar "clicks" del módulo relé
- Las luces LED del módulo deberían encender/apagar
- No debe haber errores en consola

**Si falla:**
- Verificar conexiones GPIO17, GPIO27
- Verificar alimentación 5V del módulo
- Revisar con multímetro continuidad

### 6.2 Test de Teclado

```bash
npm run test:keypad
```

**Resultado esperado:**
- Al presionar teclas en el citófono, deberías ver:
  ```
  🔢 Tecla: 1
  🔢 Tecla: 0
  🔢 Tecla: 1
  🔢 Tecla: # (TERMINAR)
  📋 Número completo: 101
  ```

**Si no detecta teclas:**
- Verificar conexiones del multiplexor
- Verificar resistencias pull-down en teclado
- Usar multímetro para verificar señales

### 6.3 Test de Audio

```bash
# Captura (habla por 5 segundos)
arecord -D hw:1,0 -f S16_LE -c 1 -r 48000 -d 5 test-input.wav

# Reproducción
aplay -D hw:1,0 test-input.wav
```

**Resultado esperado:**
- Deberías escuchar tu voz con claridad
- Sin distorsión ni ruido excesivo

### 6.4 Test de Conectividad

```bash
# Backend: valida TLS Y la credencial del hub en una sola llamada
# (ver DEPLOYMENT.md "TLS en la LAN del piloto"). El backend no tiene un
# endpoint /health público; este es el que usa el propio hub. Las credenciales
# se leen del .env (no se escriben en el comando ni quedan en el historial) y
# el secret viaja por stdin, sin aparecer en `ps`. Límite: 10 llamadas/min.
cd /opt/vigilia-hub
BACKEND_URL=$(grep '^BACKEND_URL=' .env | cut -d= -f2-)
HUB_ID=$(grep '^HUB_ID=' .env | cut -d= -f2-)
grep '^HUB_SECRET=' .env | sed 's/^HUB_SECRET=/X-Hub-Secret: /' \
  | curl -sS "$BACKEND_URL/api/v1/concierge/device" \
      -H "X-Hub-Id: $HUB_ID" -H @- -w '\nHTTP %{http_code}\n'
# Esperado: HTTP 200 y {"hubId":"...","type":"physical-hub","organizationId":"..."}
# HTTP 401: hubId/secret incorrectos, hub inactivo o secret rotado.
# Error de certificado: la CA no es de confianza (DEPLOYMENT.md, NODE_EXTRA_CA_CERTS;
# para curl, agrega --cacert /etc/vigilia/ca.crt).
unset BACKEND_URL HUB_ID

# Credenciales del hub: el log debe decir "Conectado al backend", sin
# "Hub no autorizado" (secret por hub; ver DEPLOYMENT.md "Autenticación del Backend")
sudo journalctl -u vigilia-hub -n 50 | grep -E "Conectando a wss://|Conectado al backend"
```

---

## 7. Configuración del Servicio

### 7.1 Crear Servicio Systemd

```bash
sudo nano /etc/systemd/system/vigilia-hub.service
```

Contenido:

```ini
[Unit]
Description=Vigilia Hub - Sistema de Citofono Inteligente
Documentation=https://github.com/tu-usuario/vigilia-hub
After=network.target sound.target

[Service]
Type=simple
# Usuario no root: GPIO por /dev/gpiomem (pigpio) y audio por /dev/snd. Si al
# arrancar el log muestra "pigpio no se pudo cargar o inicializar", ver
# DEPLOYMENT.md ("Verificación de hardware: pigpio y usuario del servicio").
# install.sh genera esta misma unidad automáticamente.
User=pi
Group=gpio
SupplementaryGroups=audio
WorkingDirectory=/opt/vigilia-hub
Environment="NODE_ENV=production"
# Solo si el certificado del backend es de una CA propia (ver DEPLOYMENT.md,
# "TLS en la LAN del piloto"). Nunca NODE_TLS_REJECT_UNAUTHORIZED=0.
# Environment="NODE_EXTRA_CA_CERTS=/etc/vigilia/ca.crt"
ExecStart=/usr/bin/node /opt/vigilia-hub/dist/main.js
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=vigilia-hub

# Security (sin PrivateDevices: ocultaría /dev/gpiomem y /dev/snd)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/vigilia-hub/data /opt/vigilia-hub/logs
ProtectHome=read-only
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

# Límites
TimeoutStartSec=60s
TimeoutStopSec=30s

[Install]
WantedBy=multi-user.target
```

### 7.2 Habilitar y Arrancar

```bash
# Recargar systemd
sudo systemctl daemon-reload

# Habilitar inicio automático
sudo systemctl enable vigilia-hub

# Iniciar servicio
sudo systemctl start vigilia-hub

# Verificar estado
sudo systemctl status vigilia-hub

# Ver logs en tiempo real
sudo journalctl -u vigilia-hub -f
```

### 7.3 Comandos Útiles

```bash
# Detener servicio
sudo systemctl stop vigilia-hub

# Reiniciar servicio
sudo systemctl restart vigilia-hub

# Ver logs completos
sudo journalctl -u vigilia-hub --no-pager

# Ver solo errores
sudo journalctl -u vigilia-hub -p err

# Deshabilitar inicio automático
sudo systemctl disable vigilia-hub
```

---

## 8. Troubleshooting

### 8.1 Servicio no arranca

```bash
# Ver errores detallados
sudo journalctl -u vigilia-hub -n 50

# Verificar permisos
ls -la /opt/vigilia-hub/dist/main.js

# Verificar variables de entorno
sudo systemctl show vigilia-hub | grep Environment

# Probar manualmente
cd /opt/vigilia-hub
node dist/main.js
```

### 8.2 GPIO no funciona

```bash
# Verificar permisos
groups pi  # Debe incluir 'gpio'

# Liberar GPIO manualmente
echo 17 | sudo tee /sys/class/gpio/unexport
echo 27 | sudo tee /sys/class/gpio/unexport

# Verificar estado
gpio readall
```

### 8.3 Audio no funciona

```bash
# Verificar dispositivo
aplay -l
arecord -l

# Test directo
speaker-test -D hw:1,0 -c 1 -t sine

# Verificar volúmenes
alsamixer

# Recargar ALSA
sudo alsa force-reload
```

### 8.4 Backend no conecta

```bash
# Verificar conectividad
ping 192.168.1.100

# Verificar puerto
nc -zv 192.168.1.100 3000

# Ver errores de red en logs
sudo journalctl -u vigilia-hub | grep -i "connection\|timeout\|error"
```

### 8.5 Logs no se escriben

```bash
# Verificar permisos de directorio
ls -la /opt/vigilia-hub/logs/

# Crear directorio si no existe
mkdir -p /opt/vigilia-hub/logs
chown pi:pi /opt/vigilia-hub/logs
chmod 755 /opt/vigilia-hub/logs
```

---

## 9. Verificación Final

### Checklist de Funcionamiento

- [ ] Raspberry Pi arranca correctamente
- [ ] Servicio vigilia-hub se inicia automáticamente
- [ ] No hay errores en journalctl
- [ ] Teclado detecta presiones correctamente
- [ ] Relés responden (test-relays.ts OK)
- [ ] Audio captura y reproduce sin distorsión
- [ ] Backend conecta vía WebSocket
- [ ] OpenAI Realtime API responde
- [ ] Caché local sincroniza cada 5min
- [ ] Llamada de prueba completa funciona end-to-end

### Test End-to-End

1. **Marcar número con IA habilitada** (ej: 101#)
2. **Esperar audio de OpenAI** ("Hola, soy el conserje digital...")
3. **Responder con tu voz** (debería transcribirse)
4. **Verificar herramientas** (notificación, autorización, abrir puerta)
5. **Finalizar llamada** (sistema debe volver a TRANSPARENT)
6. **Verificar logs**

```bash
sudo journalctl -u vigilia-hub --since "5 minutes ago"
```

---

## 10. Monitoreo y Mantenimiento

### Logs Rotativos

Los logs se rotan automáticamente:
- Máximo 5 archivos
- 5MB por archivo
- Location: `/opt/vigilia-hub/logs/`

### Actualización del Sistema

```bash
cd /opt/vigilia-hub

# Detener servicio
sudo systemctl stop vigilia-hub

# Pull cambios (si es Git)
git pull origin main

# Reinstalar dependencias (reproducible, según package-lock.json)
npm ci

# Recompilar (necesita las devDependencies) y quitarlas después
npm run build
npm prune --omit=dev

# Reiniciar servicio
sudo systemctl start vigilia-hub
```

### Backup de Configuración

```bash
# Backup de .env
cp /opt/vigilia-hub/.env /opt/vigilia-hub/.env.backup

# Backup de caché
cp /opt/vigilia-hub/data/ai-units.json /opt/vigilia-hub/data/ai-units.json.backup
```

---

## 🎉 ¡Instalación Completa!

Si llegaste hasta aquí y todos los tests pasan, tu Vigilia Hub está completamente funcional.

Para soporte adicional:
- Revisar logs: `sudo journalctl -u vigilia-hub -f`
- Documentación: `README.md` y `ARCHITECTURE.md`
- Issues: GitHub repository

---

**Vigilia Hub v1.0.0**  
Última actualización: 2025
