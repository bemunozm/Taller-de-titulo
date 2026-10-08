# Estación Aiphone GT-1D y bus R1/R2 del sistema GT — verificación de afirmaciones para tesis IoT

> Notas densas y respaldadas por fuentes para el redactor del informe. Cada afirmación se marca **VERIFICADA / NO VERIFICADA / REFUTADA** con cita textual y URL. Para código se cita ruta de archivo y líneas. Fecha de corte: septiembre 2026.
>
> Contexto físico del tesista (dato de entrada, no verificado por fuente externa): estación **GT-1D**, PCB "XC-1551, GT-1D.M, Ver. 1.00", botones serigrafiados **RELEASE** y **GUARD**; medido **~20–24 V DC entre R1 y R2**; durante el timbrado **no se vio cambio** ni en multímetro DC ni en analizador lógico tras divisor ÷6.
>
> Fuentes primarias usadas:
> - Manual de instalación GT en español (texto extraído local): `...\scratchpad\gt_manual.txt`, sección 4-7 pág. 49-50 (PNG `gt_pages\pag49.png`, `pag50.png`) — leído directo.
> - Manual de operación GT-1D EN (PDF oficial descargado): `GT_operation_manual_GT-1D.pdf` de aiphone.net.
> - Repo `xssfox/aiphone-gt-tools` (GitHub), archivos leídos vía raw.githubusercontent.com. Últimos commits al 2026-01-11.
> - Repo `MReschenberg/intercom-project` (GitHub), README + intercom.py.
> - Ficha oficial GT-TLI-IP (Aiphone Corp., rev. 09/22).
> - Hilo Home Assistant community `t/aiphone-intercom/160897`.

---

## 1. Botones del GT-1D (Door release, Guard station call/light, Option) y si "GUARD" abre un portón de fábrica

### Takeaway
**VERIFICADO** que el GT-1D de fábrica tiene 3 botones: **Option**, **Guard station call/light** y **Door release**, con las funciones que describe la afirmación. **REFUTADO** que exista una función de fábrica documentada para que un botón abra un portón vehicular: no existe. La apertura de portón observada en terreno solo puede explicarse por cableado de instalador desde la "salida de contacto opcional" (SW en CN4), no por función nativa.

