# Hardware de la placa de entrada Aiphone GT (GT-DB / GT-10K / GT-NSB / GT-BC / PS-24)

> Notas de investigación para intervención IoT (RPi/ESP32) en placa de entrada modular de condominio en Iquique/Alto Hospicio, Chile.
> Vigente a septiembre 2026. Se distingue explícitamente entre CITA TEXTUAL de manual/spec oficial e INFERENCIA.

## Fuentes primarias usadas (todas oficiales Aiphone salvo aviso)

- **[MI-ES]** *Manual de instalación SISTEMA GT — Sistema estándar y ampliado* (edición español, ref. `H P0822 RZ 65031`, fecha de emisión ago. 2022, AIPHONE CO., LTD., NAGOYA). Copia local en `gt_manual.txt` + páginas renderizadas `gt_pages/pagNN.png`. Original: https://www.aiphone.net/support/software-documents/download/gt/manual/en/GT_System_Standard_Expanded_%20System_%20Installation_Manual_EN.pdf (versión EN equivalente).
- **[OP]** *GT SYSTEM — Entrance/Guard Operation Manual* (EN): https://www.aiphone.com/wp-content/uploads/GT-Entrance-Guard-Operation-Manual.pdf (descargado y extraído a texto localmente; citas verbatim).
- **[P-10K]** Ficha producto oficial GT-10K: https://www.aiphone.com/products/gt-10k/
- **[P-NSB]** Ficha producto oficial GT-NSB: https://www.aiphone.com/products/gt-nsb/
- **[P-DB]** Ficha producto oficial GT-DB: https://www.aiphone.com/products/gt-db/ (data sheet: https://know.aiphone.com/en_US/modular-entrance-station-components/gt-db-data-sheet)
- **[GUIA-IA]** `INTERCEPTION_GUIDE.md` — documento interno escrito por IA, NO es fuente oficial y contiene errores conocidos. Se usa solo como pista y se marca como tal.

---

## KQ1 — GT-10K: ¿matriz pasiva sin electrónica/alimentación? ¿9P a GT-NSB (no a GT-DB)? ¿pinout fila/columna?

### Takeaway
El 9P a la GT-NSB está **VERIFICADO** por diagrama de manual; el GT-10K se alimenta desde el GT-DB (a través de la cadena de módulos) y sólo trae un cable plano — coherente con módulo pasivo, pero "matriz pasiva sin electrónica" NO está afirmado literalmente por Aiphone. El **pinout fila/columna del 9P NO está verificado en ninguna fuente oficial**.

### Cited Findings
- **VERIFICADO — cable 9P entre GT-NSB y GT-10K.** En el diagrama de cableado de placa de entrada modular, el conector `CN100` de la GT-NSB se une por cable **`9P`** al conector `CN100` del GT-10K (única conexión del GT-10K). En el texto extraído de la página 35 aparecen los tramos `9P 9P` justo entre los rótulos `GT-NSB` y `GT-10K`, y el diagrama muestra la flecha 9P NSB(CN100)→10K(CN100). — [MI-ES pág. 35–36; `gt_pages/pag35.png`]
- **VERIFICADO — el GT-10K NO se conecta al GT-DB directamente; va a la GT-NSB.** La ficha oficial dice: *"10-keypad module for use in conjunction with GT-NSB"* y *"Ribbon cable provided"*. — [P-10K]
- **VERIFICADO — alimentación del GT-10K.** Ficha oficial: **Power Source = *"Supplied from GT-DB, GT-DB-V, or GT-DB-VN"***. Es decir, la energía llega desde el módulo de audio a través de la cadena de cables planos (DB→NSB→10K), no por una línea propia. — [P-10K]
- **VERIFICADO — el GT-10K sólo tiene teclas 0–9, *, #, sin botón de llamada ni indicadores.** El manual de operación lista el módulo como *"10 key module GT-10K — 10-key (0 to 9, , #)"* (sin LEDs ni botón Call propios). — [OP, sección 1-1]
- **VERIFICADO — otros datos GT-10K:** IP43; dimensiones 90 mm H x 106 mm W x 38 mm D; *"Mounts using bracket supplied with GF-2F, GF-3F, or GT-4F"*. — [P-10K]
- **NO VERIFICADO — "matriz pasiva de membrana sin electrónica activa".** Ninguna fuente oficial (manual ni ficha) afirma que el GT-10K sea una matriz pasiva ni describe su esquema interno. La única fuente que lo afirma es [GUIA-IA] (doc IA, no confiable), que además reconoce que debe verificarse empíricamente con multímetro en terreno.
- **NO VERIFICADO — pinout fila/columna del cable 9P.** No hay fuente oficial que tabule qué pines del 9P son filas y columnas. [GUIA-IA] plantea una hipótesis de 4 filas × 3 columnas (7 pines usados + 2 restantes = backlight/GND) pero es especulación a comprobar en terreno, no dato de manual.

