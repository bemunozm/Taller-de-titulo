#!/usr/bin/env bash
# =============================================================================
# install.sh — instala el relay de cámaras de Vigilia en la Raspberry Pi 3B
# =============================================================================
# Raspberry Pi OS Lite 64-bit (Bookworm o Trixie). Idempotente: la segunda
# corrida no cambia nada que ya esté bien (cada paso compara antes de tocar).
#
#   sudo bash install.sh          (desde tu usuario: toma el admin de SUDO_USER)
#
# Hace, en orden:
# - paquetes: ffmpeg (por ffprobe), ufw y unattended-upgrades;
# - UFW ANTES que Tailscale, para que tailscaled use el modo iptables y ponga
#   ts-input primero;
# - Tailscale desde su repo apt oficial, con el keyring verificado por
#   fingerprint (sin curl|sh);
# - watchdog, journald, swap fuera de la SD, noatime, avahi/Bluetooth/Wi-Fi
#   apagados y unattended-upgrades (seguridad + Raspberry Pi, sin reinicio);
# - usuarios de sistema vigilia-relay (MediaMTX) y vigilia-probe (ffprobe),
#   ambos en /etc/cron.deny;
# - el kit en /opt/vigilia-relay (conserva mediamtx.prev) y MediaMTX v1.15.2
#   con SHA256 fijado (solo el binario: el tar trae un mediamtx.yml con todo
#   abierto);
# - /etc/vigilia-relay, las unidades systemd y sshd (solo clave, solo el
#   admin);
# - vigilia-relay-follow-nvr.timer: sigue la IP del NVR (DHCP) por su MAC;
# - cloud-init (Trixie): si ya terminó, lo deshabilita y borra las copias de la
#   clave del Wi-Fi y del hash de la clave: /boot/firmware/network-config y
#   user-data, /var/lib/cloud, sus logs y los perfiles Wi-Fi de NetworkManager
#   y netplan (nunca uno que configure eth0);
# - sudo: timestamp_type=tty (cada sesión pide su clave) y, al final, borra
#   /etc/sudoers.d/010_pi-nopasswd verificando con `sudo -l` que el admin
#   conserva sudo por grupo (si no, lo restaura).
#
# NO corre `tailscale up` (es interactivo y no tiene timeout): lo imprime al
# final junto con los pasos siguientes.
#
# Actualización remota: ver README, "Actualizar el kit". systemd-run
# desacopla la instalación de la sesión SSH (si tailscaled se reinicia a
# mitad, sigue); el admin va en VIGILIA_RELAY_ADMIN_USER porque systemd-run
# no hereda SUDO_USER:
#   sudo systemd-run --unit=vigilia-relay-update --collect \
#       --setenv=VIGILIA_RELAY_ADMIN_USER="$USER" bash ~/vigilia-relay-kit/camera-relay/install.sh
# =============================================================================
set -euo pipefail

MEDIAMTX_VERSION="v1.15.2"
MEDIAMTX_TARBALL="mediamtx_${MEDIAMTX_VERSION}_linux_arm64.tar.gz"
# checksums.sha256 del release v1.15.2 (= digest del asset en la API de GitHub).
MEDIAMTX_SHA256="c9ad9ae5f93c1a84a3a52055f630687498b98566e735b5177ed604fefa7072b5"
# SHA256 del binario `mediamtx` dentro de ese tar: decide si ya está instalado
# (un --version se puede falsificar; el hash no).
MEDIAMTX_BINARY_SHA256="3785d687628169df5a1686b763af564e10050bf1a4cffc85e6b4e8d2d38c4be0"
MEDIAMTX_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${MEDIAMTX_TARBALL}"
EXPECTED_ARCH="aarch64"
EXPECTED_DPKG_ARCH="arm64"

# "Tailscale Inc. (Package repository signing key) <info@tailscale.com>",
# rsa4096 de 2020-02-25; mismo keyring para bookworm y trixie
# (pkgs.tailscale.com/stable/debian/<codename>.noarmor.gpg).
TAILSCALE_KEY_FINGERPRINT="2596A99EAAB33821893C0A79458CA832957F5868"
TAILSCALE_KEYRING="/usr/share/keyrings/tailscale-archive-keyring.gpg"
TAILSCALE_LIST="/etc/apt/sources.list.d/tailscale.list"

SERVICE_USER="vigilia-relay"
PROBE_USER="vigilia-probe"
OPT_DIR="/opt/vigilia-relay"
ETC_DIR="/etc/vigilia-relay"
CLI="/usr/local/bin/vigilia-relay"
SSHD_DROPIN="/etc/ssh/sshd_config.d/10-vigilia-relay.conf"
NOPASSWD_SUDOERS="/etc/sudoers.d/010_pi-nopasswd"
KIT_DIR="$(builtin cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURL=(curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2)

export DEBIAN_FRONTEND=noninteractive

# --- helpers (mismo estilo que vigilia-hub/install.sh) -------------------------------
if [[ -t 1 ]]; then
    RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BOLD=''; NC=''
fi

info() {
    echo "${GREEN}✓${NC} $1"
}

warn() {
    echo "${YELLOW}⚠${NC} $1"
}

error() {
    echo "${RED}✗${NC} $1" >&2
    exit 1
}

step() {
    echo ""
    echo "${BOLD}== $1${NC}"
}

CHANGES=0
NEEDS_REBOOT=0
RESTART_RELAY=0
SUDO_SUMMARY=""

changed() {
    CHANGES=$((CHANGES + 1))
    info "$1"
}

# install_file <origen> <destino> <modo>: copia solo si el contenido cambió.
# Devuelve 0 si escribió y 1 si ya estaba igual (usar dentro de un `if`).
install_file() {
    local source="$1" target="$2" mode="$3"
    if [[ -f "$target" ]] && cmp -s "$source" "$target"; then
        chmod "$mode" "$target"
        chown root:root "$target"
        return 1
    fi
    install -D -m "$mode" -o root -g root "$source" "$target"
    return 0
}

