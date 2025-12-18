# Sistema de Códigos QR para Visitas

## 📋 Descripción General

Sistema completo de gestión de códigos QR para todas las visitas del condominio, con funcionalidad de descarga, compartir y visualización.

## 🎯 Características Implementadas

### 1. Generación Automática de QR
- **Todas las visitas** generan código QR automáticamente (vehiculares y peatonales)
- **Visitas vehiculares**: QR funciona como respaldo del sistema LPR
- **Visitas peatonales**: QR es el método principal de acceso

### 2. Componente QRCodeModal
**Ubicación**: `frontend/src/components/visits/QRCodeModal.tsx`

#### Características:
- ✅ Visualización de QR en alta calidad (256x256px)
- ✅ Información detallada de la visita
- ✅ Descarga como imagen PNG
- ✅ Compartir mediante Web Share API
- ✅ Fallback: Copiar código al portapapeles
- ✅ Diseño responsive y dark mode
- ✅ Indicador de uso vehicular (respaldo LPR)
- ✅ Contador de usos (si aplica)

#### Props:
```typescript
interface QRCodeModalProps {
  isOpen: boolean
  onClose: () => void
  visit: Visit | null
}
```

#### Funcionalidades del Modal:

##### **Descarga de QR**
- Convierte el SVG del QR a PNG
- Tamaño: 256x256px con margen
- Nombre del archivo: `visita-{id}-qr.png`
- Fondo blanco para mejor escaneo

##### **Compartir QR**
- Utiliza Web Share API (si está disponible)
- Comparte como imagen PNG
- Fallback: Copia el código al portapapeles
- Mensaje personalizado con nombre del visitante

##### **Información Mostrada**
- Nombre del visitante
- Tipo de visita (Vehicular/Peatonal)
- Detalles específicos:
  - Vehicular: Patente, marca y modelo
  - Peatonal: "Visita Peatonal"
- Contador de usos (si tiene límite)
- Código QR completo en texto

### 3. Integración en Tabla
**Ubicación**: `frontend/src/components/visits/VisitTable.tsx`

#### Botón de QR:
- Icono: `QrCodeIcon` de Heroicons
- Color: Azul (`text-blue-600`)
- Posición: Primera acción en la columna de acciones
- Tooltip: "Ver código QR"
- Condicional: Solo se muestra si la visita tiene QR

```tsx
{visit.qrCode && (
  <Button
    plain
    onClick={() => handleShowQR(visit)}
    aria-label="Ver código QR"
    title="Ver código QR"
    className="text-blue-600"
  >
    <QrCodeIcon className="w-4 h-4" />
  </Button>
)}
```

### 4. Modal Automático Post-Creación
**Ubicación**: `frontend/src/views/VisitsView.tsx`

#### Flujo:
1. Usuario crea una nueva visita
2. Backend genera y retorna el QR
3. Se cierra el diálogo de creación
4. **Se abre automáticamente** el modal de QR
5. Usuario puede descargar o compartir inmediatamente

#### Implementación:
```typescript
const handleCloseDialog = (createdVisit?: Visit) => {
  setIsDialogOpen(false)
  setSelectedVisit(undefined)
  
  // Si se creó una visita nueva, mostrar el QR
  if (createdVisit && createdVisit.qrCode) {
    setCreatedVisit(createdVisit)
    setQrModalOpen(true)
  }
}
```

## 📦 Dependencias

### Nuevas Librerías
```bash
npm install qrcode.react
```

#### qrcode.react
- **Versión**: ^4.x
- **Uso**: Generación de códigos QR en React
- **Componente**: `QRCodeSVG`
- **Configuración**:
  - `size={256}`: Tamaño del QR
  - `level="H"`: Máxima corrección de errores
  - `includeMargin={true}`: Margen blanco alrededor

### Heroicons
```typescript
import { QrCodeIcon } from '@heroicons/react/16/solid'
```

## 🎨 Diseño y UX

### Colores del Modal
- **Fondo primario**: Blanco / Zinc-800 (dark)
- **Fondo QR**: Blanco / Zinc-900 (dark)
- **Borde QR**: Zinc-200 / Zinc-700 (dark)
- **Botón Descargar**: Azul (blue-600)
- **Botón Compartir**: Verde esmeralda (emerald-600)
- **Info vehicular**: Azul claro (blue-50 / blue-900/20 dark)

### Iconografía
- 📱 QR Code (icono principal)
- ⬇️ Download (descargar)
- 🔄 Share (compartir)
- 💡 Info (respaldo LPR)

### Responsividad
- Modal: `max-w-md` (adaptable a pantallas pequeñas)
- QR centrado y con padding generoso
- Botones flex-1 para ocupar espacio equitativo
- Grid de información responsive

## 🔧 Uso Técnico

### Generar QR desde Backend
```typescript
// Backend ya genera automáticamente en visits.service.ts
private generateQRCode(): string {
  return `VISIT-${Date.now()}-${Math.random().toString(36).substring(7)}`
}

// Se llama para TODAS las visitas
visit.qrCode = this.generateQRCode()
```

