#!/bin/bash

# ============================================================================
# Script: RPi Readiness Check
# Descripción: Verifica que la Raspberry Pi está lista para Vigilia Hub
# Uso: bash check-rpi-ready.sh
# ============================================================================

echo "╔═══════════════════════════════════════════════════╗"
echo "║   Vigilia Hub - Raspberry Pi Readiness Check     ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

PASS=0
FAIL=0
WARN=0

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================================
# Test 1: Sistema Operativo
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Test 1: Sistema Operativo"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo -e "${GREEN}✓${NC} OS Detectado: $PRETTY_NAME"
    if [[ "$ID" == "raspbian" ]] || [[ "$ID" == "debian" ]]; then
        PASS=$((PASS + 1))
    else
        echo -e "${YELLOW}⚠${NC} No es Raspberry Pi OS, pero puede funcionar"
        WARN=$((WARN + 1))
    fi
else
    echo -e "${RED}✗${NC} No se pudo detectar el sistema operativo"
    FAIL=$((FAIL + 1))
fi

# Solo 64-bit (Fase 4 · P8.C): Node.js >= 22.12 no se publica para armv7l.
ARCH=$(uname -m)
DPKG_ARCH=$(dpkg --print-architecture 2>/dev/null || echo "desconocida")
if [ "$ARCH" == "aarch64" ] && [ "$DPKG_ARCH" == "arm64" ]; then
    echo -e "${GREEN}✓${NC} Sistema 64-bit ($ARCH/$DPKG_ARCH)"
    PASS=$((PASS + 1))
else
    echo -e "${RED}✗${NC} Sistema no soportado (uname -m: $ARCH, paquetes: $DPKG_ARCH): se requiere Raspberry Pi OS 64-bit"
    echo "  Solución: reinstala la microSD con 'Raspberry Pi OS (64-bit)' (Bookworm) desde Raspberry Pi Imager"
    FAIL=$((FAIL + 1))
fi

# ============================================================================
# Test 2: Hardware (Raspberry Pi)
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🖥️  Test 2: Hardware"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f /proc/cpuinfo ]; then
    MODEL=$(cat /proc/cpuinfo | grep "Model" | head -n 1 | cut -d: -f2 | xargs)
    echo -e "${GREEN}✓${NC} Modelo: $MODEL"
    
    if [[ "$MODEL" == *"Raspberry Pi 3"* ]] || [[ "$MODEL" == *"Raspberry Pi 4"* ]]; then
        PASS=$((PASS + 1))
    else
        echo -e "${YELLOW}⚠${NC} No es RPi 3/4, rendimiento puede ser limitado"
        WARN=$((WARN + 1))
    fi
    
    # RAM
    TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
    echo "  RAM Total: ${TOTAL_RAM}MB"
    if [ "$TOTAL_RAM" -ge 1000 ]; then
        echo -e "  ${GREEN}✓${NC} RAM suficiente para Vigilia Hub"
        PASS=$((PASS + 1))
    else
        echo -e "  ${YELLOW}⚠${NC} RAM baja, puede tener problemas"
        WARN=$((WARN + 1))
    fi
else
    echo -e "${RED}✗${NC} No se pudo detectar información de hardware"
    FAIL=$((FAIL + 1))
fi

# ============================================================================
# Test 3: GPIO Access
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📍 Test 3: Acceso GPIO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -d /sys/class/gpio ]; then
    echo -e "${GREEN}✓${NC} Directorio /sys/class/gpio existe"
    PASS=$((PASS + 1))
    
    # Verificar permisos
    if groups | grep -q "gpio"; then
        echo -e "${GREEN}✓${NC} Usuario actual está en grupo 'gpio'"
        PASS=$((PASS + 1))
    else
        echo -e "${YELLOW}⚠${NC} Usuario NO está en grupo 'gpio'"
        echo "  Solución: sudo usermod -a -G gpio $USER && sudo reboot"
        WARN=$((WARN + 1))
    fi
else
    echo -e "${RED}✗${NC} GPIO no disponible"
    FAIL=$((FAIL + 1))
fi

# ============================================================================
# Test 4: Node.js
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💚 Test 4: Node.js"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✓${NC} Node.js instalado: $NODE_VERSION"
    
    # Verificar versión >= 22.12 (engines del hub)
    if node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'; then
        echo -e "${GREEN}✓${NC} Versión suficiente (requiere v22.12+)"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} Versión insuficiente (requiere v22.12+)"
        echo "  Instalación: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
        FAIL=$((FAIL + 1))
    fi
else
    echo -e "${RED}✗${NC} Node.js NO instalado"
    echo "  Instalación: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
    FAIL=$((FAIL + 1))
fi

# NPM
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo -e "${GREEN}✓${NC} npm instalado: v$NPM_VERSION"
    PASS=$((PASS + 1))
else
    echo -e "${RED}✗${NC} npm NO instalado"
    FAIL=$((FAIL + 1))
fi

# ============================================================================
# Test 5: Herramientas de Sistema
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Test 5: Herramientas de Sistema"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Git
if command -v git &> /dev/null; then
    GIT_VERSION=$(git --version | cut -d' ' -f3)
    echo -e "${GREEN}✓${NC} git: v$GIT_VERSION"
    PASS=$((PASS + 1))
