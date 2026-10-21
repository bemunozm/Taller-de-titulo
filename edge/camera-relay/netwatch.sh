#!/usr/bin/env bash
# =============================================================================
# netwatch.sh — vigilante de red del relay de cámaras (Raspberry Pi 3B)
# =============================================================================
# Lo corre vigilia-relay-netwatch.timer cada 3 minutos (como root).
#
# "Red sana" = Tailscale `Running` con `Self.Online=true` (el control plane
# lo ve) o, si no, que respondan el gateway por defecto o
# NETWATCH_FALLBACK_TARGET. Un router que filtra ICMP no cuenta como caída
# mientras Tailscale esté online.
#
# - Si Tailscale no está "Running" (salvo que espere un login, que reiniciar
#   no arregla) o si la red no está sana NETWATCH_GATEWAY_FAILS veces
#   seguidas: reinicia tailscaled.
# - Si pasan más de NETWATCH_OFFLINE_REBOOT_MIN minutos sin red: reinicia la
#   Pi, como mucho NETWATCH_MAX_REBOOTS_PER_DAY veces por día (el contador
#   vive en el archivo de estado y sobrevive al reinicio).
#
# Estado: $STATE_DIRECTORY/netwatch.state (systemd lo crea en
# /var/lib/vigilia-relay). Es `clave=valor`: se PARSEA con validación, nunca
# se ejecuta con `source`.
# NETWATCH_NOW (epoch) solo existe para los tests (tests/test_netwatch.py).
# =============================================================================
set -euo pipefail

STATE_DIR="${STATE_DIRECTORY:-/var/lib/vigilia-relay}"
STATE_FILE="$STATE_DIR/netwatch.state"
GATEWAY_FAILS="${NETWATCH_GATEWAY_FAILS:-3}"
OFFLINE_REBOOT_MIN="${NETWATCH_OFFLINE_REBOOT_MIN:-30}"
MAX_REBOOTS_PER_DAY="${NETWATCH_MAX_REBOOTS_PER_DAY:-3}"
FALLBACK_TARGET="${NETWATCH_FALLBACK_TARGET:-1.1.1.1}"
# Intérprete para leer el JSON de `tailscale status` (los tests lo cambian).
PYTHON="${NETWATCH_PYTHON:-python3}"
NOW="${NETWATCH_NOW:-$(date +%s)}"

log() {
    printf 'netwatch: %s\n' "$*"
}

is_uint() {
    [[ "$1" =~ ^[0-9]+$ ]]
}

for setting in "$GATEWAY_FAILS" "$OFFLINE_REBOOT_MIN" "$MAX_REBOOTS_PER_DAY" "$NOW"; do
    if ! is_uint "$setting"; then
        log "configuración inválida (se esperaba un entero): $setting"
        exit 2
    fi
done

TODAY="$(date -d "@$NOW" +%F)"
BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2> /dev/null || echo unknown)"

# --- estado ----------------------------------------------------------------------
fail_count=0
offline_since=0
reboot_day=""
reboot_count=0
state_boot_id=""

load_state() {
    if [[ ! -f "$STATE_FILE" ]]; then
        return 0
    fi
    local key value
    while IFS='=' read -r key value || [[ -n "$key" ]]; do
        value="${value%$'\r'}" # tolera un archivo editado con CRLF
        case "$key" in
            fail_count)
                if is_uint "$value"; then fail_count="$value"; fi
                ;;
            offline_since)
                if is_uint "$value"; then offline_since="$value"; fi
                ;;
            reboot_count)
                if is_uint "$value"; then reboot_count="$value"; fi
                ;;
            reboot_day)
                if [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then reboot_day="$value"; fi
                ;;
            boot_id)
                if [[ "$value" =~ ^[A-Za-z0-9-]{1,64}$ ]]; then state_boot_id="$value"; fi
                ;;
            *) ;;
        esac
    done < "$STATE_FILE"
    return 0
}

# Devuelve 1 si no pudo escribir (SD en solo lectura o llena): quien llama decide.
save_state() {
    local temp
    temp="$(mktemp "$STATE_DIR/.netwatch.XXXXXX" 2> /dev/null)" || return 1
    if ! printf 'fail_count=%s\noffline_since=%s\nreboot_day=%s\nreboot_count=%s\nboot_id=%s\n' \
        "$fail_count" "$offline_since" "$reboot_day" "$reboot_count" "$BOOT_ID" > "$temp" 2> /dev/null ||
        ! chmod 600 "$temp" 2> /dev/null ||
        ! mv -f "$temp" "$STATE_FILE" 2> /dev/null; then
        rm -f -- "$temp" 2> /dev/null || true
        return 1
    fi
    return 0
}

# --- chequeos ----------------------------------------------------------------------
TS_STATE="unknown"
TS_ONLINE="false"