### Inferences
- Que el GT-10K "se alimente desde el GT-DB" y tenga un solo conector plano hacia la GT-NSB es **consistente** con un módulo de entrada tonto (matriz de teclas escaneada por la GT-NSB, que sí tiene MCU y pantalla), pero es inferencia, no cita.
- La afirmación del brief "9P a la GT-NSB (no al GT-DB)" queda **confirmada**; el matiz es que la energía sí proviene del GT-DB, solo que enrutada vía GT-NSB. Nótese que la ficha [P-NSB] dice que la **GT-NSB** *"Connects to GT-DB with supplied ribbon cable"* — ese es el enlace NSB↔DB (distinto cable), no el 9P del 10K.

### Gaps
- Pinout exacto del 9P (filas/columnas, backlight/GND) y confirmación de que es matriz pasiva: **solo verificable con multímetro en continuidad sobre la unidad física** (procedimiento en [GUIA-IA] §4, no oficial). No existe hoja de instrucciones GT-10K pública con esquema de pines.

---

## KQ2 — ¿Dónde está el botón CALL y cómo llama el visitante por número vs por nombre?

### Takeaway
**VERIFICADO:** el botón **Call (Llamar)** está en la **GT-NSB**, no en el GT-10K ni en el GT-DB. La GT-NSB tiene 4 botones: Back search, Forward search, Call, Cancel. Se marca en el GT-10K y se confirma con **Call de la GT-NSB**.

### Cited Findings
- **VERIFICADO — botones de la GT-NSB (cita textual).** El manual de operación describe: *"Name scrolling module GT-NSB — Display; **Back search button** (or move the cursor to the left); **Forward search button** (or move the cursor to the right); **Call button** (or set and move forward); **Cancel button** (or back)"*. — [OP, sección 1-1]
- **VERIFICADO — llamar por número (10-key + Call).** *"Searching for a unit by entering the unit #: 1 In standby mode, enter the numbers using [0] to [9] on the 10-key to display the target unit # and resident name. 2 When the target unit # and resident name is displayed, press [Call]. The call indicator will light up and you will hear a call tone."* Si no existe la unidad, muestra *"NO ENTRY"*; si está ocupada, enciende el *IN USE LED*. — [OP, sección 2-1 "Calling with the 10 key module"]
- **VERIFICADO — llamar por nombre (scroll o letras).** *"Calling with the name scrolling module: 1 In standby mode, press [back/forward search] to display the target unit # and resident name. 2 Press [Call]."* También: *"In standby mode, press [ ] on the 10-key… enter a letter using the 10-key to display the target unit # and resident name"* (modo letras). El 10-key alterna modo número/letra pulsando la tecla de conmutación. — [OP, sección 2-1]
- **VERIFICADO — GT-SW (selección directa) tiene su propio botón.** El módulo GT-SW se describe como *"Call switch module GT-SW — Call button, Directory card"* (llamada directa a una unidad por botón). — [OP, sección 1-1]