# Temporales en /var/tmp: /tmp puede estar montado noexec y ahí se ejecuta
# el binario descargado para leer su versión.
TEMP_DIR=""
temp_dir() {
    if [[ -z "$TEMP_DIR" ]]; then
        TEMP_DIR="$(mktemp -d -p /var/tmp vigilia-relay-install.XXXXXX)"
    fi
}
cleanup() {
    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        rm -rf -- "$TEMP_DIR"
    fi
}
trap cleanup EXIT

# --- 1. chequeos -------------------------------------------------------------------
check_platform() {
    step "Chequeos"
    if [[ "${EUID}" -ne 0 ]]; then
        error "Corre el instalador como root: sudo bash install.sh"
    fi
    # Mismo criterio que vigilia-hub (Fase 4 · P8.C): kernel Y userland de 64 bits.
    local arch dpkg_arch
    arch="$(uname -m)"
    dpkg_arch="$(dpkg --print-architecture 2> /dev/null || echo desconocida)"
    if [[ "$arch" != "$EXPECTED_ARCH" || "$dpkg_arch" != "$EXPECTED_DPKG_ARCH" ]]; then
        error "Sistema no soportado (uname -m: $arch, paquetes: $dpkg_arch). Usa Raspberry Pi OS Lite (64-bit) desde Raspberry Pi Imager."
    fi
    CODENAME="$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release | tr -d '"')"
    case "$CODENAME" in
        bookworm | trixie) ;;
        *) error "Versión de Raspberry Pi OS no soportada: '${CODENAME:-?}' (se espera bookworm o trixie)" ;;
    esac
    info "Raspberry Pi OS 64-bit ($arch/$dpkg_arch, $CODENAME)"

    # El admin (usuario de Raspberry Pi Imager): el único que entra por SSH de
    # la LAN. systemd-run no hereda SUDO_USER: ahí va VIGILIA_RELAY_ADMIN_USER.
    ADMIN_USER="${VIGILIA_RELAY_ADMIN_USER:-${SUDO_USER:-}}"
    if [[ -z "$ADMIN_USER" || "$ADMIN_USER" == "root" ]]; then
        error "No sé quién es el admin: corre 'sudo bash install.sh' desde tu usuario (no como root directo) o define VIGILIA_RELAY_ADMIN_USER."
    fi
    if [[ ! "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || ! getent passwd "$ADMIN_USER" > /dev/null; then
        error "El usuario admin '$ADMIN_USER' no existe o no es válido."
    fi
    info "Admin: $ADMIN_USER"

    for file in vigilia_relay.py netwatch.sh VERSION relay.env.example cameras.conf.example \
        systemd/vigilia-relay.service systemd/vigilia-relay-netwatch.service systemd/vigilia-relay-netwatch.timer \
        systemd/vigilia-relay-follow-nvr.service systemd/vigilia-relay-follow-nvr.timer \
        system/watchdog.conf system/journald.conf system/52vigilia-relay system/rpi-swap.conf; do
        if [[ ! -f "$KIT_DIR/$file" ]]; then
            error "Falta $file en $KIT_DIR: copia el kit completo (carpeta camera-relay)"
        fi
    done
    info "Kit $(cat "$KIT_DIR/VERSION") en $KIT_DIR"
}

# UFW deja pasar SSH solo por eth0 (y tailscale0). Si esta sesión entró por
# otra interfaz (p. ej. Wi-Fi), habilitar UFW la cortaría.
check_ssh_interface() {
    local local_address iface
    while read -r local_address; do
        local_address="${local_address%:*}"
        local_address="${local_address#[}"
        local_address="${local_address%]}"
        local_address="${local_address%%\%*}"
        iface="$(ip -o addr show 2> /dev/null | awk -v addr="$local_address" '{ split($4, a, "/"); if (a[1] == addr) { print $2; exit } }' || true)"
        case "$iface" in
            eth0 | tailscale0 | lo | "") ;;
            *)
                if [[ "${VIGILIA_RELAY_FORCE_UFW:-0}" != "1" ]]; then
                    error "Hay una sesión SSH por $iface: UFW solo deja SSH por eth0 y te cortaría. Conéctate por Ethernet (o define VIGILIA_RELAY_FORCE_UFW=1)."
                fi
                ;;
        esac
    done < <(ss -Htn state established '( sport = :22 )' 2> /dev/null | awk '{ print $3 }')
}

# --- 2. paquetes --------------------------------------------------------------------
# Con pipefail, `cmd | grep -q` falla si grep corta antes de que cmd termine
# de escribir (SIGPIPE): la salida se captura primero y se busca después.
package_installed() {
    local status
    # shellcheck disable=SC2016 # ${Status} es un campo de dpkg-query, no de bash
    status="$(dpkg-query -W -f='${Status}' "$1" 2> /dev/null || true)"
    [[ "$status" == "install ok installed" ]]
}

unit_exists() {
    local listing
    listing="$(systemctl list-unit-files "$1" 2> /dev/null || true)"
    grep -q "^$1" <<< "$listing"
}

