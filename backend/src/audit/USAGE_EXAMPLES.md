// Ejemplos de uso del sistema de auditoría en controladores

## 1. Auth Controller - Login y Registro

```typescript
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction, AuditModule } from '../audit/entities/audit-log.entity';

@Post("login")
@Auditable({
  module: AuditModule.AUTH,
  action: AuditAction.LOGIN,
  description: 'Usuario inició sesión',
})
login(@Body() loginDto: LoginDto) {
  return this.authService.login(loginDto);
}

@Post("create-account")
@Auditable({
  module: AuditModule.AUTH,
  action: AuditAction.CREATE,
  entityType: 'User',
  description: 'Nueva cuenta creada',
  captureResponse: true,
})
createAccount(@Body() registerDto: RegisterDto) {
  return this.authService.createAccount(registerDto);
}
```

## 2. Users Controller - CRUD Operations

```typescript
@Post()
@Auditable({
  module: AuditModule.USERS,
  action: AuditAction.CREATE,
  entityType: 'User',
  description: 'Usuario creado',
  captureResponse: true,
})
create(@Body() createUserDto: CreateUserDto) {
  return this.usersService.create(createUserDto);
}

@Patch(':id')
@Auditable({
  module: AuditModule.USERS,
  action: AuditAction.UPDATE,
  entityType: 'User',
  description: 'Usuario actualizado',
  captureOldValue: true, // Para capturar estado anterior
})
async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto, @Request() req) {
  // Capturar valor anterior antes de actualizar
  req.oldValue = await this.usersService.findOne(id);
  return this.usersService.update(id, updateUserDto);
}

@Delete(':id')
@Auditable({
  module: AuditModule.USERS,
  action: AuditAction.DELETE,
  entityType: 'User',
  description: 'Usuario eliminado',
  captureOldValue: true,
})
async remove(@Param('id') id: string, @Request() req) {
  req.oldValue = await this.usersService.findOne(id);
  return this.usersService.remove(id);
}
```

## 3. Cameras Controller - Operaciones Específicas

```typescript
@Patch(':id/enable-lpr')
@Auditable({
  module: AuditModule.CAMERAS,
  action: AuditAction.CAMERA_LPR_ENABLE,
  entityType: 'Camera',
  description: 'LPR habilitado en cámara',
})
enableLpr(@Param('id') id: string) {
  return this.camerasService.enableLpr(id, true);
}

@Post(':id/register')
@Auditable({
  module: AuditModule.CAMERAS,
  action: AuditAction.CAMERA_REGISTER,
  entityType: 'Camera',
  description: 'Cámara registrada en MediaMTX',
})
registerCamera(@Param('id') id: string) {
  return this.camerasService.registerInMediaMtx(id);
}
```

## 4. Visits Controller - Workflow de Visitas

```typescript
@Patch(':id/approve')
@Auditable({
  module: AuditModule.VISITS,
  action: AuditAction.VISIT_APPROVE,
  entityType: 'Visit',
  description: 'Visita aprobada',
})
approve(@Param('id') id: string) {
  return this.visitsService.approve(id);
}

@Patch(':id/check-in')
@Auditable({
  module: AuditModule.VISITS,
  action: AuditAction.VISIT_CHECK_IN,
  entityType: 'Visit',
  description: 'Check-in de visita registrado',
})
checkIn(@Param('id') id: string) {
  return this.visitsService.checkIn(id);
}

@Post('validate-qr')
@Auditable({
  module: AuditModule.VISITS,
  action: AuditAction.VISIT_QR_VALIDATE,
  entityType: 'Visit',
  description: 'QR de visita validado',
})
validateQr(@Body() validateQrDto: ValidateQrDto) {
  return this.visitsService.validateQr(validateQrDto);
}
```

## 5. Roles Controller - Gestión de Permisos

```typescript
@Post(':id/permissions/:permissionId')
@Auditable({
  module: AuditModule.ROLES,
  action: AuditAction.PERMISSION_GRANT,
  entityType: 'Role',
  description: 'Permiso otorgado a rol',
})
grantPermission(
  @Param('id') id: string,
  @Param('permissionId') permissionId: string
) {
  return this.rolesService.addPermission(id, permissionId);
}

@Delete(':id/permissions/:permissionId')
@Auditable({
  module: AuditModule.ROLES,
  action: AuditAction.PERMISSION_REVOKE,
  entityType: 'Role',
  description: 'Permiso revocado de rol',
})
revokePermission(
  @Param('id') id: string,
  @Param('permissionId') permissionId: string
) {
  return this.rolesService.removePermission(id, permissionId);
}
```

## 6. Auditoría Manual (sin decorador)

Para casos donde necesites control total:

```typescript
import { AuditService } from '../audit/audit.service';

constructor(private readonly auditService: AuditService) {}

async someComplexOperation(data: any, userId: string) {
  try {
    const result = await this.doSomething(data);
    
    // Log manual de auditoría
    await this.auditService.log({
      module: AuditModule.CUSTOM,
      action: AuditAction.CREATE,
      userId,
      entityId: result.id,
      entityType: 'CustomEntity',
      newValue: result,
      description: 'Operación compleja ejecutada exitosamente',
      metadata: {
        customField: 'value',
      },
    });
    
    return result;
  } catch (error) {
    // Log de error
    await this.auditService.log({
      module: AuditModule.CUSTOM,
      action: AuditAction.CREATE,
      userId,
      description: `Operación falló: ${error.message}`,
      metadata: {
        error: error.stack,
      },
    });
    
    throw error;
  }
}
```

## Notas Importantes

1. **Performance**: El interceptor no bloquea las respuestas, el logging es asíncrono
2. **Sensibilidad**: Passwords y tokens se sanitizan automáticamente
3. **Metadata**: Se captura IP, User-Agent, endpoint, método HTTP automáticamente
4. **Errores**: Si falla el logging de auditoría, no afecta la operación principal
5. **Contexto**: El interceptor obtiene el usuario del request.user (JWT payload)
