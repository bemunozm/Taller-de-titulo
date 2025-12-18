# Ejemplos de Uso del Módulo de Visitas

## Configuración Base

```bash
# Base URL
BASE_URL=http://localhost:3000/api
TOKEN=tu-token-jwt-aqui
```

## 1. Crear Visita Vehicular

```bash
curl -X POST ${BASE_URL}/visits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "type": "vehicular",
    "visitorName": "Juan Pérez García",
    "visitorRut": "18.234.567-8",
    "visitorPhone": "+56912345678",
    "reason": "Visita familiar - Almuerzo",
    "validFrom": "2025-11-05T12:00:00-03:00",
    "validUntil": "2025-11-05T18:00:00-03:00",
    "hostId": "UUID_DEL_RESIDENTE",
    "familyId": "UUID_DE_LA_FAMILIA",
    "vehiclePlate": "BBXY78",
    "vehicleBrand": "Toyota",
    "vehicleModel": "Corolla 2020",
    "vehicleColor": "Gris"
  }'
```

## 2. Crear Visita Peatonal (Delivery)

```bash
curl -X POST ${BASE_URL}/visits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "type": "pedestrian",
    "visitorName": "Repartidor Uber Eats",
    "visitorPhone": "+56987654321",
    "reason": "Entrega de comida",
    "validFrom": "2025-11-04T19:30:00-03:00",
    "validUntil": "2025-11-04T20:30:00-03:00",
    "hostId": "UUID_DEL_RESIDENTE"
  }'
```

## 3. Crear Visita Técnico o Servicio

```bash
curl -X POST ${BASE_URL}/visits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "type": "vehicular",
    "visitorName": "Técnico VTR - Pedro Silva",
    "visitorPhone": "+56922334455",
    "reason": "Revisión de internet",
    "validFrom": "2025-11-06T14:00:00-03:00",
    "validUntil": "2025-11-06T17:00:00-03:00",
    "hostId": "UUID_DEL_RESIDENTE",
    "vehiclePlate": "VTR456",
    "vehicleBrand": "Chevrolet",
    "vehicleModel": "N300",
    "vehicleColor": "Blanco"
  }'
```

## 4. Listar Todas las Visitas Activas

```bash
curl -X GET "${BASE_URL}/visits/active" \
  -H "Authorization: Bearer ${TOKEN}"
```

## 5. Listar Visitas Pendientes

```bash
curl -X GET "${BASE_URL}/visits/pending" \
  -H "Authorization: Bearer ${TOKEN}"
```

## 6. Filtrar Visitas por Estado y Tipo

```bash
# Visitas vehiculares activas
curl -X GET "${BASE_URL}/visits?status=active&type=vehicular" \
  -H "Authorization: Bearer ${TOKEN}"

# Visitas peatonales completadas
curl -X GET "${BASE_URL}/visits?status=completed&type=pedestrian" \
  -H "Authorization: Bearer ${TOKEN}"

# Todas las visitas de un residente
curl -X GET "${BASE_URL}/visits?hostId=UUID_DEL_RESIDENTE" \
  -H "Authorization: Bearer ${TOKEN}"
```

## 7. Validar Acceso por Patente (Caso IA)

```bash
# Este endpoint lo usaría el sistema de IA cuando detecta una patente
curl -X POST ${BASE_URL}/visits/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "identifier": "BBXY78",
    "type": "plate"
  }'
```

Respuesta esperada:
```json
{
  "valid": true,
  "visit": {
    "id": "uuid-visita",
    "type": "vehicular",
    "status": "pending",
    "visitorName": "Juan Pérez García",
    "validFrom": "2025-11-05T12:00:00.000Z",
    "validUntil": "2025-11-05T18:00:00.000Z",
    "vehicle": {
      "plate": "BBXY78",
      "brand": "Toyota",
      "model": "Corolla 2020"
    }
  },
  "message": "Acceso autorizado"
}
```

