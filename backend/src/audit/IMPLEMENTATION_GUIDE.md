# Guía de Aplicación de Decoradores de Auditoría

## Resumen
Esta guía explica cómo aplicar el sistema de auditoría a los controladores existentes del sistema usando el decorador `@Auditable`.

## Controladores Prioritarios

### 1. AuthController (`src/auth/auth.controller.ts`)

```typescript
import { Auditable } from '@/audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '@/audit/entities/audit-log.entity';

// Login exitoso
@Post('login')
@Auditable({
  module: AuditModule.AUTH,
  action: AuditAction.LOGIN,
  description: 'Usuario inició sesión',
  captureRequest: true,
  captureResponse: false // No capturar token
})
async login(@Body() loginDto: LoginDto) {
  return await this.authService.login(loginDto);
}

// Registro de cuenta
@Post('register')
@Auditable({
  module: AuditModule.AUTH,
  action: AuditAction.CREATE,
  entityType: 'User',
  description: 'Nueva cuenta registrada',
  captureResponse: true
})
async register(@Body() createUserDto: CreateUserDto) {
  return await this.authService.createAccount(createUserDto);
}

// Cambio de contraseña
@Post('update-password/:token')
@Auditable({
  module: AuditModule.AUTH,
  action: AuditAction.PASSWORD_CHANGED,
  description: 'Contraseña actualizada mediante token',
  captureRequest: false // No capturar password
})
async updatePassword(
  @Param('token') token: string,
  @Body() passwordDto: NewPasswordDto
) {
  return await this.authService.updatePassword(token, passwordDto.password);
}
```

### 2. UsersController (`src/users/users.controller.ts`)

```typescript
// Crear usuario
@Post()
@RequirePermissions('users.create')
@Auditable({
  module: AuditModule.USERS,
  action: AuditAction.CREATE,
  entityType: 'User',
  description: 'Usuario creado',
  captureResponse: true
})
async create(@Body() createUserDto: CreateUserDto, @Req() req) {
  return await this.usersService.create(createUserDto);
}

// Actualizar usuario
@Patch(':id')
@RequirePermissions('users.update')
@Auditable({
  module: AuditModule.USERS,
  action: AuditAction.UPDATE,
  entityType: 'User',
  description: 'Usuario actualizado',
  captureOldValue: true, // Importante para UPDATE
  captureResponse: true
})
async update(
  @Param('id') id: string,
  @Body() updateUserDto: UpdateUserDto,
  @Req() req
) {
  return await this.usersService.update(id, updateUserDto);
}

// Eliminar usuario
@Delete(':id')
@RequirePermissions('users.delete')
@Auditable({
  module: AuditModule.USERS,
  action: AuditAction.DELETE,
  entityType: 'User',
  description: 'Usuario eliminado',
  captureOldValue: true
})
async remove(@Param('id') id: string, @Req() req) {
  return await this.usersService.remove(id);
}
```

### 3. CamerasController (`src/cameras/cameras.controller.ts`)

```typescript
// Activar LPR
@Post(':id/lpr/enable')
@RequirePermissions('cameras.update')
@Auditable({
  module: AuditModule.CAMERAS,
  action: AuditAction.LPR_ENABLE,
  entityType: 'Camera',
  description: 'LPR activado en cámara',
  captureResponse: true
})
async enableLpr(@Param('id') id: string, @Req() req) {
  return await this.camerasService.enableLpr(id);
}

// Registrar en MediaMTX
@Post(':id/mediamtx/register')
@RequirePermissions('cameras.update')
@Auditable({
  module: AuditModule.CAMERAS,
  action: AuditAction.CAMERA_REGISTER,
  entityType: 'Camera',
  description: 'Cámara registrada en MediaMTX',
  captureResponse: true
})
async registerInMediaMTX(@Param('id') id: string, @Req() req) {
  return await this.camerasService.registerInMediaMTX(id);
}

// Actualizar cámara
@Patch(':id')
@RequirePermissions('cameras.update')
@Auditable({
  module: AuditModule.CAMERAS,
  action: AuditAction.UPDATE,
  entityType: 'Camera',
  description: 'Configuración de cámara actualizada',
  captureOldValue: true,
  captureResponse: true
})
async update(
  @Param('id') id: string,
  @Body() updateCameraDto: UpdateCameraDto,
  @Req() req
) {
  return await this.camerasService.update(id, updateCameraDto);
}
```

