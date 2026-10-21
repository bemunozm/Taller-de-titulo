# Relay de cámaras (Raspberry Pi 3B)

Runbook del kit `edge/camera-relay/`. Una Raspberry Pi 3 Model B (1 GB) queda en
la conserjería como **relay de video**:

```
cámaras ──PoE──> NVR Hikvision ──LAN──> Pi (MediaMTX v1.15.2, on-demand) ──Tailscale──> PC de casa (VLC/ffplay)
DS-7616NI-K2/16P     RTSP :554                RTSP :8554 (solo tailnet)                  (luego: VPS central)
```

- **On-demand**: la Pi tira del NVR solo mientras alguien mira, y lo suelta 30 s
  después de que se va el último lector.
- **Sin puertos abiertos ni VPN** en el condominio: sale por Tailscale (WireGuard).
- **No hace**: inferencia, transcodificación ni grabación. No guarda video.

## Contenido del kit

| Archivo | Rol |
|---|---|
| `install.sh` | Instalador idempotente (`sudo bash install.sh`). |
| `vigilia_relay.py` | CLI `vigilia-relay` (Python 3 stdlib). Se instala en `/usr/local/bin/vigilia-relay`. |
| `netwatch.sh` | Vigilante de red (timer cada 3 min). |
| `relay.env.example`, `cameras.conf.example` | Plantillas de `/etc/vigilia-relay/`. |
| `systemd/` | `vigilia-relay.service` (MediaMTX endurecido), `vigilia-relay-netwatch.{service,timer}` y `vigilia-relay-follow-nvr.{service,timer}` (sigue la IP del NVR por su MAC). |
| `system/` | Drop-ins: watchdog, journald, unattended-upgrades (`52vigilia-relay`) y rpi-swap. |
| `tailscale-acl.example.hujson` | Política del tailnet (tags, SSH `check`, tests). |
| `tests/`, `e2e/` | Pytest (incluye el contract test con MediaMTX real) y E2E en Windows con NVR falso. No van a la Pi. |

## Prerrequisitos

**Autorización y NVR**

- [ ] Autorización **escrita** de la administración para instalar el equipo y
      sacar video del condominio (Ley 21.719).