install_packages() {
    step "Paquetes"
    local packages=(ffmpeg ufw unattended-upgrades gpg ca-certificates curl iputils-ping iperf3 python3)
    local missing=() package
    for package in "${packages[@]}"; do
        if ! package_installed "$package"; then
            missing+=("$package")
        fi
    done
    if [[ ${#missing[@]} -eq 0 ]]; then
        info "Paquetes ya instalados"
        return
    fi
    apt-get update
    apt-get install -y --no-install-recommends "${missing[@]}"
    changed "Instalado: ${missing[*]}"
}

# --- 3. UFW (antes que Tailscale) -------------------------------------------------------
configure_ufw() {
    step "Firewall (UFW, antes que Tailscale)"
    local before after
    before="$(ufw status verbose 2> /dev/null || true)"
    ufw default deny incoming > /dev/null
    ufw default allow outgoing > /dev/null
    ufw default deny routed > /dev/null
    # El tailnet lo filtra la ACL de Tailscale (ts-input va antes que UFW).
    ufw allow in on tailscale0 comment 'vigilia-relay: tailnet (filtra la ACL)' > /dev/null
    ufw allow 41641/udp comment 'vigilia-relay: Tailscale directo' > /dev/null
    ufw allow in on eth0 to any port 22 proto tcp comment 'vigilia-relay: SSH local de respaldo' > /dev/null
    # Solo si está inactivo: re-habilitarlo recargaría las reglas sin necesidad.
    local status
    status="$(ufw status 2> /dev/null || true)"
    if ! grep -q '^Status: active' <<< "$status"; then
        ufw --force enable > /dev/null
    fi
    after="$(ufw status verbose)"
    if [[ "$before" != "$after" ]]; then
        changed "UFW: deny incoming; tailscale0, 41641/udp y 22/tcp por eth0"
    else
        info "UFW ya configurado"
    fi
}

# --- 4. Tailscale (repo apt oficial, keyring verificado) ----------------------------------
keyring_fingerprints() {
    local gnupg_home
    gnupg_home="$(mktemp -d -p /var/tmp vigilia-relay-gnupg.XXXXXX)"
    GNUPGHOME="$gnupg_home" gpg --batch --quiet --with-colons --show-keys --with-fingerprint "$1" 2> /dev/null |
        awk -F: '$1 == "pub" { want = 1; next } $1 == "fpr" && want { print $10; want = 0 }'
    rm -rf -- "$gnupg_home"
}

keyring_is_trusted() {
    local fingerprints
    fingerprints="$(keyring_fingerprints "$1")"
    # Exactamente una clave primaria, y es la de Tailscale.
    [[ "$fingerprints" == "$TAILSCALE_KEY_FINGERPRINT" ]]
}

install_tailscale() {
    step "Tailscale"
    if [[ ! -f "$TAILSCALE_KEYRING" ]] || ! keyring_is_trusted "$TAILSCALE_KEYRING"; then
        temp_dir
        local key="$TEMP_DIR/tailscale.noarmor.gpg"
        "${CURL[@]}" -o "$key" "https://pkgs.tailscale.com/stable/debian/${CODENAME}.noarmor.gpg"
        if ! keyring_is_trusted "$key"; then
            error "El keyring descargado de pkgs.tailscale.com NO tiene el fingerprint esperado ($TAILSCALE_KEY_FINGERPRINT): no se instala nada"
        fi
        install -D -m 0644 -o root -g root "$key" "$TAILSCALE_KEYRING"
        changed "Keyring de Tailscale verificado ($TAILSCALE_KEY_FINGERPRINT)"
    else
        info "Keyring de Tailscale ya verificado"
    fi

    local list_line="deb [signed-by=${TAILSCALE_KEYRING}] https://pkgs.tailscale.com/stable/debian ${CODENAME} main"
    if [[ ! -f "$TAILSCALE_LIST" ]] || [[ "$(cat "$TAILSCALE_LIST")" != "$list_line" ]]; then
        printf '%s\n' "$list_line" > "$TAILSCALE_LIST"
        chmod 0644 "$TAILSCALE_LIST"
        changed "Repo apt de Tailscale ($CODENAME)"
        apt-get update
    fi

    if ! package_installed tailscale; then
        apt-get install -y --no-install-recommends tailscale
        changed "Tailscale instalado"
    else
        info "Tailscale ya instalado ($(tailscale version 2> /dev/null | head -n 1))"
    fi
    if ! systemctl is-enabled --quiet tailscaled.service || ! systemctl is-active --quiet tailscaled.service; then
        systemctl enable --now tailscaled.service
        changed "tailscaled habilitado"
    fi
    if tailscale set --auto-update > /dev/null 2>&1; then
        info "tailscale set --auto-update"
    else
        warn "tailscale set --auto-update falló (normal antes de 'tailscale up'): córrelo después"
    fi
}

# --- 5. sistema ---------------------------------------------------------------------------
configure_system() {
    step "Sistema (watchdog, journald, swap, noatime, avahi, Bluetooth, Wi-Fi, actualizaciones)"

    if install_file "$KIT_DIR/system/watchdog.conf" /etc/systemd/system.conf.d/90-vigilia-relay-watchdog.conf 0644; then
        systemctl daemon-reexec
        changed "Watchdog: RuntimeWatchdogSec=15s, RebootWatchdogSec=2min (daemon-reexec)"
    else
        info "Watchdog ya configurado"
    fi

    if install_file "$KIT_DIR/system/journald.conf" /etc/systemd/journald.conf.d/90-vigilia-relay.conf 0644; then
        install -d -m 2755 -o root -g systemd-journal /var/log/journal
        systemctl restart systemd-journald.service
        changed "journald: persistente, SystemMaxUse=64M, 14 días"
    else
        info "journald ya configurado"
    fi

    if install_file "$KIT_DIR/system/52vigilia-relay" /etc/apt/apt.conf.d/52vigilia-relay 0644; then
        changed "unattended-upgrades: seguridad de Debian + Raspberry Pi, sin reinicio automático"
    else
        info "unattended-upgrades ya configurado"
    fi

    # Swap fuera de la SD: Bookworm usa dphys-swapfile; Trixie, rpi-swap.
    if command -v dphys-swapfile > /dev/null 2>&1; then
        if systemctl is-enabled --quiet dphys-swapfile.service 2> /dev/null || [[ -f /var/swap ]]; then
            dphys-swapfile swapoff || true
            dphys-swapfile uninstall || true
            systemctl disable --now dphys-swapfile.service > /dev/null 2>&1 || true
            changed "Swapfile de la SD desactivado (dphys-swapfile)"
        fi
    fi
    if [[ -f /etc/rpi/swap.conf ]]; then
        if install_file "$KIT_DIR/system/rpi-swap.conf" /etc/rpi/swap.conf.d/90-vigilia-relay.conf 0644; then
            NEEDS_REBOOT=1
            changed "rpi-swap: solo zram, sin archivo en la SD (al reiniciar)"
        fi
    fi
    local swaps root_options
    swaps="$(swapon --show=TYPE --noheadings 2> /dev/null || true)"
    if grep -qx file <<< "$swaps"; then
        warn "Sigue activo un swap en archivo (se va al reiniciar si es /var/swap): revisa 'swapon --show'"
    fi

    # noatime en la raíz (Raspberry Pi OS ya lo trae; se agrega si falta).
    root_options="$(findmnt -no OPTIONS / 2> /dev/null || true)"
    if ! tr ',' '\n' <<< "$root_options" | grep -qx noatime; then
        if awk '$2 == "/" { found = 1 } END { exit !found }' /etc/fstab; then
            cp -p /etc/fstab /etc/fstab.vigilia-relay.bak
            awk 'BEGIN { OFS = "\t" } $1 !~ /^#/ && $2 == "/" && $4 !~ /(^|,)noatime(,|$)/ { $4 = $4 ",noatime" } { print }' \
                /etc/fstab.vigilia-relay.bak > /etc/fstab.vigilia-relay.new
            mv -f /etc/fstab.vigilia-relay.new /etc/fstab
            mount -o remount,noatime /
            changed "noatime en / (respaldo: /etc/fstab.vigilia-relay.bak)"
        else
            warn "No encontré la raíz en /etc/fstab: agrega noatime a mano"
        fi
    fi

    # avahi y Bluetooth: superficie que el relay no usa.
    local unit
    for unit in avahi-daemon.socket avahi-daemon.service bluetooth.service hciuart.service; do
        if unit_exists "$unit"; then
            if [[ "$(systemctl is-enabled "$unit" 2> /dev/null || true)" != "masked" ]]; then
                systemctl disable --now "$unit" > /dev/null 2>&1 || true
                systemctl mask "$unit" > /dev/null 2>&1
                changed "$unit apagado y enmascarado"
            fi
        fi
    done
    # Bluetooth y Wi-Fi apagados en el firmware (radios que el relay no usa;
    # para reactivar el Wi-Fi: borrar la línea disable-wifi y reiniciar).
    local boot_config="" candidate overlay
    for candidate in /boot/firmware/config.txt /boot/config.txt; do
        if [[ -f "$candidate" ]]; then
            boot_config="$candidate"
            break
        fi
    done
    if [[ -n "$boot_config" ]]; then
        local missing_overlays=()
        for overlay in disable-bt disable-wifi; do
            if ! grep -qx "dtoverlay=$overlay" "$boot_config"; then
                missing_overlays+=("$overlay")
            fi
        done
        if [[ ${#missing_overlays[@]} -gt 0 ]]; then
            {
                printf '\n# vigilia-relay: radios apagadas (ver README)\n[all]\n'
                for overlay in "${missing_overlays[@]}"; do
                    printf 'dtoverlay=%s\n' "$overlay"
                done
            } >> "$boot_config"
            NEEDS_REBOOT=1
            changed "${missing_overlays[*]} en $boot_config (al reiniciar)"
        fi
    fi
}

# --- 6. usuarios, kit y MediaMTX ---------------------------------------------------------------
create_users() {
    step "Usuarios de sistema"
    local user
    for user in "$SERVICE_USER" "$PROBE_USER"; do
        if getent passwd "$user" > /dev/null; then
            info "Usuario $user ya existe"
            continue
        fi
        useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$user"
        changed "Usuario de sistema $user"
    done
    # Los usuarios de servicio no programan nada (cron sin cron.allow lee cron.deny).
    local cron_deny=/etc/cron.deny added=()
    if [[ ! -f "$cron_deny" ]]; then
        install -m 0644 -o root -g root /dev/null "$cron_deny"
    elif [[ -s "$cron_deny" && -n "$(tail -c 1 "$cron_deny")" ]]; then
        printf '\n' >> "$cron_deny" # termina la última línea antes de agregar
    fi
    for user in "$SERVICE_USER" "$PROBE_USER"; do
        if ! grep -qx "$user" "$cron_deny"; then
            printf '%s\n' "$user" >> "$cron_deny"
            added+=("$user")
        fi
    done
    if [[ ${#added[@]} -gt 0 ]]; then
        changed "cron.deny: ${added[*]}"
    else
        info "cron.deny ya incluye $SERVICE_USER y $PROBE_USER"
    fi
}

install_kit() {
    step "Kit en $OPT_DIR"
    install -d -m 0755 -o root -g root "$OPT_DIR" "$OPT_DIR/bin"
    local any=0 file mode
    for file in vigilia_relay.py netwatch.sh VERSION README.md relay.env.example cameras.conf.example \
        tailscale-acl.example.hujson install.sh \
        systemd/vigilia-relay.service systemd/vigilia-relay-netwatch.service systemd/vigilia-relay-netwatch.timer \
        systemd/vigilia-relay-follow-nvr.service systemd/vigilia-relay-follow-nvr.timer \
        system/watchdog.conf system/journald.conf system/52vigilia-relay system/rpi-swap.conf; do
        if [[ ! -f "$KIT_DIR/$file" ]]; then
            continue
        fi
        mode=0644
        case "$file" in
            *.py | *.sh) mode=0755 ;;
        esac
        # Corriendo desde /opt/vigilia-relay no hay nada que copiar.
        if [[ "$KIT_DIR/$file" -ef "$OPT_DIR/$file" ]]; then
            continue
        fi
        if install_file "$KIT_DIR/$file" "$OPT_DIR/$file" "$mode"; then
            any=1
        fi
    done
    if install_file "$KIT_DIR/vigilia_relay.py" "$CLI" 0755; then
        any=1
    fi
    if [[ $any -eq 1 ]]; then
        changed "Kit $(cat "$KIT_DIR/VERSION") copiado (CLI: $CLI)"
    else
        info "Kit ya al día"
    fi
}

sha256_of() {
    sha256sum "$1" | awk '{ print $1 }'
}

install_mediamtx() {
    step "MediaMTX $MEDIAMTX_VERSION"
    local binary="$OPT_DIR/bin/mediamtx"
    if [[ -f "$binary" ]] && [[ "$(sha256_of "$binary")" == "$MEDIAMTX_BINARY_SHA256" ]]; then
        info "MediaMTX $MEDIAMTX_VERSION ya instalado (SHA256 del binario verificado)"
        return
    fi
    temp_dir
    local tarball="$TEMP_DIR/$MEDIAMTX_TARBALL"
    if [[ -f "$KIT_DIR/$MEDIAMTX_TARBALL" ]]; then
        cp "$KIT_DIR/$MEDIAMTX_TARBALL" "$tarball"
        info "Usando $MEDIAMTX_TARBALL del kit (sin descarga)"
    else
        "${CURL[@]}" -o "$tarball" "$MEDIAMTX_URL"
    fi
    if [[ "$(sha256_of "$tarball")" != "$MEDIAMTX_SHA256" ]]; then
        error "SHA256 de $MEDIAMTX_TARBALL no coincide: no se instala"
    fi
    # Solo el binario: el mediamtx.yml del tar trae todo abierto.
    tar -xzf "$tarball" -C "$TEMP_DIR" --no-same-owner mediamtx
    if [[ "$(sha256_of "$TEMP_DIR/mediamtx")" != "$MEDIAMTX_BINARY_SHA256" ]]; then
        error "El binario extraído no tiene el SHA256 esperado: no se instala"
    fi
    local version
    version="$("$TEMP_DIR/mediamtx" --version)"
    if [[ "$version" != "$MEDIAMTX_VERSION" ]]; then
        error "El binario extraído dice $version y no $MEDIAMTX_VERSION"
    fi
    if [[ -f "$binary" ]]; then
        cp -p "$binary" "$OPT_DIR/bin/mediamtx.prev"
        info "Versión anterior en $OPT_DIR/bin/mediamtx.prev"
    fi
    install -m 0755 -o root -g root "$TEMP_DIR/mediamtx" "$binary.new"
    mv -f "$binary.new" "$binary"
    RESTART_RELAY=1
    changed "MediaMTX $MEDIAMTX_VERSION instalado (SHA256 del tar y del binario verificados)"
}

# --- 7. /etc/vigilia-relay -------------------------------------------------------------------
configure_etc() {
    step "Configuración en $ETC_DIR"
    install -d -m 0750 -o root -g "$SERVICE_USER" "$ETC_DIR"
    if [[ ! -f "$ETC_DIR/relay.env" ]]; then
        # umask 077: el archivo nunca existe con permisos abiertos.
        (umask 077 && cp "$KIT_DIR/relay.env.example" "$ETC_DIR/relay.env")
        changed "relay.env creado desde relay.env.example"
    fi
    local file
    for file in relay.env cameras.conf api.secret reader.hash; do
        if [[ -f "$ETC_DIR/$file" ]]; then
            chown root:root "$ETC_DIR/$file"
            chmod 600 "$ETC_DIR/$file"
        fi
    done
    local output
    output="$("$CLI" init)"
    echo "  $output"
    if [[ "$output" != *"sin cambios"* ]]; then
        CHANGES=$((CHANGES + 1))
    fi
}

# --- 8. unidades systemd --------------------------------------------------------------------
install_units() {
    step "Servicios systemd"
    local unit any=0 timer
    for unit in vigilia-relay.service vigilia-relay-netwatch.service vigilia-relay-netwatch.timer \
        vigilia-relay-follow-nvr.service vigilia-relay-follow-nvr.timer; do
        if install_file "$KIT_DIR/systemd/$unit" "/etc/systemd/system/$unit" 0644; then
            any=1
            if [[ "$unit" == "vigilia-relay.service" ]]; then
                RESTART_RELAY=1
            fi
        fi
    done
    # Donde `apply` (y follow-nvr) escriben el drop-in de IPAddressAllow; tiene
    # que existir para el ReadWritePaths de vigilia-relay-follow-nvr.service.
    if [[ ! -d /etc/systemd/system/vigilia-relay.service.d ]]; then
        install -d -m 0755 -o root -g root /etc/systemd/system/vigilia-relay.service.d
        any=1
    fi
    if [[ $any -eq 1 ]]; then
        systemctl daemon-reload
        changed "Unidades instaladas"
    fi
    if ! systemctl is-enabled --quiet vigilia-relay.service; then
        systemctl enable vigilia-relay.service > /dev/null 2>&1
        changed "vigilia-relay.service habilitado"
    fi
    for timer in vigilia-relay-netwatch.timer vigilia-relay-follow-nvr.timer; do
        if ! systemctl is-enabled --quiet "$timer"; then
            systemctl enable "$timer" > /dev/null 2>&1
            changed "$timer habilitado"
        fi
        if ! systemctl is-active --quiet "$timer"; then
            systemctl start "$timer"
        fi
    done
    if ! systemctl is-active --quiet vigilia-relay.service; then
        systemctl start vigilia-relay.service
        changed "vigilia-relay.service iniciado"
    elif [[ $RESTART_RELAY -eq 1 ]]; then
        systemctl restart vigilia-relay.service
        changed "vigilia-relay.service reiniciado (binario o unidad nuevos)"
    fi
    sleep 2
    if systemctl is-active --quiet vigilia-relay.service; then
        info "vigilia-relay.service activo"
    else
        warn "vigilia-relay.service no está activo: journalctl -u vigilia-relay -n 50"
    fi
}

# --- 9. sshd (SSH de la LAN: solo clave, solo el admin) ------------------------------------------
configure_sshd() {
    step "SSH por la LAN (sshd)"
    if ! command -v sshd > /dev/null 2>&1; then
        warn "sshd no está instalado: se omite (Tailscale SSH no lo necesita)"
        return
    fi
    temp_dir
    local generated="$TEMP_DIR/sshd-vigilia-relay.conf"
    {
        printf '# %s (lo genera install.sh del relay; se reescribe en cada corrida)\n' "$SSHD_DROPIN"
        printf '# SSH por la LAN (eth0:22, respaldo local): solo clave pública y solo el admin.\n'
        printf '# Tailscale SSH no pasa por sshd: lo controla la ACL del tailnet.\n'
        printf 'PasswordAuthentication no\n'
        printf 'KbdInteractiveAuthentication no\n'
        printf 'PermitRootLogin no\n'
        printf 'AllowUsers %s\n' "$ADMIN_USER"
    } > "$generated"
    local wrote=0
    if install_file "$generated" "$SSHD_DROPIN" 0644; then
        wrote=1
    fi
    # sshd -t/-T necesitan el directorio de privilegios separados.
    install -d -m 0755 /run/sshd
    if ! sshd -t 2> /dev/null; then
        if [[ $wrote -eq 1 ]]; then
            rm -f -- "$SSHD_DROPIN"
        fi
        error "sshd -t rechaza la configuración: se quitó $SSHD_DROPIN; revisa /etc/ssh/sshd_config"
    fi
    local effective expected
    effective="$(sshd -T 2> /dev/null)"
    for expected in "passwordauthentication no" "kbdinteractiveauthentication no" "permitrootlogin no" "allowusers $ADMIN_USER"; do
        if ! grep -qx "$expected" <<< "$effective"; then
            error "sshd no quedó con '$expected' (otro archivo de /etc/ssh/sshd_config.d lo pisa?): revisa 'sshd -T'"
        fi
    done
    if [[ $wrote -eq 1 ]]; then
        if systemctl is-active --quiet ssh.service; then
            systemctl reload ssh.service
        fi
        changed "sshd: solo clave pública, sin root, AllowUsers $ADMIN_USER"
    else
        info "sshd ya configurado (verificado con sshd -T)"
    fi
}

# --- 9b. cloud-init (Trixie): la clave del Wi-Fi quedó en la partición de arranque y en el rootfs ---
# Tipos de interfaz de netplan que NO son Wi-Fi: un YAML que tenga alguno no se borra.
NETPLAN_OTHER_DEVICES='^[[:space:]]*(ethernets|bonds|bridges|vlans|tunnels|modems|nm-devices|vrfs|dummy-devices|virtual-ethernets):'
# Lo que netplan tiene que ver igual antes y después de borrar un YAML de solo Wi-Fi.
NETPLAN_KEYS=(renderer ethernets bonds bridges vlans tunnels modems nm-devices vrfs dummy-devices virtual-ethernets)
WIFI_LEFT=0 # 1 si quedó alguna copia de la clave del Wi-Fi sin borrar (con aviso)
# Rutas (variables solo para que los tests apunten a una carpeta temporal).
CLOUD_STATE_DIR=/var/lib/cloud
CLOUD_LOGS=(/var/log/cloud-init.log /var/log/cloud-init-output.log)
NM_CONNECTIONS_DIR=/etc/NetworkManager/system-connections
NETPLAN_DIR=/etc/netplan
NETPLAN_OTHER_DIRS=(/run/netplan /lib/netplan) # netplan también lee estas

configure_cloud_init() {
    step "cloud-init"
    if ! command -v cloud-init > /dev/null 2>&1; then
        info "cloud-init no está instalado"
        return
    fi
    local status
    status="$(cloud-init status 2> /dev/null || true)"
    # Solo con el primer arranque ya terminado ("done"), o si ya se deshabilitó.
    if ! grep -Eq '^status: (done|disabled)$' <<< "$status"; then
        warn "cloud-init no terminó (${status:-sin estado}): no se toca; corre install.sh de nuevo después"
        return
    fi
    local before=$CHANGES
    if [[ ! -f /etc/cloud/cloud-init.disabled ]]; then
        install -D -m 0644 -o root -g root /dev/null /etc/cloud/cloud-init.disabled
        changed "cloud-init deshabilitado (/etc/cloud/cloud-init.disabled)"
    fi
    local file
    for file in /boot/firmware/network-config /boot/firmware/user-data; do
        if [[ -f "$file" ]]; then
            rm -f -- "$file"
            changed "Borrado $file (traía la clave del Wi-Fi o el hash de la clave del usuario, en texto plano)"
        fi
    done
    remove_cloud_init_data
    remove_wifi_profiles
    if ((CHANGES == before && WIFI_LEFT == 0)); then
        info "cloud-init ya deshabilitado y sin copias de la clave del Wi-Fi (/boot/firmware, /var/lib/cloud, NetworkManager, netplan)"
    fi
}

# Datos de la instancia (user-data, network-config, obj.pkl) y logs de cloud-init:
# copias de la clave del Wi-Fi y del hash. cloud-init.disabled queda en /etc/cloud.
remove_cloud_init_data() {
    if [[ -d "$CLOUD_STATE_DIR" ]] && [[ -n "$(find "$CLOUD_STATE_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
        if find "$CLOUD_STATE_DIR" -mindepth 1 -delete; then
            changed "Borrada la caché de cloud-init ($CLOUD_STATE_DIR: datos de la instancia, con copias de network-config y user-data)"
        else
            warn "No se pudo vaciar $CLOUD_STATE_DIR: revísalo a mano"
        fi
    fi
    local log
    for log in "${CLOUD_LOGS[@]}"; do
        if [[ -f "$log" ]]; then
            rm -f -- "$log"
            changed "Borrado $log (registra la config de red y de usuarios de cloud-init)"
        fi
    done
}

# nm_connection_key <archivo> <clave>: valor de <clave> en la sección [connection].
nm_connection_key() {
    awk -v key="$2" '
        /^[[:space:]]*\[/ { section = $0; gsub(/[[:space:]]/, "", section); next }
        section == "[connection]" && index($0, "=") {
            name = substr($0, 1, index($0, "=") - 1); gsub(/[[:space:]]/, "", name)
            if (name == key) { value = substr($0, index($0, "=") + 1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value; exit }
        }
    ' "$1"
}

# eth0 con IPv4 y la ruta por defecto por eth0: borrar el Wi-Fi no corta el acceso.
eth0_is_primary() {
    local routes addresses
    routes="$(ip -4 route show default 2> /dev/null || true)"
    addresses="$(ip -4 -o addr show dev eth0 2> /dev/null || true)"
    [[ -n "$addresses" ]] && grep -Eq '(^|[[:space:]])dev eth0([[:space:]]|$)' <<< "$routes"
}

netplan_available() {
    command -v netplan > /dev/null 2>&1
}

# netplan_rest <raíz>: la config de red que NO es Wi-Fi, como la ve netplan.
netplan_rest() {
    local root="$1" key value
    for key in "${NETPLAN_KEYS[@]}"; do
        value="$(netplan get --root-dir "$root" "$key" 2> /dev/null)" || return 1
        printf '%s: %s\n' "$key" "$value"
    done
}

# copy_netplan_tree <destino>: copia de los YAML de netplan para simular un borrado.
copy_netplan_tree() {
    local dest="$1" dir
    for dir in "$NETPLAN_DIR" "${NETPLAN_OTHER_DIRS[@]}"; do
        if [[ -d "$dir" ]]; then
            mkdir -p "$dest$(dirname "$dir")"
            cp -a -- "$dir" "$dest$dir"
        fi
    done
}

# Perfiles Wi-Fi del rootfs con la clave en claro (cloud-init los genera desde
# network-config). Prioridad: NUNCA cortar eth0. No se borra:
# - un perfil de NetworkManager que no sea Wi-Fi (o que nombre a eth0);
# - un YAML de netplan que, además del Wi-Fi, configure eth0 u otra interfaz
#   (se avisa y se explica cómo quitar solo el Wi-Fi);
# - nada, si eth0 no es la interfaz principal (el Wi-Fi podría ser la conexión).
# /run (RAM) no se toca: no queda en la SD.
remove_wifi_profiles() {
    local nm_dir="$NM_CONNECTIONS_DIR" file kind iface
    local -a nm_wifi=() netplan_wifi=() netplan_mixed=()
    if [[ -d "$nm_dir" ]]; then
        for file in "$nm_dir"/*; do
            [[ -f "$file" ]] || continue
            kind="$(nm_connection_key "$file" type)"
            iface="$(nm_connection_key "$file" interface-name)"
            if [[ "$kind" == wifi || "$kind" == 802-11-wireless ]] && [[ "$iface" != eth0 ]]; then
                nm_wifi+=("$file")
            fi
        done
    fi
    for file in "$NETPLAN_DIR"/*.yaml "$NETPLAN_DIR"/*.yml; do
        [[ -f "$file" ]] || continue
        grep -Eq '^[[:space:]]*wifis:' "$file" || continue
        if grep -Eq "$NETPLAN_OTHER_DEVICES" "$file" || grep -q 'eth0' "$file"; then
            netplan_mixed+=("$file")
        else
            netplan_wifi+=("$file")
        fi
    done
    for file in "${netplan_mixed[@]}"; do
        WIFI_LEFT=1
        warn "No se toca $file: además del Wi-Fi configura eth0 u otra interfaz. Para quitar solo el Wi-Fi: README, A2 («Copias de la clave del Wi-Fi»)"
    done
    if ((${#nm_wifi[@]} + ${#netplan_wifi[@]} == 0)); then
        return
    fi
    if ! eth0_is_primary; then
        WIFI_LEFT=1
        warn "eth0 no tiene IPv4 o la ruta por defecto no sale por eth0: no se borran los perfiles Wi-Fi (podrían ser tu conexión)"
        return
    fi
    for file in "${nm_wifi[@]}"; do
        rm -f -- "$file"
        changed "Borrado el perfil Wi-Fi de NetworkManager $file (traía la clave del Wi-Fi en texto plano)"
    done
    remove_netplan_wifi "${netplan_wifi[@]}"
}

# remove_netplan_wifi <yaml>...: borra cada YAML de solo Wi-Fi si netplan confirma
# que sin él la config que no es Wi-Fi (eth0, el renderer global) queda igual.
remove_netplan_wifi() {
    (($# > 0)) || return 0
    local file
    if ! netplan_available; then
        # Sin netplan nadie lee /etc/netplan; igual, nada con renderer (podría ser global).
        for file in "$@"; do
            if grep -Eq '^[[:space:]]*renderer:' "$file"; then
                WIFI_LEFT=1
                warn "No se toca $file: fija un renderer y sin netplan no se puede verificar que no afecta a eth0"
            else
                rm -f -- "$file"
                changed "Borrado $file (solo Wi-Fi, con la clave del Wi-Fi en texto plano)"
            fi
        done
        return
    fi
    temp_dir
    local root="$TEMP_DIR/netplan-root" before after
    copy_netplan_tree "$root"
    if ! before="$(netplan_rest "$root")"; then
        WIFI_LEFT=1
        warn "netplan no pudo leer la config de red: no se tocan $*"
        return
    fi
    for file in "$@"; do
        rm -f -- "$root$file"
        if after="$(netplan_rest "$root")" && [[ "$after" == "$before" ]]; then
            rm -f -- "$file"
            changed "Borrado $file (solo Wi-Fi, con la clave en texto plano; netplan verificó que eth0 y el resto no cambian)"
        else
            cp -a -- "$file" "$root$file"
            WIFI_LEFT=1
            warn "No se toca $file: sin él cambiaría la config de red que no es Wi-Fi (p. ej. el renderer global). Para quitar solo el Wi-Fi: README, A2 («Copias de la clave del Wi-Fi»)"
        fi
    done
}

# --- 9c. sudo: la autorización no se comparte entre sesiones --------------------------------------
configure_sudo_tty() {
    step "sudo por sesión (timestamp_type=tty)"
    local target=/etc/sudoers.d/020_vigilia-tty generated
    temp_dir
    generated="$TEMP_DIR/020_vigilia-tty"
    {
        printf '# %s (lo genera install.sh del relay)\n' "$target"
        printf '# Raspberry Pi OS trae 010_global-tty (timestamp_type=global): un sudo en una\n'
        printf '# sesión autoriza a todas. Así cada sesión (cada ssh) pide su clave.\n'
        printf 'Defaults timestamp_type=tty\n'
    } > "$generated"
    if [[ -f "$target" ]] && cmp -s "$generated" "$target"; then
        chmod 0440 "$target"
        chown root:root "$target"
        info "sudo ya pide clave por sesión ($target)"
        return
    fi
    if ! visudo -cf "$generated" > /dev/null 2>&1; then
        error "visudo -cf rechaza $generated: no se instala"
    fi
    install -m 0440 -o root -g root "$generated" "$target"
    if ! visudo -c > /dev/null 2>&1; then
        rm -f -- "$target"
        error "visudo -c falla con $target instalado: se quitó"
    fi
    changed "sudo: timestamp_type=tty en $target (cada sesión pide su clave)"
}

# --- 10. sudo con clave (último paso) ---------------------------------------------------------
remove_nopasswd_sudo() {
    step "sudo con clave"
    if [[ ! -f "$NOPASSWD_SUDOERS" ]]; then
        info "sudo ya pide clave ($NOPASSWD_SUDOERS no existe)"
        SUDO_SUMMARY="sudo pide la clave de $ADMIN_USER (ya estaba así)."
        return
    fi
    # Sin clave usable el admin perdería sudo: no se toca.
    local status
    status="$(passwd -S "$ADMIN_USER" 2> /dev/null | awk '{ print $2 }')"
    if [[ "$status" != "P" ]]; then
        warn "$ADMIN_USER no tiene una clave usable ($status): define una con 'sudo passwd $ADMIN_USER' y corre install.sh de nuevo"
        SUDO_SUMMARY="sudo SIGUE sin pedir clave: $ADMIN_USER no tiene clave (sudo passwd $ADMIN_USER y repite install.sh)."
        return
    fi
    if ! visudo -c > /dev/null 2>&1; then
        error "visudo -c falla ANTES de tocar sudoers: revisa /etc/sudoers.d a mano"
    fi
    temp_dir
    cp -p "$NOPASSWD_SUDOERS" "$TEMP_DIR/010_pi-nopasswd"
    rm -f -- "$NOPASSWD_SUDOERS"
    local restore_reason="" rules
    if ! visudo -c > /dev/null 2>&1; then
        restore_reason="visudo -c falla tras borrarlo"
    else
        # El admin debe conservar sudo por grupo (en Raspberry Pi OS, %sudo
        # ALL=(ALL:ALL) ALL). Se captura primero y se busca después (pipefail).
        rules="$(sudo -l -U "$ADMIN_USER" 2> /dev/null || true)"
        if ! grep -Eq '^[[:space:]]*\(ALL( ?: ?ALL)?\)[[:space:]]+ALL[[:space:]]*$' <<< "$rules"; then
            restore_reason="$ADMIN_USER se quedaría sin sudo (sudo -l no muestra una regla (ALL) ALL: ¿está en el grupo sudo?)"
        fi
    fi
    if [[ -n "$restore_reason" ]]; then
        install -m 0440 -o root -g root "$TEMP_DIR/010_pi-nopasswd" "$NOPASSWD_SUDOERS"
        error "$restore_reason: se restauró $NOPASSWD_SUDOERS (sudo sigue sin clave)"
    fi
    changed "Borrado $NOPASSWD_SUDOERS: sudo ahora pide la clave de $ADMIN_USER"
    SUDO_SUMMARY="sudo AHORA PIDE la clave de $ADMIN_USER (se borró $NOPASSWD_SUDOERS): si alguien entra con tu sesión, no es root sin la clave. Verifica: sudo -k; sudo true"
}

# --- 11. pasos siguientes ---------------------------------------------------------------------
print_next_steps() {
    step "Listo"
    if [[ $CHANGES -eq 0 ]]; then
        info "Sin cambios: todo ya estaba instalado y configurado"
    else
        info "$CHANGES cambio(s) aplicado(s)"
    fi
    if [[ -n "$SUDO_SUMMARY" ]]; then
        warn "$SUDO_SUMMARY"
    fi
    if [[ $NEEDS_REBOOT -eq 1 || -f /var/run/reboot-required ]]; then
        warn "Hace falta reiniciar para aplicar todo: sudo reboot"
    fi
    local tailscale_state
    tailscale_state="$(tailscale status --json --peers=false 2> /dev/null | grep -Eo '"BackendState"[^,]*' | head -n 1 || true)"
    cat << EOF

Pasos siguientes (ver $OPT_DIR/README.md):

  1. Unir la Pi al tailnet (interactivo; abre el link en el navegador):
       sudo tailscale up --ssh --hostname=vigilia-relay --advertise-tags=tag:vigilia-relay --accept-dns=false
     Sin navegador: una auth key de un solo uso, etiquetada tag:vigilia-relay, en un archivo 600:
       sudo install -m 600 /dev/null /root/tailscale-authkey && sudo nano /root/tailscale-authkey
       sudo tailscale up --ssh --hostname=vigilia-relay --advertise-tags=tag:vigilia-relay --accept-dns=false --auth-key=file:/root/tailscale-authkey
     Y después:  sudo tailscale set --auto-update
     (estado actual: ${tailscale_state:-desconocido})

  2. Lectores: la IP 100.x de tu PC en $ETC_DIR/relay.env (READER_ALLOWED_IPS).

  3. NVR (en la conserjería, por Tailscale SSH):
       sudo vigilia-relay set-nvr
       sudo vigilia-relay probe --channels 1-16
       sudo nano $ETC_DIR/cameras.conf      # ej.: porton nvr:3
       sudo vigilia-relay apply

  4. Clave del lector y URLs para ver desde casa:
       sudo vigilia-relay rotate-password
       sudo vigilia-relay urls
       sudo vigilia-relay status
EOF
}

main() {
    check_platform
    check_ssh_interface
    install_packages
    configure_ufw
    install_tailscale
    configure_system
    create_users
    install_kit
    install_mediamtx
    configure_etc
    install_units
    configure_sshd
    configure_cloud_init
    configure_sudo_tty
    remove_nopasswd_sudo
    print_next_steps
}

# Solo al ejecutarlo (los tests del kit lo cargan con `source` para probar funciones).
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