### Cited Findings
- El GT-1D tiene tres botones de fábrica, listados en "1 NAMES AND FUNCTIONS": "**Option button**", "**Guard station call/light button**", "**Door release button**" — Manual operación GT-1D, líneas 80-83 (`GT_operation_manual_GT-1D.pdf`), URL: https://www.aiphone.net/support/software-documents/download/gt/manual/en/GT_operation_manual_GT-1D.pdf
- **Door release solo durante comunicación**: "2-3 Door release … 1 Press the door release button **while in communication with the entrance station**. 2 Door release is activated at the entrance station." Nota: "Duration of door release activation can be controlled by the entrance panel audio module, or by the door release system that is used." — Manual GT-1D líneas 119-127. [Fuente](https://www.aiphone.net/support/software-documents/download/gt/manual/en/GT_operation_manual_GT-1D.pdf)
- **Light control solo durante llamada, y con excepción de cámara**: "2-4 Light control … 1 Press the guard station call/light button once **during entrance station calling or communication**. 2 The light at the entrance will only turn on for the preset time duration. NOTE: **This function is not available if a surveillance camera is installed in the common area.**" — Manual GT-1D líneas 125-137. [Fuente](https://www.aiphone.net/support/software-documents/download/gt/manual/en/GT_operation_manual_GT-1D.pdf)
- **El botón Guard tiene doble/triple función según contexto** (llamar a conserjería, light control, y toggle Doctor call):
  - Llamar a conserjería: "2-6 Calling guard stations … 1 **Lift the handset, then press the guard station call/light button.** 2 Speak when the guard station answers the call." — líneas 159-162.
  - Toggle Doctor call: "To enable Doctor call: **In standby mode, press the guard station call/light button.** * Repeat this to disable Doctor call. … When the Doctor call function is enabled, the Tone off LED flashes at approximately 3 second intervals." — líneas 145-150. [Fuente](https://www.aiphone.net/support/software-documents/download/gt/manual/en/GT_operation_manual_GT-1D.pdf)
- **Qué hace Doctor call** (apertura automática indiscriminada, NO apertura puntual): "When the specified residence is called using Doctor call (automatic entry), the electric lock is automatically released **without a door release operation** from the residential/tenant station. … 1 Press the CALL button of the entrance station to unlock the door without a door release operation…" — Manual GT-1D líneas 139-143. [Fuente](https://www.aiphone.net/support/software-documents/download/gt/manual/en/GT_operation_manual_GT-1D.pdf)
- **Option button**: "2-7 Option button. Pressing the option button allows for operation of connected units, such as turning lights on and off. … NOTE: **A signal is output while the option button is being pressed.** (The operation method may differ depending on the device used in conjunction with this unit.)" — Manual GT-1D líneas 169-182. [Fuente](https://www.aiphone.net/support/software-documents/download/gt/manual/en/GT_operation_manual_GT-1D.pdf)
- **No existe función de portón vehicular** en todo el manual de operación (búsqueda de "gate"/"vehicle": sin resultados). La salida física para "unidades externas" es la del connector CN4: "3 Salida de contacto opcional: Las unidades externas como las luces o los ascensores pueden accionarse con el botón opcional. Especificaciones de contacto: Carga máxima CA/CC 24 V, 1 A / Carga mínima CC 5 V, 0,1 A" — Manual instalación pág. 50, `gt_manual.txt` líneas 4494-4500. [Fuente](https://www.aiphone.net) (manual instalación GT ES)

### Inferences
- La serigrafía "GUARD" en la unidad del tesista corresponde al **"Guard station call/light button"** de fábrica (△). "RELEASE" corresponde al **Door release** (⌐0). El tercer botón físico (Option, □) puede existir pero no haber sido identificado, o su función puede estar sin uso.
- Si en terreno "GUARD" (o cualquier botón) abre el portón vehicular, es **personalización de instalador**: lo más plausible es que el **Option button** esté cableado a la "salida de contacto opcional" SW de CN4 (24 V/1 A) → relé externo → entrada P.P./START del motor. El Option button es el candidato natural porque su función de fábrica es precisamente "operar unidades externas" y "emite señal mientras se mantiene presionado". Requiere trazar el cableado desde CN4/SW en terreno.
- Doctor call NO sirve para el flujo QR de Vigilia: abre automáticamente a **cualquier** visitante que llame a ese depto mientras el modo está activo (toggle), no por visita puntual.

### Gaps
- El manual no dice qué botón físico mapea al Option en el GT-1D (posición exacta); confirmar en terreno.

---

## 2. Conector de contactos opcionales CN4 del GT-1D (8 pines): RY, SW, CE/C, KE/K; colores y naturaleza eléctrica de RY

### Takeaway
**VERIFICADO** (manual instalación sección 4-7, pág. 49-50) el pinout, colores y specs de CN4 del GT-1D. La afirmación es correcta salvo un matiz importante: **CE/C es "Timbre" (entrada para un timbre/chime local N/O), no "door chime input" del bus**, y **RY no es una salida de relé por sí misma: solo señaliza para excitar el módulo relé externo GT-RY**. La naturaleza eléctrica exacta de RY (voltaje/colector abierto) NO está en el manual, pero mediciones de comunidad indican ~5 V en el par de notificación de llamada.

### Cited Findings — pinout y colores del GT-1D (8 pines), pág. 49
Del diagrama oficial (`gt_pages/pag49.png`, bloque "GT-1D"), leído directo:
- **SW (Negro) / SW (Gris)** → "**3 Salida de contacto opcional**" (optional contact output).
- **RY (Blanco) / RY (Azul)** → "**2 Notificación de llamada**" (call notification).
- **CE (Amarillo) / C (Naranja)** → "**8 Timbre**" (chime/timbre).
- **KE (Rojo) / K (Marrón)** → "**1 Alarma de emergencia (JP1 debe cortarse para usarse)**".
- Confirmación textual "GT-1D: 8 pines" en `gt_manual.txt` línea 1307. [Fuente: manual instalación GT ES, pág. 49] (`scratchpad\gt_pages\pag49.png`)
- El pinout físico del header CN4 (pág. 44, `gt_manual.txt` líneas 3898-3985) lista alrededor de CN4: `C, CE, KE, RY, RY, K, SW, SW` con jumpers `JP1` y `JP4`. [Fuente: manual instalación GT ES pág. 44]

### Cited Findings — specs eléctricas de cada función (pág. 50)
- **SW / Salida de contacto opcional**: "Las unidades externas como las luces o los ascensores pueden accionarse con el botón opcional. **Especificaciones de contacto: Carga máxima CA/CC 24 V, 1 A / Carga mínima CC 5 V, 0,1 A**" — `gt_manual.txt` líneas 4494-4500. (Confirma spec de la afirmación: 24 V 1 A máx, 5 V 0,1 A mín.) [Fuente: manual pág. 50]
- **RY / Notificación de llamada**: "El uso del **relé de señalización externo GT-RY** permite que un **zumbador externo esté conectado durante la llamada.**" El ejemplo de conexión (pág. 50) muestra: terminales del citófono (Azul/Blanco) → **GT-RY** → contacto del GT-RY que a su vez alimenta un **relé de temporizador** y un **zumbador** (productos de terceros). "**Especificación de contacto del GT-RY: CA/CC 24 V, 0,5 A**". Cable "Negro (sin usar)". — `gt_manual.txt` líneas 4494-4563, `pag50.png`. [Fuente: manual pág. 50]
- **CE/C / Timbre**: "**8 Timbre**: Se puede conectar un timbre al intercomunicador principal vivienda. **Contacto N/O (tipo desbloqueado), CC 12 V/0,1 A o superior.** NOTA: Un timbre por cada intercomunicador… No conecte dos o más." — `gt_manual.txt` líneas ~4487-4493 (pág. 50). Es **entrada para un pulsador de timbre local** (doorbell button junto a la puerta del depto), que hace sonar un tono distinto sin comunicación (ver "2-2 Calling from the doorbell button", manual operación líneas 110-116). [Fuente: manual pág. 50]
- **KE/K / Alarma de emergencia**: "**1 Alarma de emergencia**: Se puede conectar un interruptor de alarma de emergencia. GT-2C-L/GT-2C, **GT-1D: Contacto N/C (tipo bloqueado), CC 12 V/0,1 A o superior**." Para el GT-1D, "**JP1 debe cortarse para usarse**" (pág. 49). En pág. 44 (*3): "Cuando se use un interruptor de alarma de emergencia, **retire el cable de unión de los conectores JP1**." — `gt_manual.txt` líneas 4485-4487, 3966-3971. **Confirma la afirmación (KE/K = alarma emergencia, cortar JP1).** [Fuente: manual pág. 44/49/50]

### Cited Findings — matiz sobre jumpers JP1 vs JP4 (importante, no confundir)
- **JP1** = cable de unión para **alarma de emergencia** (cortar/abrir para usar la alarma). — pág. 44 (*3) y pág. 49.
- **JP4** = cable de unión para **Doctor call / llamada de urgencia (apertura automática)**: "7 Llamada de urgencia (apertura automática) … Para habilitar la llamada del médico: **GT-1D: Corte (abra) el cable de unión JP4**." — `gt_manual.txt` líneas 4535-4536 (pág. 50) y pág. 44 (*3). [Fuente: manual pág. 50]
- El PCB del tesista (GT-1D.M Ver 1.00) debiera tener ambos jumpers JP1 y JP4.

### Cited Findings — naturaleza eléctrica del par de notificación (medición de comunidad)
- En el hilo HA, usuario "HoneyBadger100" reporta que la señal de llamada entrante en los **pines azul/blanco** (= par RY del GT-1D) "**uses 5V so I have used a potentiometer to convert it to 3V**". Usuario "Asphaug" en GT-1M3-L: "**Pin 3 and 4 in the options connection … is 24v**" y detecta llamada cuando el voltaje "goes over 2v on analog1". — https://community.home-assistant.io/t/aiphone-intercom/160897
- Nota crítica del mismo hilo: "**This doorbell is TRICKY and very sensitive to current/voltage draws**" al intentar alimentar un ESP desde el citófono. [Fuente](https://community.home-assistant.io/t/aiphone-intercom/160897)

### Inferences
- **RY es una salida de señalización de bajo nivel** (probablemente un nivel de tensión ~5 V respecto al par, no un contacto seco), diseñada exclusivamente para excitar el módulo **GT-RY** (relé de terceros/Aiphone) durante la llamada. **RY NO abre puertas ni conmuta cargas por sí mismo**; el único contacto conmutable de 24 V/1 A del GT-1D es **SW** (salida de contacto opcional del Option button). Esto confirma la conclusión previa: para automatizar apertura hay que usar SW, no RY.
- El GT-RY es solo notificación (zumbador/monitor externo). No es un módulo de comando de cerradura; no existe un "GT-OP" ni segunda salida de cerradura documentada para estaciones estándar.
- El comportamiento de RY "durante el timbrado" es: se **activa mientras dura la llamada** (excita el GT-RY para el zumbador externo). Coherente con la medición ~5 V en azul/blanco durante llamada.

### Gaps
- El manual **no especifica** si RY es salida de voltaje, colector abierto o contacto; solo dice que se usa con GT-RY. La medición de comunidad (~5 V en azul/blanco) es la mejor evidencia disponible pero es de un usuario, no de Aiphone, y sobre GT-1M3-L (par equivalente).
- No hay dato oficial del consumo/carga máxima que RY puede excitar directamente (se delega al GT-RY).

---

## 3. Puerto de auricular RJ9 del GT-1D y detección/atención de llamada (MReschenberg/intercom-project)

### Takeaway
**VERIFICADO** el pinout RJ9 del GT-1D y el método: el proyecto detecta el timbre por **umbral acústico** (RMS de audio) sobre la línea del auricular, y **contesta/abre con SwitchBots mecánicos** (no eléctricamente). No modifica el interior del citófono.

### Cited Findings
- Pinout del auricular en el PCB del GT-1D: "In the GT-D1, they're labelled and colored like this: **Red = R-, Green = R+, Yellow = Mic-, Black = Mic+**". Orden del jack RJ9 (clip abajo, izq→der): "**1. Black (Mic+) 2. Red (R-) 3. Green (R+) 4. Yellow (Mic-)**". Mapeo a 3.5 mm: "**We need to map R- to the left speaker, R+ to the right speaker, Mic+ to ground, and Mic- to mic.**" — README líneas 26-34, https://github.com/MReschenberg/intercom-project (`README.md`)
- **Conexión por RJ9, sin abrir el sistema**: "This project connects a Raspberry Pi to your intercom system via the **RJ9 port of the tenant station** … the Pi continuously monitors the line for a ring signal." "renter-friendly, and **doesn't require any modification of the internals** of your intercom". Solo audio, "**does not support video**". Probado en "an Aiphone GT system with an **Aiphone GT-1D** tenant station." — README líneas 2, 9. [Fuente](https://github.com/MReschenberg/intercom-project)
- **Detección de timbre por umbral acústico**: "Your Pi will always monitor a low level of noise on your intercom line. When the intercom rings, though, that noise level will change. … we'll sample a ring on the line and use that to create a `RING_THRESHOLD`." En código: `AMPLITUDE = audioop.rms(in_data, CHANNELS)` y dispara si `AMPLITUDE > RING_THRESHOLD and MONITOR_COUNT > MONITOR_THRESHOLD` — `intercom.py` líneas 76-79. Valores del autor: "My ring peaked at 18, so I set my threshold to 16" (`RING_THRESHOLD = 16`, `MONITOR_THRESHOLD = 60`), README líneas 122-126. [Fuente](https://github.com/MReschenberg/intercom-project)
- **Atención y apertura por SwitchBots mecánicos**: "Two SwitchBots -- **one for controlling the door release button, and one controlling the phone hook/hang-up mechanism**." "My 'answer' hook simulates picking up the phone by telling the SwitchBot on the phone hook to press once. … My 'door release' hook tells the SwitchBot on the door release button to press twice, waiting three seconds between presses." — README líneas 15, 67-68. [Fuente](https://github.com/MReschenberg/intercom-project)
- **Apertura vía DTMF "9" en la llamada SIP**: "Pressing '9' will activate the door release". Código: `def on_dtmf_digit(self, digit): if (digit == "9"): requests.post(DOOR_RELEASE_HOOK)` — `intercom.py` líneas 44-48. La llamada saliente va a un celular vía **Twilio SIP / PJSIP**. — README líneas 9, 45-46. [Fuente](https://github.com/MReschenberg/intercom-project)

### Inferences
- Este enfoque es **"caja negra"**: usa el audio ya presente en el auricular (no toca R1/R2 ni el bus). El timbre no se detecta como señal eléctrica del bus sino como **subida de nivel de audio** en el altavoz del auricular. Muy relevante para Vigilia: valida que se puede detectar llamada y abrir puerta **sin intervenir el bus ni el protocolo**, solo con actuación mecánica sobre los botones + tap de audio del auricular.
- Coherente con la observación del tesista de que el timbre "no cambia" el DC de R1/R2 de forma medible: la evidencia del timbre está en el audio del auricular y/o en un paquete de datos del bus, no en un cambio sostenido de nivel DC.

### Gaps
- El proyecto no publica captura de la señal eléctrica del timbre en R1/R2 (usa audio, no bus).

---

## 4. Bus R1/R2: capa física, formato de trama, opcodes, checksum, audio, y herramientas busserver (xssfox/aiphone-gt-tools)

### Takeaway
**VERIFICADO** en su mayor parte contra el README y el código del repo: RS-232 9600 8E1, sistema flotante 24 V donde **24 V = mark y 12 V = space** (ojo: la afirmación decía "24 V = mark, 12 V = space", correcto). Formato de trama, longitud en el primer nibble del `to`, lista de opcodes y algoritmo de checksum: **todos publicados**. El audio va por R1/R2 (par audio/comms/power). Las herramientas (busserver/busserver_gw) hacen exactamente lo descrito. Estado del protocolo: el propio autor lo marca **WIP**.

### Cited Findings — capa física
- "The system appears to use a **floating 24v system**. The system is **not intended to be grounded**. The system is compromised of **2 wires for audio/comms/power (R1 R2)** and optionally 2 wires for video." — README líneas 37-38, https://github.com/xssfox/aiphone-gt-tools
- "The protocol is **RS-232, with 12v indicating space and 24v indicating a mark**. Interfacing with this is easiest done in software using a GT-1C7W, however I did have some luck reading off the bus using two different methods: Oscilloscope differencing the pairs (remember not to ground the signal); A galvanically isolated RS-232 to ethernet gateway + an adjustable voltage regulator which allowed creating a virtual ground at 18v." — README líneas 48-50. [Fuente](https://github.com/xssfox/aiphone-gt-tools)
- Config RS-232: "**9600 baud / 8 data bits / 1 stop bit / even parity**" — README líneas 52-56. **VERIFICA 9600 8E1.** [Fuente](https://github.com/xssfox/aiphone-gt-tools)

### Cited Findings — formato de trama
- "`to  from  cmd  parameters  checksum` / `8f 01  0c 01  b0  00 58  xx`". "The **first nibble of the `to` field determines the length of the packet.** It seems that the first byte of the `to`/`from` contains the type of device (entrance, guard,…) while the second byte contains the address." — README líneas 61-66. **VERIFICA formato [to][from][cmd][params][checksum] y longitud en primer nibble.** [Fuente](https://github.com/xssfox/aiphone-gt-tools)

### Cited Findings — opcodes publicados (README líneas 70-108)
Lista textual: `0x13 ping?`, `0x06 ack`, `0x24 line free - hang up`, `0x20 can haz line`, `0x26 can haz line plz`, `0x82 unlock`, `0x83 unlock`, `0xb0 lift control`, `0x40 (to 0f01 - open line?)`, `0x29 (to 0f01 - open line?)`, `0x86 monitor station`, `0x11/0x12 system info?`, `0x70 call no camera`, `0x71 call with camera`, `0x72 call no camera`, `0x73 call with camera`, `0x74 emergency call`, `0x79 call ok?`, `0x87 mon ok`, `0x89 end mon`, `0x8a ng mon`, `0xe1 ptz info`, `0xe3 camera control info`, `0xf4 check if can call this address?`, `0xf1/0xf2/0xf3 set address`, `0xf0 the response for gateway call`, `0xfd/0xfb call other address?`. — README líneas 70-108. **VERIFICA todos los opcodes citados en la afirmación** (0x82/0x83 unlock, 0xb0 lift, 0x24 line free/hang up, 0x20/0x26 request line, 0x70-0x74 calls, 0xf1-0xf3 set address). [Fuente](https://github.com/xssfox/aiphone-gt-tools)
- Advertencia del autor sobre la lista: "This is still WIP" y "Various commands exist, and **not full documented. Commands might be different across device types / modes.**" — README líneas 59, 68. [Fuente](https://github.com/xssfox/aiphone-gt-tools)

### Cited Findings — checksum (SÍ publicado)
- Algoritmo en Python (README líneas 112-121):
  ```python
  def chk(inputbytes: bytes):
      chksum = 0
      for x in inputbytes:
          chksum += x
          if chksum > 256:
              chksum = chksum - 256
      chksum = 256 - chksum
      return  chksum
  ```
  Es decir, checksum = `256 - (suma de bytes mod 256)`. **VERIFICA que el checksum está publicado.** [Fuente](https://github.com/xssfox/aiphone-gt-tools)
- El código C lo confirma de forma equivalente: en `gt-1c7w-tools/src/guard_open.c` líneas 163-171, `char chk = 0xff; chk = chk - msg[...] ... + 1;` (= `0x100 - suma` = `256 - suma`). En `busserver.c` "`buscontrol` will automatically set the checksum" (README línea 223) y el ejemplo `echo -n "8f010c01b00060" | ... nc -uc ... 4444` (línea 227). **Nota de inconsistencia menor**: el ejemplo del encabezado usa checksum `58` (`8f 01 0c 01 b0 00 58`) mientras el ejemplo de busserver termina en `60` y `guard_open.c` usa `0x59` para el mensaje lift-control (`0x8f,0x01,0x0c,0x01,0xb0,0x00,0x59`, línea 119). Consistente con el estado "WIP" del protocolo. [Fuente](https://github.com/xssfox/aiphone-gt-tools)

### Cited Findings — audio en R1/R2
- "2 wires for **audio**/comms/power (R1 R2)" — README línea 38. El audio, la señalización y la alimentación **comparten el mismo par R1/R2**. En configuración estándar, las entradas llaman directo a los residentes por este bus sin hardware adicional ("In a standard system you can have entrances call residents stations directly without any additional supporting hardware", README línea 44). [Fuente](https://github.com/xssfox/aiphone-gt-tools)

### Cited Findings — qué hacen busserver.c / busserver_gw / guard_open.c
- **busserver.c**: "Hooks `ps_gtl` with **ptrace** and watches for new bus messages by intercepting driver syscalls and peeking memory. It **broadcasts them via UDP on port 4444**. It also receives UDP messages on port 4444 … it will send that to the bus using the kernel driver. Before sending the message it **halts `ps_gtl` using ptrace** so that it doesn't clobber any of the messages … it uses the kernel driver (**tscomdrv**) to read the messages." — README líneas 216-224. Código confirma: `#define DRIVER_PATH "/dev/tscomdrv"`, `#define PORT 4444`, `ptrace(PTRACE_ATTACH,...)`, sockets UDP (`SOCK_DGRAM`) — `busserver.c` líneas 19, 25, 207-257. [Fuente](https://github.com/xssfox/aiphone-gt-tools)
- **guard_open.c**: "Performs a guard call to an entrance and unlocks it. Also triggers a 'lift control' message to unlock the elevator buttons." — README líneas 246-247. La tabla de mensajes incluye opcodes `0x26` (request line), `0x40`/`0x29` (open line), `0x83`/`0x84`/`0x81` (unlock variants), `0xb0` (lift) — `guard_open.c` líneas 111-121. [Fuente](https://github.com/xssfox/aiphone-gt-tools)
- **busserver_gw**: "This is a **gateway between MQTT and the busserver.c**. With busserver running on the intercom this tool … bridges the busserver packets to home assistant mqtt." "MQTT integration in home assistant should configure the components automatically." Ejemplo de evento HA muestra `event_type: ring`, `to_type: RESIDENT`, `from_type: ENTRANCE`, `from_address`, `to_address` — README líneas 258-290. [Fuente](https://github.com/xssfox/aiphone-gt-tools)

### Cited Findings — advertencias explícitas del autor
- "These tools interact with the **SHARED bus**. **Sending the wrong commands could cause the bus to stop functioning, cause all intercoms to ring, or reset devices.** Remember that you need to send hang up commands as well, otherwise **the bus will hang**." — README líneas 213-214.
- Sobre bus sin autenticación: "The bus is **not authenticated or signed** in any way. You can impersonate any user on the bus. Gateway logs will show another tenant performing an action." "Denial of service, either by sending bad packets or by just pulling the bus." — README líneas 9, 14.
- Sobre rootear el gateway GT-1C7W: es **soft-root** que debe repetirse en cada arranque (dejar la SD puesta), README línea 193. **Advertencia grave de bricking**: "This platform has a u-boot bug. **Performing any flash write operation, such as saveenv WILL brick the device.** The device will not be recoverable without a SH4 H-UDI specific JTAG tool." — README líneas 186-190. Y "The firmware update files … do not contain a full system image. If you modify the system on the device, you might not be able to restore it." — líneas 189-190.
- Especulación honesta del autor (no probado): "my vibe is that **it might be possible to trigger intercoms to think they are in a call state without them ringing first.** This would allow listening in… **This is speculation as I don't have enough of my own hardware to test this.**" — README línea 17. [Fuente](https://github.com/xssfox/aiphone-gt-tools)

### Inferences
- El bus **es descifrable e inyectable** (contradice la premisa previa de "sin diccionario público"), pero **requiere rootear un GT-1C7W** como gateway (soft-root por SD en cada boot) o hacer ingeniería inversa de la capa física con osciloscopio/gateway RS-232 aislado + tierra virtual a 18 V. Alto esfuerzo/riesgo; coherente con la decisión de Vigilia de **no intervenir el bus**.
- **Por qué el tesista no vio cambios durante el timbrado en R1/R2** (inferencia técnica, consistente con las fuentes):
  1. La señalización de timbre es un **paquete RS-232 corto** (mark/space entre 24 V y 12 V) sobre el par, no un cambio de nivel DC sostenido: un **multímetro DC** promedia y no lo capta.
  2. El bus **flota** (sin tierra) y "no debe aterrizarse"; un analizador lógico referenciado a una tierra ajena, incluso tras divisor ÷6, puede no cruzar el umbral lógico de forma fiable. xssfox explícitamente logró leerlo solo **diferenciando el par** con osciloscopio o con **gateway RS-232 galvánicamente aislado + tierra virtual a 18 V**. Un ÷6 mapea 24 V→4 V y 12 V→2 V; en reposo la línea está en **mark (24 V)** la mayor parte del tiempo, por lo que el tesista mide ~24 V estable.
  3. El "timbre" del citófono podría manifestarse como **audio en el auricular** (ver §3) y/o como paquete de datos, no como conmutación DC de R1/R2.

### Gaps
- El protocolo está incompleto (WIP); los checksums de ejemplo no son 100% consistentes entre secciones (posible errata o variación por tipo de dispositivo).
- No hay confirmación de que estos opcodes funcionen sobre un **sistema estándar/audio** (GT-BC + GT-1D) sin GT-1C7W: el repo asume el GT-1C7W como punto de inyección con driver `tscomdrv`.

---

## 5. Integraciones IP/app oficiales de Aiphone para sistemas GT existentes (GT-TLI-IP, GT-1C7W, app "AIPHONE Type GT")

### Takeaway
**VERIFICADO**: existen dos rutas oficiales — **GT-TLI-IP** (adaptador IP que se direcciona como estación tenant de video) y **GT-1C7W(-L)** (estación tenant con WiFi nativo). Ambas usan la app móvil y permiten **contestar la llamada y abrir la puerta**, pero **requieren el flujo de llamada del sistema GT** (mínimo una entrance station). **REFUTADO** el nombre "GT-DW" (no existe). Disponibilidad en Chile: **no verificada / sin evidencia** de venta local.

### Cited Findings — GT-TLI-IP (ficha oficial Aiphone Corp. rev. 09/22)
- Descripción: "The GT-TLI-IP is an **IP adaptor for the GT Series** that will allow mobile devices running the '**AiphoneGT**' app to be connected to **answer a call from a visitor and open the door**. … comes with the instructions to connect **up to 3 instances of the mobile app**. The GT-TLI-IP can be included in a tenant space with another GT Series tenant station or it can be used stand-alone so **the apps are the only option to answer and release the entrance door**." — Ficha GT-TLI-IP pág. 1. [Fuente](https://www.alarmax.com/customer/docs/skudocs/gt-tli-ip-specification.pdf)
- **Requiere sistema GT activo con entrada**: "**A working GT system with at least one entrance station is required** when using the GT-TLI-IP VoIP interface adaptor." — Ficha pág. 1. **Confirma que depende del flujo de llamada del bus.** [Fuente](https://www.alarmax.com/customer/docs/skudocs/gt-tli-ip-specification.pdf)
- Features: "12V DC Power Supply Included; **One Contact Input; Three Relay outputs; 24V DC 1A relay contact rating**; Supports up to three mobile apps; App available for both iOS and Android; **Addressed to the entry panel like a GT Video Tenant Station**." — Ficha pág. 1. [Fuente](https://www.alarmax.com/customer/docs/skudocs/gt-tli-ip-specification.pdf)
- Specs (pág. 2): "Power Source: **12V DC, 500mA** (Power Supply Provided). Power Draw: Standby 350mA, Active relay 430mA. **Relay Outputs: 12V DC, 2A; 24V DC, 1A.** Connections: 1 Cat-5e/6 Ethernet; 2 two conductor cables for GT (audio-872002, video-871802). R1/R2 & B1/B2 Connections; Relay Outputs / Contact Input." — Ficha pág. 2. **Confirma 3 salidas de relé + 1 entrada de contacto; corrige rating a 12V/2A o 24V/1A.** [Fuente](https://www.alarmax.com/customer/docs/skudocs/gt-tli-ip-specification.pdf)
- App: "The '**AiphoneGT**' App is free from **Gega Electronique** and is available on Google Play and Apple App Store." — Ficha pág. 1. (Ojo: el nombre en tiendas también aparece como "AIPHONE Type GT"; el prior lead lo llamaba así.) [Fuente](https://www.alarmax.com/customer/docs/skudocs/gt-tli-ip-specification.pdf)
- Precio referencial: ~USD 674.99 (distribuidor US). — https://www.surveillance-video.com/accessory-gt-tli-ip.html

### Cited Findings — GT-1C7W / GT-1C7W-L
- Soporte app nativo: "**Aiphone Type GT App capable (Up to 8 apps)**"; WiFi "IEEE802.11b/g/n", mínimo 3 Mbps; feature "Door release" y "Hands-free audio communication". — Página producto aiphone.com/products/gt-1c7w. [Fuente](https://www.aiphone.com/products/gt-1c7w)
- Es la estación tenant que xssfox **rootea** como gateway del bus (ver §4). [Fuente](https://github.com/xssfox/aiphone-gt-tools)

### Inferences
- **GT-TLI-IP es la vía oficial más limpia** para llevar el sistema GT existente del tesista a la app móvil: se direcciona como una estación tenant de video más, sin tocar el bus a nivel de protocolo. Trae **3 relés (12V/2A o 24V/1A) + 1 entrada de contacto** libres — técnicamente utilizables para portón/luz — pero funciona **ligado al flujo de llamada** (necesita entrance station y un visitante que llame). **No permite apertura "sin llamada" bajo demanda de un tercero externo de forma documentada.**
- La app oficial contesta y abre puerta pero **dentro de una llamada activa**, igual que la estación física. Para un flujo QR de Vigilia (apertura puntual sin residente), estas vías oficiales **no encajan directamente**: el modelo Aiphone siempre presupone un evento de llamada.
- "GT-DW" del prior lead **no existe** como SKU; el nombre correcto es GT-TLI-IP.

### Gaps
- **Disponibilidad en Chile**: no se encontró evidencia (en esta pasada) de venta/soporte local de GT-TLI-IP ni GT-1C7W; distribuidores chilenos de Aiphone no listan estos SKUs. Requiere confirmación con representante Aiphone Chile.
- La ficha no dice explícitamente si los 3 relés del GT-TLI-IP se pueden accionar **independientes** de una llamada (p.ej. desde la app en cualquier momento) o solo durante el flujo llamada→abrir. Verificar con manual de instalación del GT-TLI-IP.

---

## 6. Otras fuentes primarias sobre niveles de voltaje/señalización del bus GT (mediciones, capturas)

### Takeaway
La mejor evidencia de mediciones reales sobre el bus/opciones GT viene del **hilo Home Assistant** (usuarios midiendo con multímetro/ADC) y de las **notas de método de xssfox** (osciloscopio diferencial). No se hallaron capturas de osciloscopio de la señalización de timbre en R1/R2 publicadas abiertamente.

### Cited Findings
- **xssfox (método de medición)**: leer el bus requiere **diferenciar el par con osciloscopio sin aterrizar**, o un **gateway RS-232 aislado + tierra virtual a 18 V**. Niveles: **24 V = mark, 12 V = space**, sistema flotante. — README líneas 48-50. [Fuente](https://github.com/xssfox/aiphone-gt-tools)
- **HA thread (mediciones de usuarios)**: en el **options connector** de un GT-1M3-L, "Pin 3 and 4 … is **24v**" (Asphaug); señal de llamada en pines **azul/blanco a ~5 V** (HoneyBadger100); detección por ADC "if the voltage goes over 2v"; "very sensitive to current/voltage draws". Enfoques de hardware citados: relé HF49FD, zener 13 V para acondicionar señal de cámara, soldar a contactos de botón. — https://community.home-assistant.io/t/aiphone-intercom/160897
- **Confirmación indirecta del dato del tesista**: los ~20-24 V DC medidos entre R1/R2 coinciden con el "floating 24v" de xssfox y con los 24 V medidos en el options connector por usuarios HA. El nivel de reposo del bus es **mark ≈ 24 V**. [Fuente](https://github.com/xssfox/aiphone-gt-tools)

### Inferences
- No existe fuente pública con **oscilograma del timbre** del GT en R1/R2. La evidencia converge en que el timbre viaja como **paquete de datos RS-232 corto** y/o como **audio en el auricular**, no como cambio DC sostenido — lo que explica por qué el tesista no lo captó con multímetro DC ni con analizador lógico tras un divisor referenciado a tierra ajena.

### Gaps
- Falta una captura primaria (osciloscopio) del evento de timbre sobre R1/R2 en un sistema estándar GT-BC + GT-1D. Sería un aporte original genuino de la tesis (medición de campo no replicable de fuentes públicas).

---

## Resumen ejecutivo de veredictos

| Afirmación | Veredicto |
|---|---|
| GT-1D de fábrica tiene botones Door release, Guard station call/light, Option | **VERIFICADA** |
| Door release y light control solo funcionan durante comunicación con la entrada | **VERIFICADA** |
| Botón Guard = llamar conserjería (GT-MKB-N) + light control + toggle Doctor call | **VERIFICADA** |
| Existe ajuste de fábrica para que un botón abra un portón vehicular | **REFUTADA** (no documentado; solo vía cableado de instalador desde SW/CN4) |
| CN4 GT-1D 8 pines: SW,SW / RY,RY / CE,C / KE,K con esos colores | **VERIFICADA** |
| SW = salida de contacto opcional 24V/1A máx, 5V/0,1A mín | **VERIFICADA** |
| RY = notificación de llamada, se usa con GT-RY | **VERIFICADA** |
| CE/C = "door chime input" | **VERIFICADA con matiz**: es "Timbre", entrada N/O 12V para pulsador local |
| KE/K = alarma de emergencia, cortar JP1 | **VERIFICADA** (JP1=emergencia; ojo JP4=Doctor call) |
| Naturaleza eléctrica exacta de RY (voltaje/colector/contacto) | **NO VERIFICADA** por manual; comunidad mide ~5V en par azul/blanco |
| RJ9 GT-1D: Mic+, R−, R+, Mic− | **VERIFICADA** |
| intercom-project detecta ring por umbral acústico y abre con SwitchBots | **VERIFICADA** |
| Bus RS-232 9600 8E1, 24V=mark / 12V=space, flotante | **VERIFICADA** |
| Trama [to][from][cmd][params][checksum], longitud en 1er nibble | **VERIFICADA** |
| Opcodes 0x82/0x83, 0xb0, 0x24, 0x20/0x26, 0x70-0x74, 0xf1-0xf3 publicados | **VERIFICADA** (marcados WIP por el autor) |
| Algoritmo de checksum publicado | **VERIFICADA** (256 − Σbytes) |
| Audio analógico en R1/R2 durante llamada | **VERIFICADA** (R1/R2 = par audio/comms/power; "analógico" es inferencia razonable) |
| busserver/busserver_gw: root GT-1C7W, ptrace ps_gtl, UDP 4444/MQTT | **VERIFICADA** |
| GT-TLI-IP: 3 relés + 1 entrada de contacto, app, requiere llamada activa | **VERIFICADA** |
| Nombre "GT-DW" | **REFUTADA** (no existe; es GT-TLI-IP) |
| Disponibilidad GT-TLI-IP / GT-1C7W en Chile | **NO VERIFICADA** (sin evidencia local) |