- [ ] Un **usuario del NVR solo con "Vista en vivo remota"** en los 11 canales:
      sin reproducción, PTZ ni configuración. Nunca la cuenta admin del técnico.
      Clave larga (16+) con letras, dígitos y `-_.`. El kit soporta cualquier
      carácter, pero `:` no se pudo probar de punta a punta (ver
      [Troubleshooting](#troubleshooting)).
- [ ] **IP fija o reserva DHCP** para el NVR, si la administración puede
      dársela: **sigue siendo lo ideal**. Si el NVR queda por DHCP sin
      reserva (el caso del condominio), el kit lo sigue por su MAC
      (`NVR_MAC`, ver [IP del NVR por DHCP](#ip-del-nvr-por-dhcp-seguimiento-automático)).
      El kit solo acepta **IPs**, nunca nombres: `NVR_HOST` y el host de cada
      `url:` son IPv4 (o IPv6 sin IPv4 incrustada). Con `IPAddressDeny=any`
      MediaMTX no puede hacer DNS, así que una cámara por nombre nunca
      andaría.
- [ ] En el NVR, para cada cámara:
      - substream en **H.264** (no H.265);
      - **I-frame cada 1–2 s** (intervalo de I-frame = 1 a 2 veces los fps);
      - **sin H.264+ ni H.265+**.

**Material**

- [ ] Raspberry Pi 3B, **fuente oficial de 2,5 A** y carcasa.
- [ ] **Dos microSD "high endurance"** de 16 GB o más: una en la Pi y otra como
      clon de respaldo, que **se guarda en tu casa**, no en la conserjería.
- [ ] Cable Ethernet hasta el router o switch del NVR.
- [ ] Si hay UPS, conectar la Pi a la misma del NVR.

## Fase A — en casa (1–2 h)

### A1. Grabar la SD

Con **Raspberry Pi Imager**:

1. Dispositivo: Raspberry Pi 3. SO: **Raspberry Pi OS Lite (64-bit)**.
2. "Editar ajustes":
   - hostname: `vigilia-relay`;
   - usuario y clave propios (ej. `benjamin`). **Guarda la clave en tu gestor
     de contraseñas**: después de `install.sh`, `sudo` la pide;
   - **NO configurar Wi-Fi**: la clave del Wi-Fi de tu casa quedaría en la SD
     que vive en la conserjería. `install.sh` además apaga la radio
     (`dtoverlay=disable-wifi`);
   - zona horaria `America/Santiago`, teclado `latam`;
   - Servicios: **SSH solo con clave pública** (pega tu `~/.ssh/id_ed25519.pub`).
3. Grabar.

### A2. Primer arranque y kit

Conecta la Pi por **Ethernet** al router de tu casa y enciéndela.

```bash
# En el PC (Git Bash), desde la raíz del repo:
tar -czf vigilia-relay-kit.tar.gz -C edge --exclude=tests --exclude=e2e --exclude=__pycache__ \
    --exclude=relay.env --exclude=cameras.conf camera-relay
scp vigilia-relay-kit.tar.gz benjamin@vigilia-relay.local:~/

# En la Pi:
ssh benjamin@vigilia-relay.local
sudo apt update && sudo apt full-upgrade -y && sudo reboot
# (vuelve a entrar)
mkdir -p ~/vigilia-relay-kit && tar -xzf ~/vigilia-relay-kit.tar.gz --no-same-owner -C ~/vigilia-relay-kit
sudo bash ~/vigilia-relay-kit/camera-relay/install.sh
rm ~/vigilia-relay-kit.tar.gz
```

- Si `vigilia-relay.local` no resuelve, busca la IP de la Pi en el router.
  `install.sh` apaga avahi: desde ahí, entra por IP o por Tailscale.
- Si te avisa "Hace falta reiniciar", hazlo con `sudo reboot`. Esto aplica
  Bluetooth y Wi-Fi apagados y, en Trixie, el swap solo en zram.

`install.sh` toma tu usuario de `SUDO_USER` y deja:
- `sshd` (SSH por la LAN) solo con clave pública, sin root y con
  `AllowUsers <tu usuario>`;
- **sudo con clave**: borra `/etc/sudoers.d/010_pi-nopasswd`, que trae
  Raspberry Pi OS;
- **sudo por sesión**: `/etc/sudoers.d/020_vigilia-tty` con
  `Defaults timestamp_type=tty`. Raspberry Pi OS trae `010_global-tty`
  (`timestamp_type=global`), con el que un `sudo` en una sesión autoriza a
  todas las demás;
- **cloud-init apagado (Trixie)**: si `cloud-init status` dice `done`, crea
  `/etc/cloud/cloud-init.disabled` y borra `/boot/firmware/network-config`
  (trae la clave del Wi-Fi en texto plano, si la pusiste en Imager) y
  `/boot/firmware/user-data` (trae el hash de tu clave). Si cloud-init no
  terminó, no los toca: corre `install.sh` de nuevo más tarde;
- **copias de la clave del Wi-Fi en la SD** (en el mismo paso, con cloud-init
  terminado): vacía `/var/lib/cloud` (datos de la instancia, con copias de
  `network-config` y `user-data`), borra los logs de cloud-init y los perfiles
  **Wi-Fi** de NetworkManager (`/etc/NetworkManager/system-connections`, tipo
  `wifi`) y de netplan (`/etc/netplan`, YAML con solo `wifis:`). **Nunca toca
  eth0**: ver [Copias de la clave del Wi-Fi](#copias-de-la-clave-del-wi-fi).

Verifícalo **antes** de llevar la Pi a la conserjería:

```bash
sudo -k; sudo true                 # debe pedirte la clave (y una sesión ssh nueva, de nuevo)
ls /boot/firmware/network-config /boot/firmware/user-data 2> /dev/null   # no debe listar nada (Trixie)
# Con el nombre de tu Wi-Fi (SSID) en vez de <SSID>; no debe listar nada:
sudo grep -rls '<SSID>' /etc/netplan /etc/NetworkManager /var/lib/cloud /boot/firmware /var/log/cloud-init*.log
sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|allowusers) '
systemctl status 'serial-getty@*' --no-pager   # consola por los pines GPIO: no debe estar activa
```

Si aparece un `serial-getty@ttyAMA0` o `@serial0` activo (consola serie
habilitada), apágalo:

```bash
sudo raspi-config nonint do_serial_cons 1
sudo systemctl disable --now serial-getty@ttyAMA0.service
```

#### Copias de la clave del Wi-Fi

`install.sh` borra un perfil Wi-Fi solo si se cumplen las tres condiciones:
- eth0 tiene IPv4 y la ruta por defecto sale por eth0 (si no, el Wi-Fi podría
  ser tu conexión: no borra nada y avisa);
- en NetworkManager, el perfil es de tipo `wifi` y no nombra a eth0;
- en netplan, el YAML solo tiene `wifis:` y `netplan get` confirma que, sin
  él, el resto de la config (eth0, el `renderer` global) queda igual.

Nunca toca `/run` (vive en RAM, no en la SD). Ahí están, por ejemplo, el
perfil automático "Wired connection 1" de NetworkManager y los que netplan
genera en cada arranque.

Si avisa `No se toca /etc/netplan/<archivo>.yaml` (porque además configura
eth0, o porque sin él cambiaría el `renderer` global), quita **solo** la
sección del Wi-Fi a mano. En `--origin-hint` va el nombre del archivo sin
`.yaml`. Probado con el netplan de Trixie (1.1.2). No hace falta
`netplan apply`: rige desde el próximo arranque y el Wi-Fi ya está apagado.

```bash
sudo netplan get ethernets                                   # anota cómo está eth0
sudo netplan set --origin-hint 50-cloud-init "wifis=null"   # el nombre del archivo, sin .yaml
sudo netplan get ethernets                                   # debe salir igual que antes
sudo netplan get wifis                                       # null
sudo grep -rls '<SSID>' /etc/netplan                         # no debe listar nada
```

Tailscale SSH **no pasa por sshd**: `AllowUsers` no lo afecta; lo controla la
regla `ssh` de la ACL.

Antes de borrar `010_pi-nopasswd`, `install.sh` verifica con `sudo -l` que tu
usuario conserva sudo por grupo (`(ALL : ALL) ALL`). Si no, lo restaura y
corta con error. También deja a `vigilia-relay` y `vigilia-probe` en
`/etc/cron.deny`.

**Salida de emergencia si en terreno olvidas la clave de sudo**: la Pi no
tiene clave de root y sudo pide la tuya, pero Tailscale SSH puede entrar
como root si la ACL lo permite.
1. En la consola de Tailscale, cambia temporalmente la regla `ssh` a
   `"users": ["root"]` (guarda: los `sshTests` que niegan root fallarán;
   quítalos mientras dure).
2. Entra como root: `ssh root@vigilia-relay` (pide el check del navegador).
3. Corre `passwd <tu usuario>` y sal.
4. **Revierte la ACL** a `"users": ["benjamin"]` con sus `sshTests`.

### A3. ACL de Tailscale (antes de `tailscale up`)

1. Cuenta de Tailscale con **2FA** (la del proveedor con el que entras:
   Google, GitHub o Microsoft).
2. En <https://login.tailscale.com/admin/acls>, pega
   `tailscale-acl.example.hujson`. Antes, reemplaza tres valores:
   - tu login;
   - la IP de Tailscale de tu PC (`tailscale ip -4`);
   - tu usuario de Linux en la Pi (`"users": ["benjamin"]`).

   **Reemplaza** la política por defecto, que abre todo entre todos los nodos;
   si ya tenías reglas, fusiónalas.
3. Al guardar, la consola corre los `tests`: tienen que pasar.

La ACL es el control principal: UFW no filtra el tailnet, porque tailscaled
pone su cadena `ts-input` antes que la de UFW. Con esta ACL:
- el relay no puede iniciar conexiones a nada;
- el `8554` lo ve solo tu PC (más adelante también `tag:vigilia-central`), no
  el celular;
- SSH es solo tu usuario, en modo `check`.

### A4. Unir la Pi al tailnet

```bash
sudo tailscale up --ssh --hostname=vigilia-relay --advertise-tags=tag:vigilia-relay --accept-dns=false
# abre el link que imprime, en el navegador
sudo tailscale set --auto-update
```

Alternativa sin navegador: una auth key de **un solo uso**, etiquetada
`tag:vigilia-relay`, en un archivo 600.

```bash
sudo install -m 600 /dev/null /root/tailscale-authkey
sudo nano /root/tailscale-authkey      # pega la key
sudo tailscale up --ssh --hostname=vigilia-relay --advertise-tags=tag:vigilia-relay --accept-dns=false --auth-key=file:/root/tailscale-authkey
sudo shred -u /root/tailscale-authkey
```

En la consola, en Machines → `vigilia-relay`, verifica:
- el tag `tag:vigilia-relay`;
- **"Key expiry: disabled"**: un nodo con tag no vence. Si dice otra cosa,
  deshabilítalo ahí.

Desde ahora entras por Tailscale SSH, que te pide re-autenticarte en el
navegador cada 12 h:

```bash
ssh benjamin@vigilia-relay
```

### A5. Lectores permitidos (antes de probar)

`READER_ALLOWED_IPS` es **fail-closed**: sin definirla, el lector solo entra
desde la propia Pi, y `apply` y `status` lo avisan con
`AVISO (lectores solo por loopback): …` (salen con 0: la config es segura,
pero desde casa no se ve nada).

```bash
sudo nano /etc/vigilia-relay/relay.env
# READER_ALLOWED_IPS='100.x.y.z'     <- la IP de Tailscale de tu PC (tailscale ip -4)
sudo vigilia-relay rotate-password  # anota la clave del lector: se muestra UNA vez
```

En consumidores Linux usa la **IP 100.x** y no el nombre `vigilia-relay`:
glibc puede preferir la IPv6 de MagicDNS (`fd7a:...`), que no está en la lista.

### A6. Prueba completa con el NVR falso (por la LAN de tu casa)

El NVR falso del E2E corre en tu PC. La Pi tira de él igual que lo hará del
Hikvision.

```powershell
# En el PC (PowerShell), desde la raíz del repo. Windows pedirá permitir mediamtx.exe en la red privada.
mediamtx\mediamtx.exe edge\camera-relay\e2e\fake-nvr.yml
# en otra ventana:
ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=15 -c:v libx264 -preset ultrafast -tune zerolatency -g 15 -pix_fmt yuv420p -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:18554/Streaming/Channels/102
```

```bash
# En la Pi (ssh benjamin@vigilia-relay). La clave E2e@#$G1-fake es FALSA (la de fake-nvr.yml).
sudo vigilia-relay set-nvr        # IP LAN del PC, puerto 18554, usuario nvr-viewer, clave E2e@#$G1-fake
sudo vigilia-relay probe --channels 1
echo 'prueba nvr:1' | sudo tee /etc/vigilia-relay/cameras.conf > /dev/null
sudo vigilia-relay apply          # escribe la red permitida (IP del PC) y reinicia el servicio una vez
sudo vigilia-relay urls
```

```bash
# En el PC:
ffplay -rtsp_transport tcp "rtsp://relay-reader:<CLAVE>@<IP-100.x-de-la-Pi>:8554/prueba"
```

Al terminar, borra `cameras.conf` (`sudo rm /etc/vigilia-relay/cameras.conf`).
`set-nvr` en la conserjería reemplaza el NVR falso.

### A7. Pruebas de aceptación

| Prueba | Comando | Esperado |
|---|---|---|
| Idempotencia | `sudo bash ~/vigilia-relay-kit/camera-relay/install.sh` (2.ª vez) | "Sin cambios" |
| sudo con clave | `sudo -k; sudo true` | Pide la clave |
| Puertos | `sudo ss -tulpn` | Solo `22` (sshd), `:8554` y `127.0.0.1:9997` (mediamtx) y tailscaled (`41641/udp` y su IP 100.x). DHCP (`68/udp`) es normal. |
| Sandbox | `systemd-analyze security vigilia-relay` | < 2 (medido: 1.0) |
| Red del servicio | `systemctl show -p IPAddressAllow -p IPAddressDeny vigilia-relay` | localhost, el NVR, Tailscale / `any` |
| BPF aplicado | `sudo systemd-run -p IPAddressDeny=any -p IPAddressAllow=localhost --wait --pipe curl -m3 https://1.1.1.1` | **Falla** (`curl: (7)` o timeout). Si conecta, el kernel no aplica `IPAddressDeny`. |
| Watchdog | `sudo wdctl` y `systemctl show -p RuntimeWatchdogUSec` | Timeout 15 s / `15s` |
| UFW | `sudo ufw status verbose` | deny incoming; tailscale0, 41641/udp y 22/tcp en eth0 |
| Orden | `sudo iptables -S INPUT` | `-j ts-input` antes que las cadenas `ufw-*` |
| Relay | `sudo vigilia-relay status` | servicios `active`, paths, RAM, `get_throttled` 0x0 |
| Desde el PC | ffplay del paso A6 | Se ve el testsrc |
| Desde el celular | VLC a `rtsp://...:8554/prueba` | **No conecta** (ACL) |
| Desde la Pi al PC | En el PC: `python -m http.server 8000 --bind <IP-100.x-del-PC>`. En la Pi: `timeout 5 bash -c '</dev/tcp/<IP-100.x-del-PC>/8000' ; echo $?` | ≠ 0 (el relay no inicia conexiones) |
| Directo o DERP | `tailscale ping vigilia-relay` (en el PC) | Ideal "via <IP>:41641" (directo). "via DERP" funciona, con más latencia. |
| Ancho de banda | `sudo systemctl stop vigilia-relay && iperf3 -s -1 -p 8554` (Pi) y `iperf3 -c <IP-100.x-de-la-Pi> -p 8554 -R` (PC); luego `sudo systemctl start vigilia-relay` | Varios Mbit/s (un substream usa ~0,5–1) |
| `ssh -L` | `ssh -L 8443:<IP-router-casa>:443 benjamin@vigilia-relay` (con shell abierta, no `-N`) y abrir `https://localhost:8443` | Se ve el router |
| Tailscale caído | Por **SSH de la LAN** (`ssh benjamin@<IP-LAN-de-la-Pi>`, porque por Tailscale te cortarías): `sudo systemctl stop tailscaled` y esperar ≤ 6 min | Vuelve solo (`journalctl -u vigilia-relay-netwatch`) |
| Sin Ethernet 5 min | Desconectar 5 min y reconectar | Vuelve solo, sin reiniciar |
| Reinicio por falta de red (opcional) | Detalle debajo de la tabla | "reiniciando la Pi (1 de 3 hoy)" |
| Reinicio | `sudo reboot` | El relay vuelve solo |

Detalle de la prueba opcional "Reinicio por falta de red":
1. `sudo systemctl edit vigilia-relay-netwatch.service` y agrega `[Service]` /
   `Environment=NETWATCH_OFFLINE_REBOOT_MIN=4`.
2. Desconecta el Ethernet ~10 min y vuelve a conectarlo.
3. Revisa `journalctl -b -1 -u vigilia-relay-netwatch`.
4. Deshaz el cambio: `sudo systemctl revert vigilia-relay-netwatch.service`.

### A8. SD de respaldo

Clónala **ahora**, antes de la Fase C: así el clon no tiene la clave del NVR.

1. `sudo poweroff` (en casa sí; en la conserjería, nunca).
2. En el PC, con Win32 Disk Imager: "Read" de la SD a un `.img` y "Write" del
   `.img` a la segunda SD. Borra el `.img` después: tiene la identidad
   Tailscale del nodo.
3. La SD de respaldo **se queda en tu casa**. Es el mismo nodo de Tailscale:
   nunca enciendas las dos a la vez. Si se pierde, trátalo como un
   [robo](#si-roban-la-pi-o-se-pierde-la-sd-de-respaldo).

## Fase B — en la conserjería (15 min)

1. Ethernet de la Pi al switch o router donde está el NVR (misma LAN).
2. Fuente oficial (y UPS, si hay).
3. Desde el PC: `tailscale status | grep vigilia-relay` debe decir "online" en
   ~2 min. Si a los 10 min no aparece, revisa los LED de Ethernet y
   desenchufa y vuelve a enchufar la fuente.

Nada más: el resto es remoto.

## Fase C — remota por Tailscale SSH (30–60 min)

```bash
ssh benjamin@vigilia-relay
sudo vigilia-relay set-nvr                   # IP del NVR, 554, usuario de vista en vivo, clave (getpass)
sudo vigilia-relay probe --channels 1-16     # de a uno: codec, resolución, fps
```

`probe` **se detiene en el primer 401**: el Hikvision bloquea la IP tras unos
pocos logins fallidos (por defecto, ~5 intentos durante ~30 min). Si sale
`CLAVE`, no reintentes en loop: revisa usuario y clave con `set-nvr`. ffprobe
corre como el usuario sin privilegios `vigilia-probe`, detrás de
`setpriv --no-new-privs`, y solo puede abrir protocolos RTSP.

`apply`, `rotate-password`, `set-nvr` y `follow-nvr` (el timer) no corren a
la vez (lock en `/etc/vigilia-relay/.vigilia-relay.lock`): si hay otro en
curso, salen con 8 y un AVISO, sin hacer nada.

**Fija `NVR_MAC` a mano** (recomendado): es el ancla de confianza de
`follow-nvr`. Copia la MAC que muestra la pantalla del NVR (Configuración →
Red → TCP/IP) en `relay.env` y comprueba que coincide con la que ve la Pi:

```bash
sudo nano /etc/vigilia-relay/relay.env          # NVR_MAC='02:1a:2b:3c:4d:5e'
ip neigh show 192.168.1.2                       # la IP del NVR: debe mostrar la misma MAC
```

Si no la fijas, `set-nvr` y `apply` la aprenden de `ip neigh` tras un probe
OK con credenciales. `follow-nvr` nunca la aprende solo.

Para saber qué canal es cada cámara:

1. `sudo vigilia-relay apply` sin `cameras.conf` genera `cam01..cam11`.
2. Mira cada una desde casa.
3. Ponles nombre:

```bash
sudo nano /etc/vigilia-relay/cameras.conf
#   porton nvr:3
#   puerta nvr:5
sudo vigilia-relay apply        # valida, prueba el origen, guarda .prev, escribe y verifica (o revierte)
sudo vigilia-relay urls
```

El primer `apply` con el NVR reinicia el servicio una vez: escribe la red
permitida (`IPAddressAllow`) con la IP del NVR. Después recarga en caliente.

Desde casa:

```bash
ffplay -rtsp_transport tcp "rtsp://relay-reader:<CLAVE>@<IP-100.x-de-la-Pi>:8554/porton"
ffplay -rtsp_transport tcp "rtsp://relay-reader:<CLAVE>@<IP-100.x-de-la-Pi>:8554/porton-hd"
vlc --rtsp-tcp "rtsp://relay-reader:<CLAVE>@<IP-100.x-de-la-Pi>:8554/porton"
```

`porton` es el substream (liviano) y `porton-hd` el stream principal. En
Windows también sirve `vigilia-relay` (MagicDNS); en Linux, usa la IP.

Para cerrar:
- `sudo vigilia-relay status`: RAM de la Pi bajo ~300 MB con 2–3 lectores;
- `sudo reboot`: el relay vuelve solo.

## Operación

### Actualizar el kit (remoto)

```bash
# En el PC:
tar -czf vigilia-relay-kit.tar.gz -C edge --exclude=tests --exclude=e2e --exclude=__pycache__ \
    --exclude=relay.env --exclude=cameras.conf camera-relay
scp vigilia-relay-kit.tar.gz benjamin@vigilia-relay:~/
ssh benjamin@vigilia-relay

# En la Pi. systemd-run desacopla la instalación de la sesión SSH: si
# tailscaled se reinicia a mitad, sigue. Pide tu clave (sudo).
rm -rf ~/vigilia-relay-kit && mkdir -p ~/vigilia-relay-kit
tar -xzf ~/vigilia-relay-kit.tar.gz --no-same-owner -C ~/vigilia-relay-kit && rm ~/vigilia-relay-kit.tar.gz
sudo systemd-run --unit=vigilia-relay-update --collect --setenv=VIGILIA_RELAY_ADMIN_USER="$USER" \
    bash "$HOME/vigilia-relay-kit/camera-relay/install.sh"
journalctl -u vigilia-relay-update -f
```

- En Git Bash, si el tar recibe rutas absolutas, usa `tar --force-local` y
  rutas `/c/...` (sin `--force-local`, `C:` se toma como un host remoto).
- La versión anterior de MediaMTX queda en `/opt/vigilia-relay/bin/mediamtx.prev`
  y la config anterior, en `/etc/vigilia-relay/mediamtx.yml.prev`.
- Si el kit cambió el formato de la config, corre `sudo vigilia-relay apply`.
- **Desde la 0.3.0**, después de actualizar:
  - `sudo vigilia-relay apply` aprende `NVR_MAC` si falta (o fíjala a mano, ver
    [Fase C](#fase-c--remota-por-tailscale-ssh-3060-min)). Desde la 0.3.1 el
    timer de `follow-nvr` ya **no** la aprende;
  - `sudo grep NVR_MAC /etc/vigilia-relay/relay.env` debe mostrarla
    (`relay.env` es 600 root);
  - `systemctl list-timers | grep follow-nvr` muestra el timer nuevo;
  - `sudo vigilia-relay follow-nvr` debe responder "OK, sin cambios".
- Al pasar de la 0.3.0 a la 0.3.1, el primer `apply` reinicia MediaMTX una vez
  (cambió la cabecera del drop-in de la red permitida, que ya no lleva la
  versión del kit). Después, las actualizaciones no lo reinician.
- Sin Internet en la Pi: deja `mediamtx_v1.15.2_linux_arm64.tar.gz` junto a
  `install.sh`. Igual se verifican el SHA256 del tar y el del binario.

### Actualizar el sistema (mensual)

unattended-upgrades instala solo seguridad (Debian y Raspberry Pi) y **no
reinicia**. Una vez al mes, por Tailscale SSH:

```bash
sudo apt update && sudo apt full-upgrade -y
[ -f /var/run/reboot-required ] && sudo reboot
```

### Rotar claves

| Clave | Cómo |
|---|---|
| Lector (`relay-reader`) | `sudo vigilia-relay rotate-password`. Aplica y, solo si MediaMTX la cargó, la guarda y la muestra una vez. Con `--out archivo` la deja en un archivo 600. Actualiza VLC/ffplay y los consumidores. |
| Usuario del NVR | Cambia la clave en el NVR (por `ssh -L`, abajo) y **enseguida**, antes de abrir VLC, `sudo vigilia-relay set-nvr` y `sudo vigilia-relay apply`. Con la clave vieja, cada lector dispara un intento on-demand y el NVR bloquea la IP de la Pi. |
| API local (`vigilia-admin`) | `sudo rm /etc/vigilia-relay/api.secret && sudo vigilia-relay init && sudo vigilia-relay apply --skip-probe` |
| Nodo de Tailscale | En la consola: Machines → `vigilia-relay` → "Reauthenticate" o "Remove", y un `tailscale up` nuevo. |

### Reiniciar remoto

`sudo reboot`. **Nunca `poweroff`**: en la conserjería nadie la vuelve a
encender.

### Administrar el NVR

Con Tailscale SSH y una shell abierta (`-N` no funciona con Tailscale SSH),
mejor por HTTPS (443):

```bash
ssh -L 8443:<IP-del-NVR>:443 benjamin@vigilia-relay
# y en el navegador del PC: https://localhost:8443  (el NVR usa un certificado propio)
```

No se usa `--advertise-routes`: la LAN del condominio nunca queda expuesta al
tailnet.

### IP del NVR por DHCP: seguimiento automático

Si el NVR recibe su IP por DHCP sin reserva, el router puede darle otra y el
relay dejaría de ver las cámaras. `vigilia-relay-follow-nvr.timer` corre
`vigilia-relay follow-nvr` cada 5 minutos y lo sigue por su **MAC**
(`NVR_MAC` en `relay.env`), que no cambia.

**Cómo funciona**
1. **La MAC es el ancla de confianza.** Lo recomendado es fijarla a mano con
   la que muestra la pantalla del NVR (Configuración → Red → TCP/IP), por
   ejemplo `NVR_MAC='02:1a:2b:3c:4d:5e'`. Si falta, `set-nvr` y `apply` la
   leen de `ip neigh` justo después de un probe OK **con credenciales**.
   `follow-nvr` **nunca** la aprende (un TCP sin credenciales no prueba que
   sea el NVR): sin ella avisa y sale con 10.
2. **Chequeo barato** en cada pasada: TCP a `NVR_HOST:NVR_PORT` (sin
   credenciales: no cuenta como login fallido) y la MAC de esa IP en
   `ip neigh` coincide con `NVR_MAC`. Si cuadra: "OK, sin cambios".
3. **Si falla 2 veces seguidas** (10 minutos; un reinicio breve del NVR no
   cuenta), hace un ping a la /24 de `eth0` (nunca más que eso, de a 32) y
   busca la MAC en `ip neigh`.
4. **Una sola IP con la MAC y el puerto respondiendo**:
   - actualiza `NVR_HOST`;
   - corre el mismo flujo de `apply` (probe con credenciales, drop-in
     `IPAddressAllow` con la /32 nueva y reinicio del servicio);
   - si algo falla, vuelve atrás `NVR_HOST` y la config.
5. **Topes por día**:
   - **3 cambios de IP aplicados**;
   - **12 intentos**: probe más apply a una IP nueva. Un intento cuyo probe
     falla, o que se revierte, no gasta un cambio, pero sí un intento. Así no
     barre ni manda la credencial sin fin al mismo candidato.

   Comparte el lock con `apply`, `set-nvr` y `rotate-password`: si uno está
   corriendo, no hace nada (lo reintenta en la próxima pasada).

**Cómo verlo**

```bash
journalctl -u vigilia-relay-follow-nvr -n 30 --no-pager
systemctl list-timers | grep follow-nvr
sudo vigilia-relay status        # NVR, NVR_MAC, fallos, cambios e intentos de hoy y la última pasada
sudo vigilia-relay follow-nvr    # una pasada a mano ("OK, sin cambios")
```

El estado (fallos seguidos, cambios e intentos del día) vive en
`/var/lib/vigilia-relay/follow-nvr.state`. Si está corrupto o falta, se
parte de cero. Si no se puede escribir (SD en solo lectura), no cambia la IP,
porque el tope de intentos no regiría.

Dos pasadas manuales seguidas, con menos de ~30 s entre ellas, pueden dar el
aviso de ARP o la alerta de MAC duplicada de forma espuria. El kernel da por
confirmada (REACHABLE) una entrada unos 30 s después del último contacto, y
la IP vieja del NVR todavía cuenta como viva. Espera un minuto y repite antes
de actuar; el timer (cada 5 min) no tiene este problema.

**NVR reemplazado en la misma IP** (`en <IP> responde otro equipo (MAC …)`):
la MAC nueva no coincide con `NVR_MAC`, así que `follow-nvr` no lo sigue y
sale con 10. Confirma la MAC en la pantalla del NVR nuevo y:

```bash
sudo vigilia-relay apply --relearn-mac     # probe con credenciales y relee la MAC de ip neigh
```

`--relearn-mac` (también en `set-nvr`) exige un probe OK con credenciales a
una cámara del NVR; si no lo hay, `NVR_MAC` queda como estaba. Otra opción es
fijarla a mano. Sale con 3 si el probe falla y con 1 si no pudo leer la MAC (o
si `cameras.conf` no tiene cámaras del NVR). `apply --relearn-mac` no admite
`--skip-probe`.

**Alerta "la MAC del NVR aparece en varias IPs"** (exit 9): dos equipos
vivos dicen tener la MAC del NVR. Puede ser **suplantación ARP** (alguien de
la LAN haciéndose pasar por el NVR para recibir la credencial del relay).
`follow-nvr` **no cambia nada**.
1. Revisa en el NVR su IP real (`ssh -L` a su interfaz web).
2. Si es la de `NVR_HOST`, no hay que hacer nada más que avisar a la
   administración.
3. Si no, fíjala a mano: `sudo vigilia-relay set-nvr` + `apply`.
4. Si la alerta se repite, cambia la clave del usuario del NVR.

**Aviso "contesta ARP con la MAC del NVR pero no el puerto"** (con exit 10):
un equipo responde ARP con la MAC del NVR, pero no sirve RTSP. Si es el NVR
reiniciándose, la próxima pasada lo encuentra. Si se repite, trátalo como la
alerta anterior. Con dos equipos usando la misma MAC, la tabla del switch
oscila y el NVR verdadero puede quedar invisible durante el barrido; en ese
caso sale este aviso en vez del exit 9. En ninguno de los dos casos cambia
nada.

**Aviso "la MAC del NVR también figura en X, sin responder en el puerto"**
(con exit 0): `follow-nvr` siguió al NVR que respondió con credenciales y avisa
que la MAC apareció en otra IP, que no es la anterior. Puede ser una mudanza
vieja del NVR o un impostor que no sirve RTSP. Si se repite, revisa ese equipo.

**Riesgo residual**: un equipo de la LAN que suplante la MAC del NVR, sirva
RTSP y oculte al NVR verdadero (por ARP) puede atraer al relay. El riesgo ya
existía con la IP fija (ARP spoofing).
- **La credencial viaja en el probe.** El probe descarta los equipos que no
  sirven RTSP, **pero no autentica al NVR**: un impostor que acepte cualquier
  clave lo pasa. Además elige el método: si pide Basic, ffprobe le manda la
  clave (en Base64, sin cifrar); si pide Digest, puede intentar adivinarla
  offline.
- **La integridad también importa.** El impostor podría servir un video
  falso. Mientras solo se mira el video, es una molestia; cuando el video
  alimente al LPR (patentes que abren el portón), es un problema de
  integridad, no solo de confidencialidad.

Lo mitigan:
- la MAC fijada a mano como ancla (`follow-nvr` no la aprende solo);
- la alerta de MAC en dos IPs y el aviso de ARP sin RTSP;
- los topes de 3 cambios y 12 intentos por día;
- un usuario del NVR que solo tiene vista en vivo.

Para el LPR, lo ideal sigue siendo la reserva DHCP, o una VLAN o un switch
con *port security* entre la Pi y el NVR.

### Encontrar la IP nueva del NVR a mano

`follow-nvr` lo hace solo. A mano, por Tailscale SSH desde la Pi, se barre
solo la /24 de `eth0`, de a 32 conexiones a la vez:

```bash
ip -4 neigh show dev eth0
net="$(ip -4 -o addr show dev eth0 | awk '{ split($4, a, "/"); print a[1] }' | cut -d. -f1-3)"
seq 1 254 | xargs -P 32 -I{} bash -c "timeout 0.5 bash -c '</dev/tcp/$net.{}/554' 2> /dev/null && echo '$net.{}:554 abierto'"
```

Luego, `sudo vigilia-relay set-nvr` con la IP nueva, `apply`, y pide a la
administración la reserva DHCP.

### Cambiar la SD (por la de respaldo o por una nueva)

1. Lleva la SD de respaldo (está en tu casa). En la conserjería: desenchufar,
   cambiar la SD y enchufar.
2. En la consola de Tailscale, **Remove** del nodo `vigilia-relay` y regístralo
   de nuevo (`tailscale up`, con auth key si no hay navegador; ver
   [NeedsLogin](#troubleshooting)). Tras cualquier cambio de SD, la identidad
   vieja no se reutiliza.
3. Por Tailscale SSH: `set-nvr`, `probe`, `cameras.conf` y `apply` (el clon
   no tiene la clave del NVR) y `rotate-password`.
4. Destruye o borra la SD vieja.

### SD en solo lectura o llena

Cualquier comando de `vigilia-relay` sale con **6** y lo dice ("solo
lectura", "no queda espacio" o "E/S").

- **Solo lectura o E/S** (desgaste de la SD): `sudo reboot`. Si vuelve, [cambia
  la SD](#cambiar-la-sd-por-la-de-respaldo-o-por-una-nueva).
- **Llena**: `sudo journalctl --vacuum-size=32M`, `df -h` y
  `sudo apt clean`.
- netwatch, sin poder guardar su estado, igual reinicia la Pi tras más de
  30 min sin red, pero sin tope diario. En el journal se lee "sin tope diario:
  el contador no se pudo guardar".

### Si roban la Pi (o se pierde la SD de respaldo)

La SD tiene en claro la clave del NVR (`relay.env` y `mediamtx.yml`) y la
identidad Tailscale del nodo.

1. **Tailscale**:
   - en la consola, Machines → `vigilia-relay` → **Remove** (el clon comparte la
     identidad: también queda fuera);
   - **revoca las auth keys reutilizables** (Settings → Keys);
   - revisa que no haya **Machines desconocidas**.
2. **NVR**: que la administración o el técnico **cambien la clave** del usuario
   de vista en vivo (o lo borren) desde la interfaz local del NVR.
3. **Lector**: en la Pi nueva, `rotate-password`. La SD robada solo tiene el
   hash sha256 de una clave aleatoria de 32 caracteres, pero igual se rota.
4. Avisa a la administración: es un incidente de datos personales
   (Ley 21.719).

## Troubleshooting

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `probe`: `CLAVE` (401/403) | Usuario o clave mal, o IP bloqueada por el NVR | No reintentes en loop. Revisa con `set-nvr`. Si estaba bien, espera ~30 min (bloqueo del Hikvision). Clave con `:`: cámbiala por una sin `:` (no se pudo probar de punta a punta). |
| `probe`: `TIMEOUT` o `SIN-RED` | Cambió la IP del NVR, NVR apagado o cable | `ping <IP-NVR>` desde la Pi; follow-nvr la corrige solo en ≤ 10 min ([detalle](#ip-del-nvr-por-dhcp-seguimiento-automático)) o [a mano](#encontrar-la-ip-nueva-del-nvr-a-mano) |
| `probe`: `NO-EXISTE` (404) | Canal sin cámara | Normal en los canales vacíos |
| `probe`: `no existe el usuario vigilia-probe` | Kit instalado sin `install.sh` | `sudo bash install.sh` |
| Se ve en `probe` pero no en VLC | H.265 o H.264+ en el substream, o falta `apply` después de cambiar el NVR (red permitida vieja) | En el NVR: H.264 sin "+", I-frame cada 1–2 s; `sudo vigilia-relay apply` |
| `apply` / `set-nvr`: `no es una IP: usa la IP del equipo` | Un host por nombre, IPv6 con IPv4 incrustada o IP con ceros a la izquierda | Usa la IPv4 del equipo (reserva DHCP) |
| `apply`: `la URL debe empezar exactamente con rtsp://` | Esquema en mayúsculas (`RTSP://`) | Escríbelo en minúsculas |
| `apply` / `status`: `AVISO (lectores solo por loopback): READER_ALLOWED_IPS no está definido` | Fail-closed: solo loopback | Define la IP 100.x del PC en `relay.env` y `apply` |
| Cualquier comando sale con 8: `AVISO: hay otro ... en curso` | Otro `apply`, `rotate-password`, `set-nvr` o `follow-nvr` corriendo (otra sesión o el timer, cada 5 min) | Espera a que termine y repite; no se hizo nada |
| `follow-nvr` sale con 9: `ALERTA: la MAC del NVR aparece en varias IPs` | Dos equipos vivos con la MAC del NVR (posible suplantación ARP) | Ver [IP del NVR por DHCP](#ip-del-nvr-por-dhcp-seguimiento-automático); no cambió nada |
| `follow-nvr` sale con 10: `no se encontró el NVR` | El NVR está apagado o fuera de la /24 de eth0. Con `contesta ARP con la MAC del NVR pero no el puerto`: NVR reiniciando o posible suplantación | Revisa el NVR. Si el aviso de ARP se repite, ver [IP del NVR por DHCP](#ip-del-nvr-por-dhcp-seguimiento-automático) |
| `follow-nvr` sale con 10: `falta NVR_MAC` | Nunca se fijó la MAC del NVR (`follow-nvr` no la aprende solo) | Fíjala a mano con la de la pantalla del NVR ([Fase C](#fase-c--remota-por-tailscale-ssh-3060-min)) o corre `sudo vigilia-relay apply` (la aprende tras un probe OK) |
| `follow-nvr`: `en <IP> responde otro equipo (MAC …)` | Reemplazaron el NVR (MAC nueva en la misma IP) u otro equipo tomó la IP del NVR | Confirma la MAC en la pantalla del NVR. Si es el NVR nuevo: `sudo vigilia-relay apply --relearn-mac`. Si no, es otro equipo: espera a que `follow-nvr` encuentre al NVR, o búscalo [a mano](#encontrar-la-ip-nueva-del-nvr-a-mano) |
| `follow-nvr` sale con 11: `ya se hicieron los 3 cambios de IP de hoy` | El NVR cambió de IP muchas veces (o hay algo raro en la red) | Revisa el DHCP del router; `sudo vigilia-relay set-nvr` + `apply` a mano |
| `follow-nvr` sale con 11: `ya se hicieron los 12 intentos de cambio de IP de hoy` | Los intentos fallaron o se revirtieron (clave del NVR cambiada, o un candidato que no es el NVR) | `journalctl -u vigilia-relay-follow-nvr`; revisa la clave (`set-nvr`) y fija la IP a mano. Al día siguiente vuelve a intentar |
| `install.sh`: `No se toca /etc/netplan/…: además del Wi-Fi configura eth0` | Un YAML de netplan con el Wi-Fi y eth0 juntos | Quita solo el Wi-Fi a mano: [Copias de la clave del Wi-Fi](#copias-de-la-clave-del-wi-fi) |
| Las cámaras se cortaron y el router le dio otra IP al NVR | — | Espera ≤ 10 min (follow-nvr); `journalctl -u vigilia-relay-follow-nvr` |
| `apply` sale con 7: `daemon-reload falló` | systemd no recargó la unidad; se restauró la red permitida anterior y no se aplicó nada | `systemctl status`, `journalctl -b -p warning` |
| `apply` sale con 3 | Ningún canal respondió, o hubo 401 | Ver `probe`; `--skip-probe` solo si sabes por qué |
| `apply` sale con 4 | MediaMTX no cargó la config nueva: se restauró la anterior | `journalctl -u vigilia-relay -n 50` |
| `apply` sale con 5 | Ni la nueva ni la anterior responden | `systemctl status vigilia-relay`, `journalctl -u vigilia-relay -n 100` |
| Cualquier comando sale con 6: "solo lectura", "no queda espacio" o "E/S" | SD en solo lectura (desgaste), llena o dañada | Ver [SD en solo lectura o llena](#sd-en-solo-lectura-o-llena) |
| Olvidaste la clave de sudo | `install.sh` borró `010_pi-nopasswd` | [Salida de emergencia](#a2-primer-arranque-y-kit) por Tailscale SSH como root, con la ACL temporal |
| `status`: API 401 | `api.secret` no coincide con `mediamtx.yml` | `sudo vigilia-relay apply --skip-probe` o `sudo systemctl restart vigilia-relay` |
| VLC: 401 desde casa | Clave del lector mal, o la IP del consumidor no está en `READER_ALLOWED_IPS` (en Linux, ¿se conectó por IPv6?) | `rotate-password`; `tailscale ip -4` en el PC; usa la IP 100.x |
| VLC no conecta (timeout) | ACL, MagicDNS o la Pi offline | `tailscale ping vigilia-relay`; usa la IP 100.x |
| La Pi no aparece en Tailscale / `NeedsLogin` | La identidad del nodo se perdió o la sacaste de la consola | Visita con un notebook por Ethernet al switch: `ssh benjamin@<IP-LAN-de-la-Pi>` (eth0:22) y `sudo tailscale up ... --auth-key=file:/root/tailscale-authkey` (ver A4). La SD de respaldo no sirve: comparte la identidad del nodo. |
| Mucha latencia | Tailscale por DERP (sin conexión directa) | `tailscale ping vigilia-relay` dice "via DERP": revisa que la red permita UDP saliente (41641) |
| `get_throttled` ≠ 0x0 | Bajo voltaje (bit 0/16) o temperatura (bit 3/19) | Fuente oficial de 2,5 A; ventilación |
| La Pi se reinicia sola | netwatch (más de 30 min sin red) o el watchdog | `journalctl -b -1 -u vigilia-relay-netwatch`; `journalctl -b -1 -p warning` |
| Hace falta el Wi-Fi | `install.sh` lo apagó (`dtoverlay=disable-wifi`) | Borra esa línea de `/boot/firmware/config.txt` y `sudo reboot` (y configura el Wi-Fi con `nmtui`) |

## Botón de apagado (opcional, solo documentado)

Pulsador entre **GPIO3 (pin 5)** y **GND (pin 6)**, con
`dtoverlay=gpio-shutdown` en `/boot/firmware/config.txt`:
- una pulsación apaga limpio;
- con la Pi apagada, otra pulsación la enciende (GPIO3 es el pin de wake).

No viene instalado: en la conserjería, un botón al alcance invita a apagarla.

## Conocido

- **MediaMTX v1.15.2 tiene avisos de seguridad publicados posteriores.** Con
  esta configuración no son alcanzables: solo RTSP con auth, API en loopback
  sin `any`, sin hooks `runOn*`, sin WebRTC/HLS/RTMP/SRT/playback/metrics. La
  subida (a v1.21.2 o posterior) se hará **coordinada** con el MediaMTX central
  del VPS. Mientras tanto: **no habilitar hooks (`runOn*`) ni exponer la API**
  fuera de loopback.

## Referencia

**Archivos en la Pi**

| Ruta | Permisos | Contenido |
|---|---|---|
| `/etc/vigilia-relay/relay.env` | 600 root | NVR (con clave), canales, lectores |
| `/etc/vigilia-relay/cameras.conf` | 600 root | Cámaras (opcional) |
| `/etc/vigilia-relay/api.secret` | 600 root | Clave de `vigilia-admin` (API local) |
| `/etc/vigilia-relay/reader.hash` | 600 root | `sha256:` de la clave del lector (no la clave) |
| `/etc/vigilia-relay/mediamtx.yml` (+ `.prev`) | 640 root:vigilia-relay | Config generada (JSON); lleva la clave del NVR |
| `/etc/systemd/system/vigilia-relay.service.d/10-ipaddress.conf` | 644 root | Red permitida al servicio (la escribe `apply`) |
| `/etc/ssh/sshd_config.d/10-vigilia-relay.conf` | 644 root | sshd: solo clave, sin root, `AllowUsers` |
| `/opt/vigilia-relay/` | 755 root | Kit, `bin/mediamtx` (+ `.prev`) |
| `/var/lib/vigilia-relay/netwatch.state` | 600 root | Estado de netwatch |
| `/var/lib/vigilia-relay/follow-nvr.state` | 600 root | Estado de follow-nvr (fallos seguidos, cambios e intentos del día) |
| `/etc/sudoers.d/020_vigilia-tty` | 440 root | `Defaults timestamp_type=tty` |

**Config de MediaMTX generada**

- Solo RTSP en `:8554`, por TCP y con auth Basic (las claves van hasheadas como
  `sha256:`, así que Digest no es posible).
- API en `127.0.0.1:9997`.
- WebRTC, HLS, RTMP, SRT, playback y metrics, apagados.
- Usuarios:
  - `relay-reader`: solo `read`, con las `ips` de `READER_ALLOWED_IPS` más
    loopback (canónicas y ordenadas, como las devuelve la API);
  - `vigilia-admin`: solo `api` desde loopback.
  - Sin usuario `any`: la API devuelve la `source` con la clave del NVR.
- `pathDefaults`: `sourceOnDemand`, inicio 15 s, cierre 30 s, TCP hacia el NVR
  y `maxReaders: 3`.
- Red del servicio: `IPAddressDeny=any` y solo loopback, el NVR, los hosts de
  `url:` y Tailscale.

**Códigos de salida del CLI**

| Código | Significado |
|---|---|
| 0 | OK |
| 1 | Error (config inválida, permisos, API) |
| 2 | Uso incorrecto |
| 3 | `probe` sin canales OK, o el origen rechazó las credenciales |
| 4 | `apply`: la config nueva no quedó activa; se restauró la anterior |
| 5 | `apply`: tampoco responde la anterior (revisar el servicio) |
| 6 | La SD está en solo lectura, llena o con errores de E/S ([sección](#sd-en-solo-lectura-o-llena)) |
| 7 | `apply`: `systemctl daemon-reload` falló; se restauró la red permitida anterior y no se aplicó nada |
| 8 | Otro `apply`, `rotate-password`, `set-nvr` o `follow-nvr` en curso (lock); en el timer de follow-nvr no cuenta como fallo |
| 9 | `follow-nvr`: la MAC del NVR aparece en 2+ IPs (alerta, ningún cambio) |
| 10 | `follow-nvr`: no se encontró el NVR, o falta `NVR_MAC` |
| 11 | `follow-nvr`: tope diario alcanzado (3 cambios de IP aplicados o 12 intentos) |

**Hechos de MediaMTX v1.15.2 verificados con el binario**

- Vigila su config y la recarga en caliente. **Descarta** los cambios que
  llegan menos de 1 s después de la recarga anterior, por eso `apply` espera.
- Con una config inválida, **termina con código 0**: la unidad usa
  `Restart=always`.
- La API devuelve `authInternalUsers[].ips` canónicas (agrega `/32`, IPv6 en
  minúsculas) y **ordenadas como string**. El resto vuelve tal cual. `apply`
  compara cada clave renderizada con esa normalización y revierte si no
  coincide dentro del plazo.
- Si rechaza una `source` (escape `%` inválido, carácter fuera del userinfo),
  **imprime la URL con la clave**. Por eso `url:` se valida antes, con el
  mismo criterio que el `url.Parse` de Go.
- Las claves de `authInternalUsers` solo admiten
  `A-Z 0-9 ! $ ( ) * + . ; < = > [ ] ^ _ - , @ # &`. Su parser Basic descarta
  las claves con `:`. Esto afecta al NVR falso, no al Hikvision.

## Desarrollo

```bash
python -m pytest edge/camera-relay/tests                                      # unitarios (3.11+)
MEDIAMTX_BIN=mediamtx/mediamtx.exe python -m pytest edge/camera-relay/tests  # + contract test
bash scripts/gate.sh                                                          # incluye el kit
```

```powershell
# E2E en Windows: dos NVR falsos (Digest y Basic) y el relay real.
powershell -NoProfile -ExecutionPolicy Bypass -File edge\camera-relay\e2e\run-e2e.ps1 -Python C:\Python314\python.exe
```

El job `camera-relay` de `.github/workflows/ci.yml` corre:
- pytest en 3.11 (Bookworm) y 3.13 (Trixie), con el binario `linux_amd64`
  verificado por SHA256;
- shellcheck y `bash -n`;
- `systemd-analyze security`: `--threshold=20` para el relay y
  `--threshold=30` para netwatch y follow-nvr.

`tests/test_install_sh.py` carga `install.sh` con `source` (no corre `main`) y
prueba la limpieza de las copias de la clave del Wi-Fi y de cloud-init sobre
una carpeta temporal. Solo corre en POSIX con bash (en Windows se salta).
