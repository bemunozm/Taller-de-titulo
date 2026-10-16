# Vigilia Hub - Sistema de Citófono Inteligente

Sistema embebido para Raspberry Pi 3 que intercepta llamadas del citófono AIPHONE GT y las procesa con Inteligencia Artificial usando OpenAI Realtime API.

## 🎯 Características

- **Intercepción inteligente**: Interrumpe señal PRIMERO, decide en <50ms con caché local
- **Sin latencia audible**: El Hub intercepta inmediatamente para evitar audio pasante durante decisión
- **Audio half-duplex**: Conversaciones con cancelación de eco avanzada
- **Conexión directa a OpenAI**: Baja latencia usando Realtime API
- **Modo transparente**: Citófono funciona normal cuando IA está deshabilitada
- **Seguridad**: Múltiples watchdogs y fallbacks automáticos

## 🏗️ Arquitectura

```
┌─────────────┐
│  AIPHONE GT │ ← Citófono existente
│  (Análogo)  │
└──────┬──────┘
       │
       ├─── Teclado (matriz 4x3) → CD74HC4067 Multiplexor → GPIO
       │
       ├─── Audio IN/OUT → Relés → USB Audio Interface
       │
       v
┌──────────────────────────────────────────────┐
│          RASPBERRY PI 3 (Vigilia Hub)        │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │      Audio Router (FSM)              │   │
│  │  States:                             │   │
│  │  - TRANSPARENT                       │   │
│  │  - SCANNING_KEYPAD                   │   │
│  │  - AI_INTERCEPT                      │   │
│  │  - COOLDOWN                          │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  Services:                                   │
│  - GPIO Controller                           │
│  - Relay Controller (pines 17, 27)          │
│  - Audio Manager (48kHz → 24kHz)            │
│  - Echo Suppression (half-duplex)           │
│  - Local Cache (decisión <50ms)             │
│  - Connectivity Monitor                      │
│                                              │
└───────────┬────────────────────┬─────────────┘
            │                    │
            v                    v
    ┌───────────────┐    ┌──────────────┐
    │  Backend API  │    │  OpenAI API  │
    │  (WebSocket)  │    │  (Realtime)  │
    └───────────────┘    └──────────────┘
```

## 📋 Requisitos

### 🚀 Setup Rápido de Laboratorio

> **¿Solo tienes Raspberry Pi + protoboard + cables?**  
> **👉 [LEE ESTO PRIMERO: Laboratory Setup Guide](./docs/hardware/LABORATORY_SETUP.md)**

Empieza a desarrollar **HOY** sin esperar componentes:
- ✅ Setup completo de software
- ✅ Tests con LEDs simples (simular relés)
- ✅ Desarrollo de ~60% del proyecto sin hardware adicional
- ✅ Alimentación simple: micro-USB (NO requieres step-down)
- ⏳ Plan para incorporar componentes gradualmente

---

### Hardware Completo (Para Producción)
- Raspberry Pi 3 Model B (o superior)
- Tarjeta USB Audio (48kHz recomendado)
- Módulo relé dual (5V, optoacoplado) ×2
- Multiplexor CD74HC4067 (16 canales)
- Teclado matricial 4×4 membrana
- Sensor de sonido KY-037
- Altavoz 8Ω 0.5W
- **LM2596S Buck Converter** (12V→5V) - **⚠️ SOLO para instalación en citófono real**
- Cables dupont, protoboard
- Kit de componentes electrónicos (resistencias, capacitores)

> **📖 Documentación completa de hardware**: Ver [docs/hardware/](./docs/hardware/)

### Software
- Raspberry Pi OS **64-bit** (Bookworm). 32-bit (`armv7l`) no está soportado
- Node.js 22 LTS (>= 22.12)
- ALSA tools (`arecord`, `aplay`)
- Sox (conversión de sample rate)

---

## 🔧 Documentación de Hardware

### 🚀 Empezar en Laboratorio (PRIMERO)

#### ✅ **Verificación Rápida de Sistema**

Antes de empezar, verifica que tu Raspberry Pi esté lista:

```bash
# Descargar script de verificación
curl -O https://raw.githubusercontent.com/TU_USUARIO/vigilia-hub/main/scripts/check-rpi-ready.sh

# Ejecutar verificación
bash check-rpi-ready.sh

# Si todo está OK, continúa con Laboratory Setup
```

El script verifica:
- ✅ Sistema operativo compatible
- ✅ Hardware detectado (RPi 3/4)
- ✅ GPIO disponible y permisos
- ✅ Sistema 64-bit (`aarch64` / `arm64`)
- ✅ Node.js 22.12+ instalado
- ✅ Herramientas necesarias (git, wiringpi, alsa, sox)
- ✅ Conectividad de red
- ✅ Espacio en disco suficiente
- ✅ Temperatura CPU normal

---

#### 📗 [**Laboratory Setup Guide**](./docs/hardware/LABORATORY_SETUP.md)
**LEE ESTO PRIMERO si solo tienes RPi + protoboard + cables**
- Setup inicial con equipamiento mínimo
- Alimentación con micro-USB (NO requiere LM2596S en lab)
- Desarrollo de ~60% del proyecto sin hardware adicional
- Tests con LEDs simples (simular relés)
- Plan de incorporación gradual de componentes
- Qué hacer HOY vs qué necesita esperar

---

### Guías Completas de Montaje (Para Hardware Completo)

Para la instalación física del sistema completo, consulta la documentación detallada:

#### 📘 [**Hardware Documentation**](./docs/hardware/)
Índice completo con resúmenes de todas las guías.

#### 🔌 [**Circuit Diagram**](./docs/hardware/CIRCUIT_DIAGRAM.md)
- Esquemáticos completos del circuito
- Diagramas de conexión de todos los componentes
- Layout de protoboard
- Especificaciones eléctricas y consumo
- Protecciones y seguridad
- **⚠️ Incluye LM2596S - SOLO para instalación en citófono real**

#### 📍 [**Pin Mapping**](./docs/hardware/PIN_MAPPING.md)
- Mapeo completo de GPIO (40 pines)
- Tablas de asignación por función
- Configuración de código para cada pin
- Scripts de test individuales
- Troubleshooting de GPIO

#### ⚙️ [**Hardware Installation**](./docs/hardware/HARDWARE_INSTALLATION.md)
- Guía paso a paso de montaje completo
- Lista de materiales con checklist
- 8 fases de instalación detalladas
- Tests de validación
- Troubleshooting común
- Checklist final de verificación

### Test de Hardware

Después de completar el montaje físico, valida todas las conexiones:

```bash
# Ejecutar suite de tests de hardware
npm run test:hardware

# El script verificará:
# ✅ Permisos GPIO
# ✅ Voltajes de alimentación (5V y 3.3V)
# ✅ Continuidad de tierras (GND)
# ✅ Funcionamiento de relés
# ✅ Multiplexor y teclado 4×4
# ✅ Sensor de audio KY-037
```

---

## 🚀 Instalación

### 1. Preparar Raspberry Pi

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Requiere Raspberry Pi OS 64-bit: debe decir aarch64 (32-bit no soportado)
uname -m

# Instalar Node.js 22 LTS (>= 22.12)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar ALSA y Sox
sudo apt install -y alsa-utils sox

# Verificar tarjeta de audio
arecord -l
aplay -l
```

### 2. Configurar GPIO

```bash
# Habilitar GPIO (ya viene por defecto en Raspberry Pi OS)
# Verificar pines disponibles
gpio readall
```

### 3. Clonar y configurar proyecto

```bash
# Crear directorio
mkdir -p /home/pi/vigilia-hub
cd /home/pi/vigilia-hub

# Copiar archivos del proyecto

# Instalar dependencias (reproducible, según package-lock.json)
npm ci
# pigpio (GPIO real) es dependencia opcional: npm la intenta compilar, pero no
# falla si no puede. En la Raspberry verifica que cargó (ver INSTALLATION.md 5.2):
node -e "require('pigpio')" && echo "pigpio OK"