### Inferences
- Para el hub Vigilia: capturar el dígito marcado requiere leer el GT-10K/9P (o la pantalla), pero **el evento de "llamada emitida" lo dispara el botón Call físico en la GT-NSB**, no el 10K. Interceptar "se emitió llamada" implica sensar la GT-NSB o el bus R1/R2, no solo el teclado. Esto coincide con lo que [GUIA-IA] admite en su §8 ("El botón Llamar está en el GT-NSB, no en la matriz del GT-10K").

### Gaps
- Qué pin/traza concreta del cable NSB↔DB o del CN1 de la GT-NSB conmuta al presionar Call: no documentado; requiere osciloscopio/continuidad en terreno.

---

## KQ3 — Interconexión GT-NSB / GT-10K / GT-SW-GT-AD / GT-DB (CN1..CN4, 5P/6P/9P). ¿La info de dígito/dirección va NSB→DB por cable local (analógico o digital)?

### Takeaway
Interconexión de conectores y cables planos **VERIFICADA** por el diagrama del manual (§4-3). Si la información de dígito/dirección viaja NSB→DB de forma analógica o digital **NO está documentado** (el manual no describe la naturaleza de esa señal); es un enlace serie/digital interno por inferencia.

### Cited Findings
- **VERIFICADO — conectores por módulo (diagrama §4-3, tipo modular):**
  - **GT-DB (módulo de audio):** conectores `CN1`, `CN2`, `CN3` (CN3 va al GT-RY / módulo de bucle magnético, con hilos rotulados `RY RY GND D D SP SP`), `SW2`, `SW3`, `USB`, y bloque de terminales **`R1 R2 BP BP ELB ELC ELM`**. — [MI-ES pág. 35; `pag35.png`]
  - **GT-VB (módulo cámara):** `A1 A2`, `CN1`, `CN2`, `SW1`. — [MI-ES pág. 35]
  - **GT-SW / GT-AD:** `CN1`, `CN2`, `CN3`, `CN4`. — [MI-ES pág. 35–36]
  - **GT-NSB:** `CN1`, `CN11`, `CN100`, y un conector `+ / -` (alimentación). — [MI-ES pág. 35]
  - **GT-10K:** sólo `CN100`. — [MI-ES pág. 35]
- **VERIFICADO — cables planos entre módulos:** el diagrama muestra tramos **`5P`**, **`6P`** y **`9P`** conectando los módulos en cadena: p. ej. `5P`/`6P` entre GT-DB↔GT-SW/GT-AD y GT-DB/GT-VB↔GT-NSB; **`9P` entre GT-NSB (CN100) y GT-10K (CN100)**. — [MI-ES pág. 35–36; `pag35.png`, `pag36.png`]
- **VERIFICADO — la GT-NSB se conecta al GT-DB por cable plano.** Ficha oficial: la GT-NSB *"Connects to GT-DB with supplied ribbon cable—use Aiphone #872002 or #871802 for power"*. — [P-NSB]
- **VERIFICADO — orden de montaje/cableado entre módulos.** *"Inserte el conector adjunto al enchufe desde el módulo de audio hasta el módulo siguiente"* y *"conecte CN1 de GT-SW a la fila siguiente"* (los módulos se encadenan con los cables planos incluidos). — [MI-ES pág. 23]
- **NO VERIFICADO — naturaleza analógica vs digital del enlace NSB→DB.** El manual no describe qué señal (analógica/serie/paralela) lleva el cable NSB↔DB ni cómo se transfiere el dígito/dirección marcado. Es información no publicada.

### Inferences
- Topología funcional (inferida): **GT-10K (teclas) → 9P → GT-NSB (MCU + pantalla, decide unidad y muestra) → cable plano → GT-DB (módulo con la conexión al bus R1/R2, USB de programación, DIP de ID) → bus R1/R2 → GT-BC**. El GT-DB es el "módulo maestro" de la placa (tiene los terminales de bus, la programación USB, VR1 y los DIP de dirección de placa); GT-NSB/GT-10K son periféricos de entrada. Coherente con [P-10K] "powered from GT-DB" y con que sólo el GT-DB tiene R1/R2.
- Muy probablemente el enlace NSB→DB es **digital/serie interno** (patrón universal en placas modulares con MCU), pero es inferencia, no cita de manual.

