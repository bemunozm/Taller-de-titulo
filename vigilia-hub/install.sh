#!/bin/bash

# Vigilia Hub - Script de Instalación Automática
# Para Raspberry Pi 3 Model B con Raspberry Pi OS 64-bit (Bookworm) y Node.js 22 LTS
# v1.0.0

set -e  # Exit on error

echo "═══════════════════════════════════════════════════════════"
echo "🏢  Vigilia Hub - Instalación Automática"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Funciones auxiliares
info() {
    echo -e "${GREEN}✓${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
    exit 1
}

# Verificar que se ejecuta como usuario pi
if [ "$USER" != "pi" ]; then
    error "Este script debe ejecutarse como usuario 'pi'"
fi

# Verificar que estamos en Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo; then
    warn "No se detectó Raspberry Pi, continuando de todas formas..."
fi

# Solo Raspberry Pi OS 64-bit (Fase 4 · P8.C): el hub exige Node.js >= 22.12
# (engines) y NodeSource publica Node 22 para arm64, no para armv7l (32-bit).
# Se revisan kernel Y userland: una imagen 32-bit puede arrancar un kernel
# aarch64, pero sus paquetes son armhf y el nodejs arm64 no se instala.
ARCH="$(uname -m)"
DPKG_ARCH="$(dpkg --print-architecture 2>/dev/null || echo desconocida)"
if [ "$ARCH" != "aarch64" ] || [ "$DPKG_ARCH" != "arm64" ]; then
    error "Sistema no soportado (uname -m: $ARCH, paquetes: $DPKG_ARCH). Vigilia Hub requiere Raspberry Pi OS 64-bit (aarch64/arm64); los sistemas 32-bit (armv7l/armhf) no están soportados. Reinstala la microSD con la imagen 'Raspberry Pi OS (64-bit)' (Bookworm) desde Raspberry Pi Imager y vuelve a correr este script."
fi
info "Raspberry Pi OS 64-bit ($ARCH/$DPKG_ARCH)"

echo "📋 Paso 1: Actualizar sistema"
echo "──────────────────────────────────────────────────────────"
sudo apt update
sudo apt upgrade -y
info "Sistema actualizado"
echo ""

echo "📦 Paso 2: Instalar dependencias del sistema"
echo "──────────────────────────────────────────────────────────"

# ALSA tools
info "Instalando ALSA tools..."
sudo apt install -y alsa-utils

# Sox
info "Instalando Sox..."
sudo apt install -y sox

# Build tools
info "Instalando build-essential..."
sudo apt install -y build-essential python3

# Git (si no está)
info "Verificando Git..."
if ! command -v git &> /dev/null; then
    sudo apt install -y git
fi

# WiringPi (para gpio command)
info "Verificando WiringPi..."
if ! command -v gpio &> /dev/null; then
    warn "gpio command no encontrado, puedes instalarlo con: sudo apt install -y wiringpi"
fi

info "Dependencias del sistema instaladas"
echo ""

echo "📦 Paso 3: Instalar Node.js 22 LTS"
echo "──────────────────────────────────────────────────────────"

# Mínimo del hub (engines en package.json). Node 18 está EOL y Node 20 lo
# estará antes del piloto: se instala Node 22 LTS desde NodeSource.
NODE_MIN_VERSION="22.12.0"
node_supported() {
    command -v node &> /dev/null || return 1
    node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'
}

if node_supported; then
    info "Node.js ya instalado: $(node -v)"
else
    if command -v node &> /dev/null; then
        warn "Node.js $(node -v) es menor a $NODE_MIN_VERSION, actualizando a Node.js 22 LTS..."
    else
        info "Instalando Node.js 22 LTS..."
    fi
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
fi

if ! node_supported; then
    error "Node.js $(node -v 2>/dev/null || echo 'no instalado') no cumple el mínimo $NODE_MIN_VERSION. Revisa la instalación de NodeSource (setup_22.x)."
fi
node -v
npm -v
info "Node.js instalado correctamente"
echo ""

echo "🔐 Paso 4: Configurar permisos GPIO"
echo "──────────────────────────────────────────────────────────"

# Agregar usuario pi al grupo gpio
if groups pi | grep -q '\bgpio\b'; then
    info "Usuario pi ya está en grupo gpio"
else
    sudo usermod -a -G gpio pi
    warn "Usuario agregado al grupo gpio. Debes reiniciar la sesión o reboot para aplicar cambios."
fi

info "Permisos GPIO configurados"
echo ""

echo "🎵 Paso 5: Verificar tarjeta de audio USB"
echo "──────────────────────────────────────────────────────────"

if aplay -l | grep -q "USB Audio"; then
    info "Tarjeta de audio USB detectada"
    aplay -l | grep "USB Audio"
else
    warn "No se detectó tarjeta de audio USB. Conecta una antes de continuar."