else
    echo -e "${YELLOW}⚠${NC} git NO instalado (recomendado)"
    echo "  Instalación: sudo apt install -y git"
    WARN=$((WARN + 1))
fi

# WiringPi (opcional pero útil)
if command -v gpio &> /dev/null; then
    echo -e "${GREEN}✓${NC} wiringpi instalado"
    PASS=$((PASS + 1))
else
    echo -e "${YELLOW}⚠${NC} wiringpi NO instalado (recomendado para tests)"
    echo "  Instalación: sudo apt install -y wiringpi"
    WARN=$((WARN + 1))
fi

# ALSA (audio tools)
if command -v arecord &> /dev/null; then
    echo -e "${GREEN}✓${NC} ALSA tools instalado"
    PASS=$((PASS + 1))
else
    echo -e "${YELLOW}⚠${NC} ALSA tools NO instalado (necesario para audio)"
    echo "  Instalación: sudo apt install -y alsa-utils"
    WARN=$((WARN + 1))
fi

# Sox (conversión audio)
if command -v sox &> /dev/null; then
    echo -e "${GREEN}✓${NC} sox instalado"
    PASS=$((PASS + 1))
else
    echo -e "${YELLOW}⚠${NC} sox NO instalado (necesario para audio)"
    echo "  Instalación: sudo apt install -y sox"
    WARN=$((WARN + 1))
fi

# ============================================================================
# Test 6: Conectividad
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Test 6: Conectividad"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Ping Google DNS
if ping -c 1 8.8.8.8 &> /dev/null; then
    echo -e "${GREEN}✓${NC} Conexión a internet OK"
    PASS=$((PASS + 1))
else
    echo -e "${RED}✗${NC} Sin conexión a internet"
    FAIL=$((FAIL + 1))
fi

# DNS Resolution
if ping -c 1 google.com &> /dev/null; then
    echo -e "${GREEN}✓${NC} Resolución DNS OK"
    PASS=$((PASS + 1))
else
    echo -e "${YELLOW}⚠${NC} Problema con resolución DNS"
    WARN=$((WARN + 1))
fi

# ============================================================================
# Test 7: Espacio en Disco
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💾 Test 7: Espacio en Disco"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

FREE_SPACE=$(df -h / | awk 'NR==2 {print $4}' | sed 's/G//')
echo "  Espacio libre: ${FREE_SPACE}GB"

if (( $(echo "$FREE_SPACE > 2" | bc -l) )); then
    echo -e "${GREEN}✓${NC} Espacio suficiente"
    PASS=$((PASS + 1))
else
    echo -e "${YELLOW}⚠${NC} Poco espacio en disco (recomendado >2GB)"
    WARN=$((WARN + 1))
fi

# ============================================================================
# Test 8: Temperatura
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌡️  Test 8: Temperatura"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
    TEMP=$(cat /sys/class/thermal/thermal_zone0/temp)
    TEMP_C=$((TEMP / 1000))
    echo "  Temperatura CPU: ${TEMP_C}°C"
    
    if [ "$TEMP_C" -lt 70 ]; then
        echo -e "${GREEN}✓${NC} Temperatura normal"
        PASS=$((PASS + 1))
    elif [ "$TEMP_C" -lt 80 ]; then
        echo -e "${YELLOW}⚠${NC} Temperatura alta (considera ventilación)"
        WARN=$((WARN + 1))
    else
        echo -e "${RED}✗${NC} Temperatura crítica (¡necesitas ventilación!)"
        FAIL=$((FAIL + 1))
    fi
else
    echo -e "${YELLOW}⚠${NC} No se pudo leer temperatura"
    WARN=$((WARN + 1))
fi

# ============================================================================
# RESUMEN FINAL
# ============================================================================
echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║                 RESUMEN FINAL                     ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""
echo -e "  ${GREEN}✓ PASS:${NC} $PASS tests"
echo -e "  ${YELLOW}⚠ WARN:${NC} $WARN advertencias"
echo -e "  ${RED}✗ FAIL:${NC} $FAIL errores"
echo ""

# Decisión final
if [ "$FAIL" -eq 0 ] && [ "$WARN" -le 2 ]; then
    echo "╔═══════════════════════════════════════════════════╗"
    echo -e "║  ${GREEN}✅ RASPBERRY PI LISTA PARA VIGILIA HUB${NC}      ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo ""
    echo "Próximos pasos:"
    echo "1. cd ~"
    echo "2. git clone https://github.com/TU_USUARIO/vigilia-hub.git"
    echo "3. cd vigilia-hub"
    echo "4. npm install"
    echo "5. Ver docs/hardware/LABORATORY_SETUP.md"
    exit 0
elif [ "$FAIL" -eq 0 ]; then
    echo "╔═══════════════════════════════════════════════════╗"
    echo -e "║  ${YELLOW}⚠️  SISTEMA FUNCIONAL CON ADVERTENCIAS${NC}        ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo ""
    echo "Puedes continuar, pero revisa las advertencias arriba."
    exit 0
else
    echo "╔═══════════════════════════════════════════════════╗"
    echo -e "║  ${RED}❌ SISTEMA NO LISTO - REQUIERE CORRECCIONES${NC}  ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo ""
    echo "Corrige los errores (✗) antes de instalar Vigilia Hub."
    exit 1
fi