# BackendState y Self.Online de `tailscale status --json`, leídos con json (no
# con grep: `"Online": true` también aparece en ExitNodeStatus). Si algo
# falla (sin tailscale, JSON roto, sin python3): "unknown" y "false".
read_tailscale() {
    local json parsed
    json="$(timeout 15 tailscale status --json --peers=false 2> /dev/null || true)"
    parsed="$("$PYTHON" -I -c '
import json, re, sys
try:
    data = json.loads(sys.stdin.read())
except ValueError:
    data = None
if not isinstance(data, dict):
    data = {}
state = data.get("BackendState")
me = data.get("Self")
online = isinstance(me, dict) and me.get("Online") is True
ok = isinstance(state, str) and re.fullmatch(r"[A-Za-z]{1,32}", state)
print((state if ok else "unknown") + " " + ("true" if online else "false"))
' <<< "$json" 2> /dev/null || true)"
    if [[ "$parsed" =~ ^([A-Za-z]{1,32})\ (true|false)$ ]]; then
        TS_STATE="${BASH_REMATCH[1]}"
        TS_ONLINE="${BASH_REMATCH[2]}"
    fi
}

default_gateway() {
    ip -4 route show default 2> /dev/null | awk '$1 == "default" { print $3; exit }'
}

ping_ok() {
    ping -n -q -c 2 -W 2 "$1" > /dev/null 2>&1
}

# Sin ruta por defecto (cable desconectado) no hay red: ni gateway ni respaldo.
pings_ok() {
    local gateway
    gateway="$(default_gateway || true)"
    if [[ -n "$gateway" ]] && ping_ok "$gateway"; then
        return 0
    fi
    if [[ -n "$gateway" && -n "$FALLBACK_TARGET" ]] && ping_ok "$FALLBACK_TARGET"; then
        return 0
    fi
    return 1
}

# --- principal ------------------------------------------------------------------------
main() {
    mkdir -p "$STATE_DIR" 2> /dev/null || true
    load_state

    # Arranque nuevo: los fallos y el "sin red desde" se cuentan de cero. El
    # contador diario de reinicios se conserva (si no, un reinicio que no
    # arregla nada se repetiría cada 30 min).
    if [[ "$state_boot_id" != "$BOOT_ID" ]]; then
        fail_count=0
        offline_since=0
    fi
    if [[ "$reboot_day" != "$TODAY" ]]; then
        reboot_day="$TODAY"
        reboot_count=0
    fi

    read_tailscale
    local state="$TS_STATE" ts_online=0
    if [[ "$state" == "Running" && "$TS_ONLINE" == "true" ]]; then
        ts_online=1
    fi

    if [[ "$ts_online" -eq 1 ]] || pings_ok; then
        if [[ "$offline_since" -gt 0 ]]; then
            log "la red volvió"
        fi
        fail_count=0
        offline_since=0
    else
        fail_count=$((fail_count + 1))
        if [[ "$offline_since" -eq 0 ]]; then
            offline_since="$NOW"
        fi
        log "sin red: Tailscale offline y sin respuesta del gateway ni de ${FALLBACK_TARGET:-(sin respaldo)} (fallo $fail_count seguido)"
    fi

    local restart_reason=""
    case "$state" in
        Running) ;;
        NeedsLogin | NeedsMachineAuth)
            # Reiniciar no lo arregla y cortaría un `tailscale up` en curso.
            log "Tailscale espera login ($state): corre tailscale up (ver README)"
            ;;
        *) restart_reason="Tailscale en estado $state" ;;
    esac
    if [[ -z "$restart_reason" && "$fail_count" -ge "$GATEWAY_FAILS" ]]; then
        restart_reason="$fail_count chequeos seguidos sin red"
    fi
    if [[ -n "$restart_reason" ]]; then
        log "reiniciando tailscaled ($restart_reason)"
        if ! systemctl restart tailscaled.service; then
            log "no se pudo reiniciar tailscaled"
        fi
    fi

    if [[ "$offline_since" -gt 0 ]]; then
        local offline_min=$(((NOW - offline_since) / 60))
        if [[ "$offline_min" -gt "$OFFLINE_REBOOT_MIN" ]]; then
            if [[ "$reboot_count" -lt "$MAX_REBOOTS_PER_DAY" ]]; then
                reboot_count=$((reboot_count + 1))
                # Trade-off: si la SD no se puede escribir (solo lectura o
                # llena), el contador no persiste y el tope diario deja de
                # regir; se reinicia igual, porque una SD rota sin reinicio
                # deja el relay muerto de todas formas.
                local tally="$reboot_count de $MAX_REBOOTS_PER_DAY hoy"
                if ! save_state; then
                    log "no se pudo guardar el estado en $STATE_DIR (¿SD en solo lectura o llena?): se reinicia igual, sin tope diario"
                    tally="sin tope diario: el contador no se pudo guardar"
                fi
                log "sin red hace $offline_min min: reiniciando la Pi ($tally)"
                systemctl reboot
                return 0
            fi
            log "sin red hace $offline_min min, pero ya se usaron los $MAX_REBOOTS_PER_DAY reinicios de hoy"
        fi
    fi
    if ! save_state; then
        log "no se pudo guardar el estado en $STATE_DIR (¿SD en solo lectura o llena?)"
        return 1
    fi
}

main "$@"