fi
echo ""

echo "📂 Paso 6: Configurar estructura del proyecto"
echo "──────────────────────────────────────────────────────────"

# Directorio de instalación
INSTALL_DIR="/opt/vigilia-hub"

if [ -d "$INSTALL_DIR" ]; then
    warn "El directorio $INSTALL_DIR ya existe"
    read -p "¿Deseas borrarlo y continuar? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo rm -rf "$INSTALL_DIR"
        info "Directorio eliminado"
    else
        error "Instalación cancelada por el usuario"
    fi
fi

# Crear directorio
sudo mkdir -p "$INSTALL_DIR"
sudo chown pi:pi "$INSTALL_DIR"
info "Directorio creado: $INSTALL_DIR"

# Copiar archivos del proyecto actual
echo ""
read -p "¿Los archivos del proyecto están en el directorio actual? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    info "Copiando archivos..."
    # `cp -r ./*` no copia archivos ocultos (.env.example nunca llegaba y el
    # Paso 9 no podía crear el .env). Se copia TODO, ocultos incluidos, salvo
    # el historial git y los artefactos locales (se regeneran en el destino).
    if command -v rsync &> /dev/null; then
        rsync -a \
            --exclude='/.git/' --exclude='/node_modules/' --exclude='/dist/' \
            --exclude='/coverage/' --exclude='/logs/' --exclude='/data/' \
            --exclude='/.codegraph/' \
            ./ "$INSTALL_DIR/"
    else
        tar --exclude='./.git' --exclude='./node_modules' --exclude='./dist' \
            --exclude='./coverage' --exclude='./logs' --exclude='./data' \
            --exclude='./.codegraph' \
            -cf - . | tar -xf - -C "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"
else
    error "Por favor, ejecuta este script desde el directorio del proyecto o copia los archivos manualmente a $INSTALL_DIR"
fi

# Crear directorios de datos y logs
mkdir -p "$INSTALL_DIR/data"
mkdir -p "$INSTALL_DIR/logs"
chmod 755 "$INSTALL_DIR/data" "$INSTALL_DIR/logs"

info "Estructura del proyecto configurada"
echo ""

echo "📦 Paso 7: Instalar dependencias de Node.js"
echo "──────────────────────────────────────────────────────────"
cd "$INSTALL_DIR"
# `npm ci` instala exactamente lo del package-lock.json (reproducible). Instala
# también las devDependencies, necesarias para compilar en el Paso 8; el
# `npm prune --omit=dev` se hace al final del Paso 11, después de compilar y de
# los tests opcionales (test:relays / test:keypad usan ts-node, una devDep).
if [ ! -f package-lock.json ]; then
    error "Falta package-lock.json en $INSTALL_DIR: no se puede hacer una instalación reproducible (npm ci)."
fi
npm ci
# pigpio es dependencia OPCIONAL (Fase 4 · P8.C, para que CI instale sin
# compilarlo): si no compila, npm ci termina igual. En la Raspberry
# (/dev/gpiomem) es obligatoria; sin ella el hub simula relés y teclado y no
# abre el portón.
if [ -e /dev/gpiomem ]; then
    if ! node -e "require('pigpio')" > /dev/null 2>&1; then
        error "pigpio no se instaló o no carga. Instala la librería (sudo apt install -y pigpio) y vuelve a correr este script."
    fi
    info "pigpio cargado (GPIO real)"
fi
info "Dependencias instaladas"
echo ""

echo "🔨 Paso 8: Compilar TypeScript"
echo "──────────────────────────────────────────────────────────"
npm run build
info "Proyecto compilado"
echo ""

echo "⚙️  Paso 9: Configurar variables de entorno"
echo "──────────────────────────────────────────────────────────"