### Gaps
- Mapa de pines de CN1/CN11 (GT-NSB) y CN1/CN2 (GT-DB) y protocolo del cable plano interno: no publicado.

---

## KQ4 — Micrófono y altavoz del GT-DB: ¿transductores analógicos discretos cableados localmente o integrados en PCB? ¿spec (impedancia, electret)?

### Takeaway
**VERIFICADO** que el GT-DB **integra micrófono y altavoz como partes del propio módulo** (no hay conector/borne de audio local expuesto para conectarlos aparte). Las **especificaciones eléctricas del transductor (impedancia, tipo electret, potencia) NO están publicadas por Aiphone** → NO VERIFICADO.

### Cited Findings
- **VERIFICADO — el GT-DB tiene micrófono y altavoz integrados (partes del módulo).** El manual de operación, al despiezar el módulo de audio, lista entre sus partes: *"Microphone … IN USE LED (orange) … Call indicator (orange) … Talk indicator (orange) … Door release indicator (green) … NFC reader … Speaker"*. Es decir, mic y altavoz son componentes internos del GT-DB, no accesorios cableados. — [OP, sección 1-1]
- **VERIFICADO (parcial) — spec publicada del GT-DB (ficha oficial):** *Power Source = "Supplied by system"*; *Door Release = "Form C dry contact, 24V AC/DC, 4A"*; *Material = "Fire resistant ABS plastic"*; *Wire Type = "2-cond., solid, non-shielded PE insulation"*; Dimensiones = 93 mm H x 108 mm W x 38.5 mm D. **No aparece impedancia de altavoz, potencia ni tipo de micrófono.** — [P-DB]
- **NOTA de fuente secundaria (no oficial):** distribuidores describen genéricamente *"Audio Output: High-definition"* sin dar impedancia/tipo — sin valor técnico. — surveillance-video.com/audio-gt-db.html
- **AFIRMACIÓN DE [GUIA-IA] a tratar con cautela:** el doc IA asume "micrófono y parlante integrados" y propone "reutilizarlos" pinchando el bus R1/R2. La integración es correcta; pero la premisa de que el audio se puede tomar limpiamente de R1/R2 es una inferencia de la propia IA, no un dato de Aiphone.

### Inferences
- Al ser transductores **integrados en el PCB del GT-DB**, no hay un par de cables mic/altavoz accesible para intervención directa: para capturar/inyectar audio habría que (a) pinchar el bus R1/R2 (analógico+señalización propietaria, no trivial), o (b) micro-soldar en el PCB del GT-DB (invasivo, anula garantía). Ninguna opción es "plug-and-play" segun la evidencia.

### Gaps
- Impedancia del altavoz, potencia, y si el micrófono es electret o MEMS: **no publicado por Aiphone**. Sólo obtenible por medición/desarmado físico (invasivo).

---

## KQ5 — Terminal BP (botón abrepuertas externo): ¿N/O, detección ≥100 ms, cerrado ≤1 kΩ, abierto ≥50 kΩ, corriente cortocircuito ≤10 mA, voltaje abierto ≤3,3 V CC?

### Takeaway
**VERIFICADO al 100%, cita textual del manual.** BP = entrada de "Botón abrepuertas externo (producto de terceros)" con exactamente esas especificaciones.

### Cited Findings
- **VERIFICADO — especificación de entrada BP (cita textual, aparece idéntica en 3 páginas):**
  *"(*3): Especificaciones de entrada — Método de entrada: **Contacto N/O (normalmente abierto)**; Tiempo de detección de confirmación: **100 ms o más**; Resistencia de contacto cerrada: **1 kΩ o menos**; Resistencia de contacto abierta: **50 kΩ o más**; Terminal de corriente de cortocircuito: **10 mA o menos**; Circuito de voltaje abierto entre terminales: **3,3 V CC o menos**"*. — [MI-ES pág. 35 (modular video/audio), pág. 36 (modular solo audio), pág. 37 (monobloque)]