### Mostrar Modal Programáticamente
```typescript
// Desde cualquier componente
const [qrModalOpen, setQrModalOpen] = useState(false)
const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)

const handleShowQR = (visit: Visit) => {
  setSelectedVisit(visit)
  setQrModalOpen(true)
}

// En JSX
<QRCodeModal
  isOpen={qrModalOpen}
  onClose={() => setQrModalOpen(false)}
  visit={selectedVisit}
/>
```

### Compartir en Diferentes Plataformas
El componente detecta automáticamente las capacidades del navegador:

1. **Web Share API disponible**: Muestra diálogo nativo de compartir
2. **Web Share API no disponible**: Copia al portapapeles y muestra alerta
3. **Usuario cancela**: No hace nada (AbortError ignorado)

## 📱 Casos de Uso

### Caso 1: Visita Peatonal Nueva
1. Admin crea visita peatonal
2. Modal de QR se abre automáticamente
3. Admin descarga QR y envía al visitante por WhatsApp
4. Visitante muestra QR en portería
5. Guardia escanea y registra entrada

### Caso 2: Visita Vehicular con Respaldo
1. Residente crea visita vehicular con patente
2. Modal de QR aparece (respaldo LPR)
3. Residente descarga QR "por si acaso"
4. Visitante llega en vehículo
5. **Escenario A**: LPR detecta patente → Acceso automático
6. **Escenario B**: LPR falla → Guardia escanea QR manualmente

### Caso 3: Visita con Múltiples Usos
1. Residente crea visita para trabajador (maxUses: 5)
2. Descarga QR y lo comparte
3. Trabajador ingresa 3 veces (usedCount: 3)
4. Residente verifica en tabla: "3 / 5 - 2 restantes"
5. Puede volver a abrir QR desde botón en tabla

### Caso 4: Compartir QR Rápidamente
1. Admin abre modal de QR de cualquier visita
2. Click en "Compartir"
3. Sistema muestra opciones del dispositivo:
   - WhatsApp
   - Email
   - SMS
   - Etc.
4. Selecciona y envía

## 🔐 Seguridad

### Generación de Códigos
- Formato: `VISIT-{timestamp}-{random}`
- Timestamp: Milisegundos desde epoch
- Random: 7 caracteres alfanuméricos
- Ejemplo: `VISIT-1730764800000-x7k9m2p`

### Validación
- Backend valida que el QR existe
- Backend verifica estado de la visita
- Backend valida fechas de validez
- Backend controla contador de usos

## 🚀 Mejoras Futuras

### Propuestas
1. **Escaneo QR**: Componente para que guardias escaneen con cámara
2. **Historial de Escaneos**: Registrar cada vez que se usa el QR
3. **QR Dinámicos**: Regenerar QR después de cada uso
4. **Notificaciones**: Avisar cuando se usa un QR
5. **Estadísticas**: Cuántos QR se descargan vs. cuántos se usan
6. **Personalización**: Logo del condominio en el QR
7. **Formato PDF**: Generar PDF con múltiples QRs
8. **Impresión Masiva**: Imprimir QRs para visitantes frecuentes

## 📊 Métricas

### Estadísticas Agregadas
- Total de visitas con QR: Mostrado en dashboard
- Visitas vehiculares con QR (respaldo): Separado en stats
- Visitas multi-uso: Contador dedicado

### Tracking Recomendado
- Cuántas veces se abre el modal de QR
- Cuántas descargas de QR se realizan
- Cuántas veces se usa "Compartir"
- Tasa de uso de QR vs. LPR (vehiculares)

## 🐛 Troubleshooting

### QR no se genera
- Verificar que backend esté generando el código
- Revisar que `visit.qrCode` no sea null/undefined
- Confirmar que el endpoint retorna la visita completa

### Modal no se abre
- Verificar estado `qrModalOpen`
- Confirmar que `visit` tiene datos
- Revisar console por errores de TypeScript

### Compartir no funciona
- Verificar que el navegador soporte Web Share API
- Confirmar que el sitio esté en HTTPS (requerido)
- Probar el fallback (copiar al portapapeles)

### Descarga no funciona
- Revisar permisos de descarga del navegador
- Verificar que el canvas se genera correctamente
- Confirmar que el SVG tiene ID `qr-code-svg`

## 📝 Notas de Desarrollo

### TypeScript
- Todas las props tipadas con interfaces
- Visit type actualizado con `qrCode: string`
- Manejo de null/undefined en todos los casos

### Accesibilidad
- Botones con `aria-label` descriptivos
- Tooltips con `title` attribute
- Contraste adecuado en dark mode
- Keyboard navigation soportada

### Performance
- QR se genera una sola vez (backend)
- SVG a PNG solo cuando se descarga/comparte
- Modal lazy loaded (solo se monta cuando isOpen)
- No hay re-renders innecesarios

## 📚 Referencias

- [qrcode.react docs](https://github.com/zpao/qrcode.react)
- [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- [Headless UI Dialog](https://headlessui.com/react/dialog)