# Configurar variables de entorno
cp .env.example .env
nano .env
```

### 4. Configurar archivo .env

```bash
# Backend (producción: https://, solo el origen; ver .env.example)
NODE_ENV=production
BACKEND_URL=https://vigilia.tu-dominio.cl
HUB_ID=hub-rpi3-001
HUB_SECRET=<secret de 64 caracteres que devuelve POST /hubs al provisionar>
# En desarrollo (NODE_ENV=development) se acepta BACKEND_URL=http://192.168.1.100:3000

# (Sin API key de OpenAI: el hub pide un token efímero al backend)

# Audio (ver .env.example)
AUDIO_DEVICE=plughw:CARD=Headphones,DEV=0
CAPTURE_DEVICE=plughw:CARD=Device,DEV=0
SAMPLE_RATE=24000
TARGET_SAMPLE_RATE=24000
AUDIO_CHANNELS=1

# GPIO
RELAY_PIN_1=17
RELAY_PIN_2=27

# Timeouts
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

### 5. Compilar TypeScript

```bash
npm run build
```

## 🎮 Uso

### Modo desarrollo (con hot reload)
```bash
npm run dev
```

### Modo producción
```bash
npm start
```

### Ejecutar como servicio systemd

Crear archivo `/etc/systemd/system/vigilia-hub.service`:

```ini
[Unit]
Description=Vigilia Hub - Sistema de Citofono Inteligente
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/vigilia-hub
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Habilitar servicio:

```bash
sudo systemctl daemon-reload
sudo systemctl enable vigilia-hub
sudo systemctl start vigilia-hub

# Ver logs
sudo journalctl -u vigilia-hub -f
```

## 🔧 Configuración de Hardware

### Conexión de Relés

```
GPIO 17 (BCM) → IN1 (Relay Module) → Audio Channel 1
GPIO 27 (BCM) → IN2 (Relay Module) → Audio Channel 2

Relay NO (Normally Open):
- Conectar audio del citófono cuando AI está activa
- Cuando LOW: Citófono normal (TRANSPARENT)
- Cuando HIGH: Audio ruteado a Raspberry (AI_INTERCEPT)
```

### Conexión de Teclado Matricial

```
Multiplexor CD74HC4067:
S0 → GPIO 5 (BCM)
S1 → GPIO 6 (BCM)
S2 → GPIO 13 (BCM)
S3 → GPIO 19 (BCM)
SIG → GPIO 26 (BCM)