- **VERIFICADO — hay dos terminales rotulados `BP BP`** (par de contacto) en el bloque del GT-DB. — [MI-ES pág. 35–37; `pag35.png`]
- **VERIFICADO — distancia de cableado del botón:** *"[13] Placa de entrada - botón abrepuertas externo: 10 m / 15 m / 15 m"* (según diámetro de cable 0,65/0,8/1,0 mm). — [MI-ES pág. 12]

### Inferences
- Un contacto seco N/O (relé mecánico/reed) desde RPi/ESP32 cumple holgadamente estas specs (cerrado ≤1 kΩ, abierto ≥50 kΩ). El bajísimo voltaje (≤3,3 V CC) y corriente (≤10 mA) confirman que es una entrada lógica segura para GPIO vía optoacoplador o relé; **cerrar BP ≈ pulsar el botón abrepuertas** → libera la cerradura de ESA placa (ELM/ELC/ELB). Coincide con [GUIA-IA] §1.

### Gaps
- Ninguno relevante para BP; totalmente documentado.

---

## KQ6 — ELM/ELC (N/O) y ELB/ELC (N/C) = contacto de abrepuertas, <24 V 4 A CA/CC resistiva. ¿VR1 fija el tiempo (instantáneo / 0,5–20 s)?

### Takeaway
**VERIFICADO al 100%, cita textual.** ELM/ELC = N/O, ELB/ELC = N/C, <24 V 4 A CA/CC (carga resistiva). VR1 fija duración M (instantáneo)/0,5–20 s, default M.

### Cited Findings
- **VERIFICADO — contacto de abrepuertas (cita textual):** *"(*1): N/C (Normalmente cerrado) [ELB, ELC]; N/O (Normalmente abierto) [ELM, ELC]; Menos de 24 V, 4 A de CA/CC (carga resistiva)"*. — [MI-ES pág. 35, 36, 37]
- **VERIFICADO — es un contacto seco Form C.** Ficha oficial GT-DB: *Door Release = "Form C dry contact, 24V AC/DC, 4A"* (Form C = común + N/O + N/C, consistente con ELC común, ELM=N/O, ELB=N/C). — [P-DB]
- **VERIFICADO — VR1 (cita textual):** *"1 Potenciómetro VR1 (dentro de la cubierta) — Función: Establece el tiempo de duración del abrepuertas. Rango de ajuste: M (instantáneo)/0,5-20 segundos. Por defecto: M (instantáneo)"*. — [MI-ES pág. 51]
- **VERIFICADO — terminales del GT-DB (bloque completo, monobloque):** en el diagrama del monobloque el bloque de bornes es *"A1 A2 ELM ELC ELB R1 R2 BP BP"*. — [MI-ES pág. 37]

### Inferences
- ELC es el **común** del relé de cerradura; ELM (N/O) se cierra al liberar; ELB (N/C) se abre al liberar. Para una cerradura tipo *fail-secure* se usa ELM/ELC; para *fail-safe* (magnética) se usa ELB/ELC. El hub puede leer el estado de apertura sensando este contacto, o accionar la cerradura vía BP (recomendado) sin tocar el relé interno.

### Gaps
- Ninguno; documentado.

---

## KQ7 — Funciones del DIP switch SW2 del GT-DB (incl. SW2-5 "monitoreo permitido")

### Takeaway
**VERIFICADO, cita textual pág. 51.** SW2-5 = habilita que la placa sea monitorizada por conserje/vivienda (default OFF).

### Cited Findings
- **VERIFICADO — tabla SW2 del módulo de audio GT-DB (cita textual, pág. 51):**
  - **SW2-1:** *"Establece esta placa de entrada para su uso bien en un sistema múltiple o en un sistema individual. ON: Sistema múltiple / OFF: Sistema individual"* — default **OFF**.
  - **SW2-2 a 4:** *"Establece la ID de esta placa de entrada"* (combinación binaria → ID 1..8, o 9..16 en línea común 2 del GT-BCXB-N) — default 2:OFF 3:OFF 4:OFF (ID 1).
  - **SW2-5:** *"Establece la capacidad de esta placa de entrada para ser monitorizada por el conserje o el intercomunicador principal vivienda. ON: Permitido / OFF: No permitido"* — default **OFF**.
  - **SW2-6:** *"Este ajuste es necesario solamente en Francia. Ajuste el método de transmisión para VIGIK. ON: Versión del HEXACT® / OFF: Versión del AIPHONE"* — default OFF.
  - **SW2-8:** *"Restablece el código de acceso para el instalador o el administrador cuando esta unidad se inicia mediante el ajuste de este interruptor en ON"* — default OFF.
  — [MI-ES pág. 51]
