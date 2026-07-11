# 03 — Arquitectura objetivo

## Principio rector
**El backend es el único dueño del cerebro del agente** (prompt + definición de tools + orquestación del diálogo y del function-calling). El web y el hub pasan a ser **transportes delgados** (capturan y reproducen audio, muestran estado), sin lógica de agente. Una sola fuente de verdad, sin duplicación.

El agente no solo conversa: es **event-driven**. Reacciona a eventos (llegó una patente, sonó el citófono, hay una anomalía, un residente pidió algo) y decide acciones usando sus tools.

## Las 4 capas

```
┌──────────────────────────────────────────────────────────────────────┐
│  CEREBRO (cloud, backend NestJS)                                       │
│  Agente: prompt único + tools + orquestación + function-calling        │
│  Razona sobre eventos y decide acciones. Provider-agnóstico.           │
└───────────┬───────────────────────────────────────┬──────────────────┘
            │ tools = wrappers de los módulos        │ eventos entran
            ▼                                        ▼
┌──────────────────────────┐        ┌───────────────────────────────────┐
│  MANOS (módulos backend) │        │  EVENTOS                          │
│  visitas, vehículos,     │        │  detección de patente, anomalía,  │
│  residentes, portón,     │        │  llamada de citófono, petición    │
│  notificaciones, reportes│        │  de residente                     │
└──────────────────────────┘        └───────────────────────────────────┘
            ▲                                        ▲
            │ HubGateway (WS seguro)                 │
┌───────────┴────────────────────────┐   ┌───────────┴──────────────────┐
│  TRANSPORTE DE VOZ                  │   │  VISIÓN (edge o cloud)        │
│  - web: monitorear/intervenir      │   │  lpr/ : YOLO + OCR (patentes) │
│  - vigilia-hub: audio real del     │   │  + anomalías. Corre cerca de  │
│    citófono GT                      │   │  las cámaras, emite EVENTOS.  │
└─────────────────────────────────────┘   └──────────────────────────────┘
```

## El rol de `vigilia-hub` (dispositivo de punteo del citófono GT)
Es un dispositivo IoT que va **dentro** del sistema de citófono **Aiphone GT** e **intercepta la llamada antes de que llegue a la casa del residente**. Puentea:
- **Micrófono, altavoz y teclado** del citófono.
- **Decodifica las señales R1 y R2** del GT (para saber qué casa marcó el visitante e inyectar señales).

Con eso, el agente (en el backend) puede: atender la llamada, hablar con el visitante, **redirigir la llamada a la casa que el visitante marcó originalmente**, abrir portón/puerta, o cortar. El hub es el **transporte de audio + actuador físico**; la decisión la toma el cerebro en el backend, que le habla al hub por `HubGateway`.

> Nota: el manual `GT_System` (Aiphone) es de este citófono, NO de las cámaras.

## Cerebro vs transporte de voz
Separar dos cosas que hoy están mezcladas:
- **Cerebro / razonamiento + tools** → framework de agente provider-agnóstico en el backend (candidato: Vercel AI SDK + AI Gateway — ver [D1](05-decisiones-tecnicas.md#d1)).
- **Voz en tiempo real** (speech-to-speech de baja latencia con el visitante) → capa de transporte, posiblemente un modelo realtime dedicado. Decisión abierta ([D2](05-decisiones-tecnicas.md#d2)).

## Cloud vs Edge (eje central del SaaS)
Decisión que define el modelo de negocio ([D5](05-decisiones-tecnicas.md#d5)):
- **Cloud:** el cerebro (agente), la DB, la app web, el dashboard, la orquestación multi-condominio.
- **Edge (en el condominio):** el `vigilia-hub` (obligatorio, está en el hardware) y **probablemente la inferencia de visión** (LPR/anomalías) corriendo cerca de las cámaras, para no subir video crudo a la nube (ancho de banda, latencia, privacidad) y enviar solo **eventos**. El `lpr/` ya está diseñado como worker por-cámara, lo que encaja con edge.

## Multi-tenant (SaaS) — base fundacional
Para "vendible a varios condominios" se necesita **aislamiento por tenant** (condominio) en datos, auth y configuración. **Decidido** ([D4](05-decisiones-tecnicas.md#d4)): migrar a **better-auth** y hacerlo **Fase 0**, para que el agente-cerebro y todos los módulos nazcan **tenant-aware** en vez de retrofitear el aislamiento después. Se hace ahora que no hay datos que migrar.

## Qué se conserva del sistema actual
- `DigitalConciergeService` y su dispatcher `executeTool` → base del set de tools del agente.
- `HubGateway` → canal cerebro→hub para acciones físicas.
- `ConciergeSession(source, hubId)` → ya modela el origen multi-canal.
- Módulos de dominio (visitas, vehículos, notificaciones, detecciones) → se exponen como tools.