Canales del multiplexor:
C0-C9  → Dígitos 0-9
C10    → Asterisco (*)
C11    → Numeral (#)
```

### Conexión de Audio

```
USB Audio Interface:
Line IN  ← Audio del citófono (después del relé)
Line OUT → Bocina del citófono (después del relé)

Configuración ALSA:
Dispositivo: hw:1,0
Sample Rate: 48000 Hz (nativo)
Canales: 1 (mono)
Formato: S16_LE (PCM 16-bit)
```

## 🧪 Testing

### Verificar GPIO

```bash
# Test de relés
npm run test:relays
```

### Verificar Audio

```bash
# Test de captura
arecord -D hw:1,0 -f S16_LE -c 1 -r 48000 -d 5 test.wav

# Test de reproducción
aplay -D hw:1,0 test.wav
```

### Verificar Conectividad

```bash
# TLS + credencial del hub (no hay /health público): 200 con {hubId, type, organizationId}
# o 401 si hubId/secret son incorrectos. Procedimiento completo, leyendo el
# secret del .env sin dejarlo en el historial: INSTALLATION.md, "6.4 Test de Conectividad".
```

## 📊 Máquina de Estados

### TRANSPARENT
- **Entrada**: Sistema inicializado, cooldown terminado
- **Comportamiento**: Citófono funciona normal, relés OFF
- **Transición**: Usuario marca número → SCANNING_KEYPAD

### SCANNING_KEYPAD
- **Entrada**: Primera tecla presionada
- **Comportamiento**: Acumula dígitos en buffer
- **Transiciones**:
  - Usuario presiona `#` → Procesa número
  - Timeout 5s → Procesa número
  - Usuario presiona `*` → TRANSPARENT

### AI_INTERCEPT
- **Entrada**: Número marcado tiene IA habilitada
- **Comportamiento**: 
  - Activa relés
  - Inicia audio pipeline
  - Conecta a OpenAI
- **Transiciones**:
  - Conversación termina → COOLDOWN
  - Timeout 3min → COOLDOWN
  - Error → COOLDOWN

### COOLDOWN
- **Entrada**: AI_INTERCEPT terminó
- **Comportamiento**: Espera 3s para evitar rebotes
- **Transición**: Timeout → TRANSPARENT

## 🐛 Troubleshooting

### GPIO no libera

```bash
# Limpiar todos los GPIO exports
for pin in /sys/class/gpio/gpio*; do
  echo $(basename $pin | sed 's/gpio//') > /sys/class/gpio/unexport
done
```

### Audio con ruido/distorsión

```bash
# Verificar buffer size
cat /proc/asound/card1/pcm0p/sub0/hw_params

# Ajustar en .env:
AUDIO_BUFFER_TIME_US=50000
AUDIO_PERIOD_TIME_US=10000
```

### Backend no conecta

```bash
# Verificar firewall
sudo ufw status

# Verificar DNS
ping tu-backend.com

# Verificar certificados (si es HTTPS)
curl -v https://tu-backend.com
```

### OpenAI no responde

El hub no usa una API key de OpenAI propia: obtiene un token efímero del
backend con las credenciales del hub. Si falla, revisa primero la conectividad
y la credencial (INSTALLATION.md, "6.4 Test de Conectividad"), los logs del hub
(`sudo journalctl -u vigilia-hub -n 100`) y la clave de OpenAI en el **backend**.

## 📝 Logs

Los logs se guardan en:
- Console output (nivel INFO)
- `logs/vigilia-hub.log` (todos los niveles)
- `logs/errors.log` (solo errores)

Rotación automática:
- Máximo 5 archivos
- 5MB por archivo

## 🔒 Seguridad

- **Watchdog timers**: Desactivan relés automáticamente después de 3min
- **Multiple handlers**: SIGINT, SIGTERM, uncaughtException, unhandledRejection
- **Modo seguro**: En cualquier error, vuelve a TRANSPARENT
- **Auth**: secret PROPIO de cada hub (`POST /api/v1/hubs`; el backend solo guarda su hash), enviado en `auth: {hubId, hubSecret}` al namespace `/hub` y como `X-Hub-Id`/`X-Hub-Secret` por HTTP. Ver DEPLOYMENT.md

## 📦 Estructura del Proyecto

```
vigilia-hub/
├── src/
│   ├── main.ts                          # Punto de entrada
│   ├── utils/
│   │   └── logger.ts                    # Sistema de logging
│   └── services/
│       ├── local-cache.service.ts       # Caché local (<50ms)
│       ├── connectivity.service.ts      # Monitor de red
│       ├── gpio-controller.service.ts   # Lectura de teclado
│       ├── relay-controller.service.ts  # Control de relés
│       ├── audio-manager.service.ts     # Audio I/O
│       ├── echo-suppression.service.ts  # Cancelación de eco
│       ├── websocket-client.service.ts  # Cliente WebSocket
│       ├── concierge-client.service.ts  # Cliente OpenAI
│       └── audio-router.service.ts      # FSM principal
├── data/
│   └── ai-units.json                    # Caché persistente
├── logs/
│   ├── vigilia-hub.log
│   └── errors.log
├── package.json
├── tsconfig.json
├── .env
└── README.md
```

## 🤝 Contribuir

1. Fork el repositorio
2. Crear branch de feature (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## 📄 Licencia

Este proyecto es parte del sistema Vigilia y está sujeto a sus términos de licencia.

## 📞 Soporte

Para problemas o preguntas:
- Revisar logs en `logs/` y journalctl
- Verificar hardware con scripts de test
- Contactar al equipo de desarrollo

---

**Vigilia Hub** - Sistema de Citófono Inteligente  
Versión 1.0.0 | Raspberry Pi 3