- **VERIFICADO — SW3 (mismo módulo):** *"SW3-2 a 4: Establece el idioma de la guía de audio"* (francés/español/noruego/inglés/alemán/holandés/tono). — [MI-ES pág. 51]
- **VERIFICADO — USB e interruptor de programa:** *"Terminal USB e interruptor del programa — Se utiliza para el ajuste solamente. (Consulte el Manual de ajuste SISTEMA GT…)"* y nota *": No cambie estos interruptores"*. — [MI-ES pág. 51]

### Inferences
- SW2-5 ("monitoreo permitido") es relevante si el hub quiere que la conserjería digital pueda auto-monitorear la cámara/audio de la placa; para el flujo QR de Vigilia probablemente no se necesita cambiarlo.
- (Nota: en el texto del manual la fila "7" de SW2 no aparece listada; sólo se documentan 1–6 y 8. No confundir con SW2 de otros equipos GT-1C7/GT-2C, que tienen tablas distintas.)

### Gaps
- SW2-7 del GT-DB no aparece descrito en la tabla (posible reservado); no documentado.

---

## KQ8 — ¿El GT-DB se alimenta por R1/R2 desde el GT-BC (cortar R1/R2 desactivaría la placa)?

### Takeaway
**VERIFICADO por inferencia fuerte convergente:** el GT-DB (y por cadena toda la placa) se alimenta y comunica por los **dos únicos terminales de bus R1/R2**, que van al GT-BC (vía DP). No hay otro borne de alimentación en el GT-DB modular. Cortar R1/R2 deja la placa sin bus ni energía.

### Cited Findings
- **VERIFICADO — R1/R2 son los únicos terminales de bus del GT-DB.** En la tabla de comprobación de "fallo a tierra", los terminales a inspeccionar del *"GT-DB (-V, -VN)"* son exclusivamente **`[R1]` y `[R2]`** (el monobloque GT-DMB agrega A1/A2 por el video). — [MI-ES pág. 56]
- **VERIFICADO — R1/R2 es la línea de audio/bus hacia el GT-BC.** En el diagrama §4-3 el par R1/R2 del GT-DB baja al **DP** y de ahí al **GT-BC** (línea de señal de audio, "NP = No polarizado"). La `PS24` alimenta al GT-BC. — [MI-ES pág. 35–37]
- **VERIFICADO — el GT-DB no declara fuente propia.** Ficha oficial GT-DB: *Power Source = "Supplied by system"* (no tiene entrada de alimentación dedicada; la recibe del sistema por el bus). — [P-DB]
- **VERIFICADO — "1 GT-BC requerido".** El GT-BC (Unidad de control de bus) es obligatorio: *"Unidad de control de bus (GT-BC): 1 requerido"*. — [MI-ES pág. 4]
- **VERIFICADO — distancia total del sistema de audio se mide sobre [R1, R2].** *"Distancia de cableado total del sistema de audio estándar [R1, R2]… 2.500 m"*. — [MI-ES pág. 12]

### Inferences
- Dado que el GT-DB no tiene borne de alimentación separado y su único enlace de bus es R1/R2, **la alimentación y la señalización de la placa llegan por R1/R2 desde el GT-BC** (el GT-BC a su vez se alimenta de la PS-24 24 V CC). Por tanto **cortar/abrir R1/R2 deja la placa muerta** (sin poder llamar). Esto habilita, para el hub, la idea de un relé de aislamiento en serie con R1/R2 (como propone [GUIA-IA]) — pero implica cortar el bus a todos los residentes, no sólo "desconectar la placa".
- Matiz importante: R1/R2 es un **bus propietario de 2 hilos** que mezcla energía + señalización (probablemente digital) + audio. Interceptarlo NO es trivial ni "plug-and-play"; su protocolo no está en el manual (ver KQ9/gaps).