### 4. VisitsController (`src/visits/visits.controller.ts`)

```typescript
// Aprobar visita
@Patch(':id/approve')
@RequirePermissions('visits.approve')
@Auditable({
  module: AuditModule.VISITS,
  action: AuditAction.APPROVE,
  entityType: 'Visit',
  description: 'Visita aprobada',
  captureResponse: true
})
async approve(@Param('id') id: string, @Req() req) {
  return await this.visitsService.approve(id);
}

// Rechazar visita
@Patch(':id/reject')
@RequirePermissions('visits.approve')
@Auditable({
  module: AuditModule.VISITS,
  action: AuditAction.REJECT,
  entityType: 'Visit',
  description: 'Visita rechazada',
  captureResponse: true
})
async reject(@Param('id') id: string, @Req() req) {
  return await this.visitsService.reject(id);
}

// Check-in
@Post(':id/checkin')
@RequirePermissions('visits.checkin')
@Auditable({
  module: AuditModule.VISITS,
  action: AuditAction.CHECK_IN,
  entityType: 'Visit',
  description: 'Check-in de visita registrado',
  captureResponse: true
})
async checkIn(@Param('id') id: string, @Req() req) {
  return await this.visitsService.checkIn(id);
}

// Generar QR
@Post(':id/qr')
@RequirePermissions('visits.create')
@Auditable({
  module: AuditModule.VISITS,
  action: AuditAction.QR_GENERATE,
  entityType: 'Visit',
  description: 'Código QR generado para visita',
  captureResponse: false // QR puede ser grande
})
async generateQr(@Param('id') id: string, @Req() req) {
  return await this.visitsService.generateQr(id);
}

// Validar QR
@Post('validate-qr')
@Auditable({
  module: AuditModule.VISITS,
  action: AuditAction.QR_VALIDATE,
  entityType: 'Visit',
  description: 'Código QR validado',
  captureRequest: true
})
async validateQr(@Body() dto: ValidateQrDto, @Req() req) {
  return await this.visitsService.validateQr(dto.qrCode);
}
```

### 5. RolesController (`src/roles/roles.controller.ts`)

```typescript
// Otorgar permiso
@Post(':id/permissions/:permissionId')
@RequirePermissions('roles.update')
@Auditable({
  module: AuditModule.PERMISSIONS,
  action: AuditAction.PERMISSION_GRANT,
  entityType: 'Role',
  description: 'Permiso otorgado a rol',
  captureResponse: true
})
async grantPermission(
  @Param('id') id: string,
  @Param('permissionId') permissionId: string,
  @Req() req
) {
  return await this.rolesService.grantPermission(id, permissionId);
}

// Revocar permiso
@Delete(':id/permissions/:permissionId')
@RequirePermissions('roles.update')
@Auditable({
  module: AuditModule.PERMISSIONS,
  action: AuditAction.PERMISSION_REVOKE,
  entityType: 'Role',
  description: 'Permiso revocado de rol',
  captureOldValue: true
})
async revokePermission(
  @Param('id') id: string,
  @Param('permissionId') permissionId: string,
  @Req() req
) {
  return await this.rolesService.revokePermission(id, permissionId);
}
```

## Patrón General de Aplicación

### Para operaciones CRUD:

```typescript
// CREATE
@Auditable({
  module: AuditModule.XXX,
  action: AuditAction.CREATE,
  entityType: 'EntityName',
  description: 'Entidad creada',
  captureResponse: true
})

// UPDATE
@Auditable({
  module: AuditModule.XXX,
  action: AuditAction.UPDATE,
  entityType: 'EntityName',
  description: 'Entidad actualizada',
  captureOldValue: true, // ⚠️ Importante para UPDATE
  captureResponse: true
})

// DELETE
@Auditable({
  module: AuditModule.XXX,
  action: AuditAction.DELETE,
  entityType: 'EntityName',
  description: 'Entidad eliminada',
  captureOldValue: true // Capturar estado antes de eliminar
})
```

### Para operaciones de estado:

```typescript
// ENABLE/ACTIVATE
@Auditable({
  module: AuditModule.XXX,
  action: AuditAction.ENABLE, // o ACTIVATE
  entityType: 'EntityName',
  description: 'Funcionalidad activada',
  captureResponse: true
})

// DISABLE/DEACTIVATE
@Auditable({
  module: AuditModule.XXX,
  action: AuditAction.DISABLE, // o DEACTIVATE
  entityType: 'EntityName',
  description: 'Funcionalidad desactivada',
  captureResponse: true
})
```

## Consideraciones de Seguridad

### ❌ NO capturar:
- Contraseñas (ya sanitizadas automáticamente)
- Tokens JWT
- Claves API
- Datos sensibles del request body

### ✅ SÍ capturar:
- Respuestas de creación (contienen IDs útiles)
- Estados anteriores en UPDATE/DELETE
- Metadata relevante (roles, permisos, estados)

## Casos Especiales

### Auditoría Manual (para lógica compleja):

```typescript
constructor(private readonly auditService: AuditService) {}

async complexOperation(dto: ComplexDto, userId: string) {
  const oldEntity = await this.repo.findOne(dto.id);
  
  // Lógica compleja aquí...
  const result = await this.performComplexLogic(dto);
  
  // Auditoría manual
  await this.auditService.log({
    module: AuditModule.XXX,
    action: AuditAction.UPDATE,
    userId,
    entityId: dto.id,
    entityType: 'ComplexEntity',
    oldValue: oldEntity,
    newValue: result,
    description: 'Operación compleja ejecutada',
    metadata: {
      customField: 'valor',
      steps: ['step1', 'step2']
    }
  });
  
  return result;
}
```

## Plan de Implementación Sugerido

### Fase 1 - Crítico (esta semana):
1. ✅ AuthController (login, registro, password reset)
2. ⏳ UsersController (CRUD completo)
3. ⏳ RolesController (permisos)

### Fase 2 - Alta prioridad (próxima semana):
4. ⏳ VisitsController (approve, reject, check-in, QR)
5. ⏳ CamerasController (LPR, MediaMTX, CRUD)

### Fase 3 - Media prioridad:
6. VehiclesController (detecciones, OCR)
7. FamiliesController (CRUD)
8. NotificationsController (envío)

### Fase 4 - Baja prioridad:
9. StreamsController
10. DigitalConciergeController

## Verificación

Después de aplicar los decoradores:

1. **Ejecutar acción** (ej: crear usuario)
2. **Verificar en base de datos**:
   ```sql
   SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10;
   ```
3. **Verificar en frontend**: `/settings/audit`
4. **Verificar metadata**: IP, userAgent, duration capturados
5. **Verificar sanitización**: Passwords redactados

## Performance

- ✅ Logging asíncrono (no bloquea requests)
- ✅ Índices optimizados en DB
- ✅ Cleanup automático después de 90 días
- ⚠️ No aplicar en endpoints de alto tráfico sin evaluar (ej: health checks)

## Soporte

Para dudas sobre el sistema de auditoría, revisar:
- `backend/src/audit/USAGE_EXAMPLES.md` - Ejemplos completos
- `backend/src/audit/decorators/auditable.decorator.ts` - Opciones del decorator
- `backend/src/audit/audit.service.ts` - API del servicio