## 8. Validar Acceso por QR (Caso Conserje)

```bash
curl -X POST ${BASE_URL}/visits/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "identifier": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "type": "qr"
  }'
```

## 9. Registrar Entrada (Check-in)

```bash
# Cuando la visita llega y se valida el acceso
curl -X POST ${BASE_URL}/visits/UUID_VISITA/check-in \
  -H "Authorization: Bearer ${TOKEN}"
```

## 10. Registrar Salida (Check-out)

```bash
# Cuando la visita se retira
curl -X POST ${BASE_URL}/visits/UUID_VISITA/check-out \
  -H "Authorization: Bearer ${TOKEN}"
```

## 11. Cancelar Visita

```bash
curl -X POST ${BASE_URL}/visits/UUID_VISITA/cancel \
  -H "Authorization: Bearer ${TOKEN}"
```

## 12. Buscar Visita por Patente

```bash
curl -X GET "${BASE_URL}/visits/plate/BBXY78" \
  -H "Authorization: Bearer ${TOKEN}"
```

## 13. Buscar Visita por Código QR

```bash
curl -X GET "${BASE_URL}/visits/qr/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" \
  -H "Authorization: Bearer ${TOKEN}"
```

## Flujo Completo: Visita Vehicular

```bash
# Paso 1: Residente programa la visita
VISIT_ID=$(curl -X POST ${BASE_URL}/visits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{...}' | jq -r '.id')

# Paso 2: IA detecta patente al llegar
curl -X POST ${BASE_URL}/visits/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"identifier": "BBXY78", "type": "plate"}'

# Paso 3: Sistema registra entrada
curl -X POST ${BASE_URL}/visits/${VISIT_ID}/check-in \
  -H "Authorization: Bearer ${TOKEN}"

# Paso 4: IA detecta patente al salir
curl -X POST ${BASE_URL}/visits/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"identifier": "BBXY78", "type": "plate"}'

# Paso 5: Sistema registra salida
curl -X POST ${BASE_URL}/visits/${VISIT_ID}/check-out \
  -H "Authorization: Bearer ${TOKEN}"
```

## Flujo Completo: Visita Peatonal con QR

```bash
# Paso 1: Residente programa visita peatonal
RESPONSE=$(curl -X POST ${BASE_URL}/visits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "type": "pedestrian",
    "visitorName": "María González",
    "validFrom": "2025-11-04T10:00:00-03:00",
    "validUntil": "2025-11-04T20:00:00-03:00",
    "hostId": "UUID_DEL_RESIDENTE"
  }')

VISIT_ID=$(echo $RESPONSE | jq -r '.id')
QR_CODE=$(echo $RESPONSE | jq -r '.qrCode')

echo "Código QR generado: ${QR_CODE}"
echo "Compartir este código con el visitante"

# Paso 2: Visitante llega y muestra QR al conserje
curl -X POST ${BASE_URL}/visits/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"identifier\": \"${QR_CODE}\", \"type\": \"qr\"}"

# Paso 3: Conserje registra entrada
curl -X POST ${BASE_URL}/visits/${VISIT_ID}/check-in \
  -H "Authorization: Bearer ${TOKEN}"

# Paso 4: Al salir, conserje registra salida
curl -X POST ${BASE_URL}/visits/${VISIT_ID}/check-out \
  -H "Authorization: Bearer ${TOKEN}"
```

## Notas Importantes

1. **Zonas Horarias**: Las fechas deben enviarse en formato ISO 8601 con zona horaria
2. **UUIDs**: Reemplazar los UUID de ejemplo con IDs reales de tu base de datos
3. **Tokens**: El token JWT se obtiene del endpoint de login `/auth/login`
4. **Validación**: El sistema valida automáticamente que las fechas sean coherentes
5. **Expiración**: Las visitas pendientes se marcan como expiradas automáticamente cada hora