if [ ! -f "$INSTALL_DIR/.env" ]; then
    if [ -f "$INSTALL_DIR/.env.example" ]; then
        # .env con HUB_SECRET: solo el usuario del servicio (pi) puede leerlo.
        # umask 077 evita una ventana en la que el archivo exista con 644.
        (umask 077 && cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env")
        info "Archivo .env creado desde .env.example (permisos 600)"
        warn "⚠️  IMPORTANTE: Debes editar $INSTALL_DIR/.env con tus valores reales:"
        echo "   - BACKEND_URL"
        echo "   - HUB_ID"
        echo "   - HUB_SECRET (el que devuelve POST /api/v1/hubs al provisionar este hub)"
        echo ""
        read -p "¿Deseas editar .env ahora? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            nano "$INSTALL_DIR/.env"
        fi
    else
        warn "No se encontró .env.example, debes crear .env manualmente"
    fi
else
    info "Archivo .env ya existe"
fi
# Aplica también a un .env copiado del directorio de origen o preexistente.
if [ -f "$INSTALL_DIR/.env" ]; then
    chown "$(id -un)":"$(id -gn)" "$INSTALL_DIR/.env"
    chmod 600 "$INSTALL_DIR/.env"
fi
echo ""

echo "🔧 Paso 10: Crear servicio systemd"
echo "──────────────────────────────────────────────────────────"

SERVICE_FILE="/etc/systemd/system/vigilia-hub.service"

# ProtectHome solo si la instalación NO está bajo /home (ahí rompería el
# WorkingDirectory/ExecStart). Con /opt/vigilia-hub se activa; "read-only" y no
# "true" para que ALSA siga leyendo ~/.asoundrc del usuario pi si existe.
case "$INSTALL_DIR" in
    /home/*|/root/*) PROTECT_HOME_LINE="# ProtectHome omitido: INSTALL_DIR está bajo /home" ;;
    *)               PROTECT_HOME_LINE="ProtectHome=read-only" ;;
esac

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Vigilia Hub - Sistema de Citofono Inteligente
Documentation=https://github.com/tu-usuario/vigilia-hub
After=network.target sound.target

[Service]
Type=simple
# Corre como usuario NO root (pi): el hub abre GPIO por /dev/gpiomem (pigpio) y
# audio por /dev/snd, ambos accesibles por los grupos gpio y audio. Si en la
# prueba de hardware pigpio exigiera root (error "you don't have permission to
# run this program"), la salida es User=root; en ese caso el endurecimiento de
# abajo pasa a ser la única barrera, así que no lo quites.
User=pi
Group=gpio
SupplementaryGroups=audio
WorkingDirectory=$INSTALL_DIR
Environment="NODE_ENV=production"
# Solo con una CA propia en el backend (DEPLOYMENT.md, "TLS en la LAN del piloto"):
# Environment="NODE_EXTRA_CA_CERTS=/etc/vigilia/ca.crt"
ExecStart=/usr/bin/node $INSTALL_DIR/dist/main.js
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=vigilia-hub

# Security (endurecimiento compatible con GPIO y audio)
# NO se usa PrivateDevices=true: ocultaría /dev/gpiomem y /dev/snd.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
# Único lugar donde el hub escribe dentro de INSTALL_DIR: logs/ (winston) y
# data/ (caché ai-units.json). /tmp (audio DTMF temporal) lo cubre PrivateTmp.
ReadWritePaths=$INSTALL_DIR/data $INSTALL_DIR/logs
$PROTECT_HOME_LINE
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

# Límites
TimeoutStartSec=60s
TimeoutStopSec=30s

[Install]
WantedBy=multi-user.target
EOF

info "Servicio systemd creado"

# Recargar systemd
sudo systemctl daemon-reload
info "Systemd recargado"

# Habilitar servicio
sudo systemctl enable vigilia-hub
info "Servicio habilitado para inicio automático"
echo ""

echo "✅ Paso 11: Tests opcionales"
echo "──────────────────────────────────────────────────────────"

read -p "¿Deseas ejecutar test de relés? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run test:relays
fi

read -p "¿Deseas ejecutar test de teclado? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run test:keypad
fi

# Ya compilado y probado: se quitan las devDependencies del equipo en producción
# (el servicio solo necesita dist/ y las dependencias de runtime).
npm prune --omit=dev
info "devDependencies eliminadas (npm prune --omit=dev)"

echo ""
echo "🚀 Paso 12: Iniciar servicio"
echo "──────────────────────────────────────────────────────────"

read -p "¿Deseas iniciar el servicio ahora? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sudo systemctl start vigilia-hub
    sleep 2
    sudo systemctl status vigilia-hub --no-pager
    echo ""
    info "Servicio iniciado. Ver logs con: sudo journalctl -u vigilia-hub -f"
else
    warn "Servicio NO iniciado. Puedes iniciarlo con: sudo systemctl start vigilia-hub"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅  Instalación completada!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📝 Próximos pasos:"
echo "   1. Editar .env con tus credenciales reales:"
echo "      nano $INSTALL_DIR/.env"
echo ""
echo "   2. Verificar conexiones de hardware:"
echo "      - GPIO17, GPIO27 → Relés"
echo "      - GPIO5,6,13,19,26 → Multiplexor"
echo "      - USB Audio Interface conectada"
echo ""
echo "   3. Ver logs en tiempo real:"
echo "      sudo journalctl -u vigilia-hub -f"
echo ""
echo "   4. Controlar el servicio:"
echo "      sudo systemctl start|stop|restart|status vigilia-hub"
echo ""
echo "   5. Leer documentación completa:"
echo "      cat $INSTALL_DIR/README.md"
echo "      cat $INSTALL_DIR/INSTALLATION.md"
echo ""
echo "🎉 ¡Vigilia Hub instalado correctamente!"
echo ""