### Gaps
- Tensión exacta y forma de onda en R1/R2 (idle/llamada/conversación) y el protocolo de señalización: **no documentados por Aiphone**; requieren medición en terreno (multímetro/osciloscopio). El proyecto no-oficial `xssfox/aiphone-gt-tools` reporta bus tipo RS-232 9600 8E1 sobre R1/R2 con opcodes, pero eso aplica a rootear un GT-1C7W como gateway, no al GT-DB (ver memoria previa del researcher).

---

## KQ9 — Declaración oficial sobre dispositivos de terceros, garantía y configuración solo-instalador (GT Setup Tool / USB)

### Takeaway
**VERIFICADO:** Aiphone (a) prohíbe desmontar/modificar la estación, (b) la garantía **excluye** funciones añadidas por terceros y daños por alteración fuera de fábrica o uso distinto a las instrucciones, y (c) la configuración se hace con la *Herramienta de configuración Aiphone GT* (Windows) por USB — herramienta de puesta en marcha del instalador.

### Cited Findings
- **VERIFICADO — prohibición de modificar (Advertencia):** *"No desmonte ni modifique la estación. Podría provocar un incendio o una descarga eléctrica."* — [MI-ES pág. 2, sección ADVERTENCIA]
- **VERIFICADO — exclusiones de garantía (cita textual):** *"Esta garantía no se aplicará a ningún producto Aiphone que haya sido sometido a maltrato, negligencia, accidente, sobrecarga de energía o que haya sido usado de manera diferente a las instrucciones proporcionadas, ni a unidades que hayan sido reparadas o alteradas fuera de fábrica. … Esta garantía no cubre ninguna función adicional de un producto de terceros que haya sido añadido por los usuarios o proveedores. Tenga en cuenta que los daños u otros problemas causados por un fallo de funcionamiento o por la interconexión con los productos de Aiphone tampoco están cubiertos por la garantía."* — [MI-ES pág. 58, GARANTÍA]
- **VERIFICADO — garantía limitada a specs estándar del manual:** *"Esta garantía se limita a las especificaciones estándar indicadas en el manual de funcionamiento."* — [MI-ES pág. 58]
- **VERIFICADO — conexión de terceros SÍ prevista en ciertos bornes.** El propio manual contempla conectar productos de terceros en puntos definidos: *"Botón abrepuertas externo (producto de terceros)"*, *"Abrepuertas (producto de terceros)"*, *"Cámara de vigilancia (producto de terceros, NTSC 75 Ω)"*, *"PC (producto de terceros)"*. Es decir, hay interfaces oficiales para terceros (BP, ELM/ELC/ELB, salida de video), distintas de "modificar" el equipo. — [MI-ES pág. 35–37]
- **VERIFICADO — herramienta de configuración por USB (instalador):** el manual lista entre la documentación la *"Herramienta de configuración de Aiphone GT para Windows"* y el *"Cable USB Tipo A-Micro B (1 m)"* incluido con el GT-DB; el terminal USB *"Se utiliza para el ajuste solamente"* (remite al *Manual de ajuste*). El código de acceso de instalador/administrador se resetea con SW2-8. — [MI-ES pág. 1, 14, 51]

### Inferences
- **Punto de diseño clave para Vigilia:** conectar el hub a las **interfaces oficiales de terceros** (contacto BP para abrir, y contacto seco de portón externo) es "uso previsto" y NO constituye "modificar la estación". En cambio, **pinchar el bus R1/R2, leer el 9P internamente o soldar en el PCB del GT-DB** caen en "alteración/interconexión" que la garantía **no cubre** y que la Advertencia desaconseja. Esto refuerza estratégicamente la alternativa "kiosko QR / periférico junto a la placa usando BP" frente a "intervención invasiva del bus".
- No se halló ninguna cláusula que **prohíba legalmente** a un tercero conectar equipos; la restricción es de **garantía y seguridad**, no una prohibición contractual de integración.

