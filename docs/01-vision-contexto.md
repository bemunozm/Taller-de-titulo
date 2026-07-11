# 01 — Visión y contexto

## Identificación
- **Título:** Conserje Digital Inteligente para Condominios mediante Visión Computacional e integración IoT.
- **Autores:** Amin Carrizo y Benjamin Muñoz. **Profesor guía:** Mauricio Oyarzun.
- **Tipo de tesis:** Emprendimiento (el sistema debe ser **reutilizable y vendible** a distintos condominios).
- **Piloto:** Condominio San Lorenzo (Región de Tarapacá — Iquique / Alto Hospicio).

## El problema
Muchos condominios de la región no tienen conserje ni portero, y la seguridad se limita a un sistema de cámaras y un portón, **sin monitoreo activo ni registro de visitas**. El control de acceso depende de la buena voluntad de los vecinos. Esto genera vacíos de gestión y riesgos de intrusión. El caso San Lorenzo es exactamente este.

## La solución: un agente conserje autónomo
No es "un sistema con LPR + citófono". Es **un agente de IA (el "conserje digital") que actúa como el cerebro del condominio**, y todo lo demás (cámaras, citófono, app) son sus **sentidos y manos**. El agente:
- Atiende las llamadas del citófono (habla con el visitante).
- Registra y gestiona visitas.
- Redirige la llamada a la casa correcta y coordina la autorización con el residente.
- Abre portón/puerta cuando corresponde.
- Razona sobre anomalías, accesos y eventos, y toma acciones.

Se apoya en la infraestructura **análoga/pasiva existente** (cámaras y citófono GT) mediante un dispositivo IoT de bajo costo (Raspberry) que la digitaliza.

## Objetivos de la tesis (criterios de evaluación)
1. Visión computacional: reconocimiento automático de **patentes** y, opcionalmente, **rostros**, con las cámaras existentes.
2. Dispositivo **IoT de bajo costo** para adaptar el citófono tradicional → apertura de portón + comunicación digital.
3. App **web/móvil** para residentes: registrar vehículos, programar visitas, notificaciones, autorizar accesos en tiempo real.
4. **Dashboard administrativo**: registro de accesos, reportes de visitas, gestión centralizada.
5. **Validar en piloto** con métricas: precisión de reconocimiento, tiempos de respuesta, satisfacción de usuarios.

## El diferenciador comercial
El LPR de patentes es *commodity*. Lo vendible y novedoso es **el agente conserje autónomo**: que atiende, decide, registra y coordina la seguridad de forma continua. Toda la inversión de aquí en adelante debe reforzar esa narrativa.

## Modelo de negocio 🔴 (pendiente)
Aún no definido. Dependerá del split **cloud vs edge** (qué corre en la nube y qué en el sitio, especialmente los modelos de IA que procesan las cámaras). Posibles ejes de cobro: por condominio, por casa, por cámara. Ver [05-decisiones-tecnicas.md](05-decisiones-tecnicas.md#d5).