### Gaps
- No se encontró un documento Aiphone que declare explícitamente "no se permiten dispositivos de terceros en el bus" (más allá de la exclusión de garantía). El *GT Setting Manual* (https://www.aiphone.net/support/software-documents/download/gt/manual/en/GT_System_Standard_Expanded_System_Setting_manual_EN.pdf) podría detallar restricciones del GT Setup Tool; no se extrajo su texto en esta ronda.

---

## Datos adicionales relevantes para interceptar la placa (resumen consolidado)

- **Bloque de terminales del GT-DB (verbatim, monobloque pág. 37):** `A1 A2 ELM ELC ELB R1 R2 BP BP`. En modular (pág. 35) el GT-DB expone `R1 R2 BP BP ELB ELC ELM` + `CN1 CN2 CN3` + `USB` + `SW2 SW3`. [MI-ES pág. 35, 37]
- **Colores de cable del conector CN3/GT-RY del GT-DB (verbatim pág. 35):** Marrón, Rojo, Naranja, Amarillo, Verde, Azul, Morado (asociados a `RY RY GND D D SP SP`). [MI-ES pág. 35]
- **Conector para contactos opcionales del GT-DB:** de **7 pines** (incluido con el módulo de audio), más **cable USB A–Micro B (1 m)**. El GT-VB (cámara) trae conector opcional de **2 pines**. [MI-ES pág. 14]
- **Salida de contacto opcional (contexto, en estaciones de vivienda, no en GT-DB):** *"Especificaciones de contacto: Carga máxima CA/CC 24 V, 1 A; Carga mínima CC 5 V, 0,1 A"*; y entradas seguridad/utilidad: N/O o N/C, detección ≥100 ms, N/O ≤1 kΩ / N/C ≥50 kΩ, corriente ≤1 mA, ≤3,3 V CC. [MI-ES pág. 50] — útil como referencia de niveles lógicos Aiphone.
- **GT-RY (relé de señalización externo):** *"CA/CC 24 V, 0,5 A"*, sólo para notificación (zumbador/monitor externo durante llamada), NO es relé de comando de apertura. [MI-ES pág. 50]
- **Alimentación del sistema:** familia **PS-24** (PS-2420 / PS-2420S / PS-2420UL / PS-2420BF / PS-2420DM) = fuente 24 V CC que alimenta al GT-BC. [MI-ES pág. 4–5]
- **Distancias de cableado clave:** GT-BC–DP 3–5 m; Placa de entrada–DP 150–300 m; Placa–botón abrepuertas externo 10–15 m; distancia total sistema audio [R1,R2] 1.650–2.500 m. [MI-ES pág. 12]
- **Dimensiones de módulos (fichas oficiales):** GT-DB 93×108×38,5 mm; GT-NSB 88,3×104,6×38,5 mm; GT-10K 90×106×38 mm. [P-DB, P-NSB, P-10K]
- **GT-NSB:** pantalla 3,5″; *"3.5″ screen displays a custom greeting message, tenant directory, and system status"*; alimentación *"DC 24V Supplied from a power supply unit (PS-2420 etc.)"*. [P-NSB]

## Advertencias sobre fuentes
- El documento interno `INTERCEPTION_GUIDE.md` (IA) es **coherente con el manual** en lo verificable (BP, ELM/ELC/ELB, SW2, VR1, 9P NSB↔10K, mic/altavoz integrados, botón Call en NSB), pero sus secciones de **protocolo del bus R1/R2 (25 kHz, 3ms/6ms, 18 bits, inyección de ACK)** están **explícitamente marcadas por el propio documento como suposiciones extrapoladas de Comelit/TCS, NO confirmadas** — tratar como hipótesis, no como hecho.
- Aiphone **no publica** specs de transductores (impedancia/electret) ni el pinout del 9P ni el protocolo de R1/R2: estos son los tres vacíos que sólo se cierran con medición física en terreno.
