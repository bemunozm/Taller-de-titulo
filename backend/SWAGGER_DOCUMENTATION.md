# API de Autenticación - Documentación Swagger

## 🚀 Acceso a la Documentación

Una vez que el servidor esté ejecutándose, puedes acceder a la documentación Swagger en:

**URL:** `http://localhost:3000/api`

## 📋 Endpoints Documentados

### **🔐 Autenticación Pública**
- `POST /api/v1/auth/create-account` - Crear nueva cuenta
- `POST /api/v1/auth/confirm-account` - Confirmar cuenta con token
- `POST /api/v1/auth/login` - Iniciar sesión
- `POST /api/v1/auth/request-code` - Solicitar código de confirmación
- `POST /api/v1/auth/forgot-password` - Solicitar recuperación de contraseña
- `POST /api/v1/auth/validate-token` - Validar token de recuperación
- `POST /api/v1/auth/update-password` - Actualizar contraseña con token

### **🔒 Gestión de Perfil** (Requieren JWT)
- `GET /api/v1/auth/user` - Obtener información del usuario actual
- `POST /api/v1/auth/profile` - Actualizar perfil del usuario
- `POST /api/v1/auth/update-password` - Cambiar contraseña (usuario autenticado)
- `POST /api/v1/auth/check-password` - Verificar contraseña actual

### **👥 Administración de Usuarios** (Requieren JWT + Permisos)
- `POST /api/v1/users` - Crear nuevo usuario
- `GET /api/v1/users` - Listar todos los usuarios
- `GET /api/v1/users/:id` - Obtener usuario específico
- `PATCH /api/v1/users/:id` - Actualizar información del usuario
- `DELETE /api/v1/users/:id` - Eliminar usuario (soft delete)

### **🔧 Gestión de Tokens** (Requieren JWT + Permisos)
- `POST /api/v1/tokens` - Crear nuevo token
- `GET /api/v1/tokens` - Listar todos los tokens
- `GET /api/v1/tokens/:id` - Obtener token específico
- `PATCH /api/v1/tokens/:id` - Actualizar token
- `DELETE /api/v1/tokens/:id` - Eliminar token
- `DELETE /api/v1/tokens/cleanup/expired` - Limpiar tokens expirados

## 🔐 Autenticación JWT

### Obtener Token
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@example.com",
    "password": "miPassword123"
  }'
```

### Usar Token en Requests
```bash
curl -X GET http://localhost:3000/api/v1/auth/user \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## 📝 Ejemplos de Uso

### 1. Registro Completo
```json
POST /api/v1/auth/create-account
{
  "rut": "12345678-9",
  "name": "Juan Pérez González",
  "email": "juan.perez@example.com",
  "phone": "+56912345678",
  "password": "miPassword123",
  "password_confirmation": "miPassword123",
  "age": 25
}
```

### 2. Confirmación de Cuenta
```json
POST /api/v1/auth/confirm-account
{
  "token": "123456"
}
```

### 3. Login
```json
POST /api/v1/auth/login
{
  "email": "juan.perez@example.com",
  "password": "miPassword123"
}
```

### 4. Recuperación de Contraseña

**Paso 1: Solicitar recuperación**
```json
POST /api/v1/auth/forgot-password
{
  "email": "juan.perez@example.com"
}
```

**Paso 2: Validar token**
```json
POST /api/v1/auth/validate-token
{
  "token": "789012"
}
```

**Paso 3: Nueva contraseña**
```json
POST /api/v1/auth/update-password
{
  "token": "789012",
  "password": "miNuevaPassword123"
}
```

## 📊 Códigos de Respuesta

| Código | Descripción | Ejemplo |
|--------|-------------|---------|
| **200** | Éxito | Operación completada correctamente |
| **201** | Creado | Usuario registrado exitosamente |
| **400** | Bad Request | Datos inválidos o contraseñas no coinciden |
| **401** | No autorizado | Token inválido, credenciales incorrectas o cuenta no confirmada |
| **404** | No encontrado | Usuario no existe o token expirado |
| **500** | Error servidor | Error interno del sistema |

## 🔧 Configuración en Swagger UI

1. **Abrir Swagger**: Navega a `http://localhost:3000/api`
2. **Autenticarse**: 
   - Haz login para obtener el JWT token
   - Copia el token (sin "Bearer")
   - Click en "Authorize" en Swagger UI
   - Pega el token en el campo "Value"
   - Click "Authorize"
3. **Probar endpoints**: Ahora puedes probar todos los endpoints protegidos

## 📱 Flujos de Usuario

### **Flujo de Registro**
1. Usuario completa formulario → `POST /create-account`
2. Sistema envía email con código → Usuario recibe email
3. Usuario ingresa código → `POST /confirm-account`
4. Usuario puede hacer login → `POST /login`

### **Flujo de Login**
1. Usuario ingresa credenciales → `POST /login`
2. Sistema valida y retorna JWT → Usuario obtiene token
3. Usuario usa token en requests → Headers: `Authorization: Bearer <token>`

### **Flujo de Recuperación**
1. Usuario solicita recuperación → `POST /forgot-password`
2. Usuario recibe email con código → `POST /validate-token`
3. Usuario establece nueva contraseña → `POST /update-password`

## ⚠️ Notas Importantes

- **Tokens de confirmación/recuperación**: Expiran en 10 minutos
- **JWT tokens**: Válidos por 24 horas
- **Emails únicos**: No se permiten duplicados
- **Contraseñas**: Mínimo 6 caracteres
- **Confirmación requerida**: Los usuarios deben confirmar su email antes del primer login

## 🧪 Endpoint de Prueba

Para verificar la configuración de emails:
```bash
GET /api/v1/auth/test-email
```

Este endpoint envía un email de prueba para verificar la configuración SMTP.

## 📋 DTOs Completamente Documentados

Todos los Data Transfer Objects están completamente documentados con ejemplos y validaciones:

### **Autenticación Pública**
- **`RegisterDto`** - Registro completo con RUT, nombre, email, teléfono, contraseña y edad
- **`LoginDto`** - Email y contraseña para acceso
- **`ConfirmAccountDto`** - Token de 6 dígitos para confirmación
- **`RequestConfirmationCodeDto`** - Email para reenvío de código
- **`ForgotPasswordDto`** - Email para recuperación de contraseña
- **`ValidateTokenDto`** - Token de 6 dígitos para validación
- **`UpdatePasswordWithTokenDto`** - Token y nueva contraseña

### **Gestión de Perfil (Requiere autenticación)**
- **`UpdateProfileDto`** - Actualizar nombre y email del usuario
- **`UpdateCurrentUserPasswordDto`** - Cambiar contraseña (requiere contraseña actual)
- **`CheckPasswordDto`** - Verificar contraseña actual del usuario

### **Administración de Usuarios (Requiere permisos)**
- **`CreateUserDto`** - Creación completa de usuario con RUT, nombre, email, contraseña y edad
- **`UpdateUserDto`** - Actualización parcial de datos de usuario (todos los campos opcionales)

### **Gestión de Tokens (Requiere permisos)**
- **`CreateTokenDto`** - Crear token de verificación con usuario y expiración
- **`UpdateTokenDto`** - Actualizar información de token existente

### **Ejemplos de DTOs en Swagger UI**

Cada DTO incluye:
- **Validaciones visibles** - Campos requeridos, longitud mínima, formatos
- **Ejemplos realistas** - Datos de prueba para facilitar testing
- **Descripciones claras** - Explicación de cada campo y su propósito
- **Tipos de datos** - String, email, number según corresponda

## 🔐 Sistema de Roles y Permisos

### **Gestión de Roles**
- `POST /api/v1/roles` - Crear nuevo rol
- `GET /api/v1/roles` - Listar todos los roles
- `GET /api/v1/roles/permissions/available` - Obtener permisos disponibles
- `GET /api/v1/roles/permissions/by-module` - Permisos agrupados por módulo
- `GET /api/v1/roles/:id` - Obtener rol específico
- `GET /api/v1/roles/:id/permissions` - Obtener permisos de un rol
- `PATCH /api/v1/roles/:id` - Actualizar información del rol
- `PUT /api/v1/roles/:id/permissions` - Actualizar permisos del rol
- `DELETE /api/v1/roles/:id` - Eliminar rol

### **Gestión de Permisos**
- `POST /api/v1/permissions` - Crear nuevo permiso
- `GET /api/v1/permissions` - Listar todos los permisos
- `GET /api/v1/permissions/by-module` - Permisos agrupados por módulo
- `GET /api/v1/permissions/:id` - Obtener permiso específico
- `PATCH /api/v1/permissions/:id` - Actualizar permiso
- `DELETE /api/v1/permissions/:id` - Eliminar permiso

### **🔒 Permisos Requeridos**

Todos los endpoints de roles y permisos requieren autenticación JWT y permisos específicos:

#### **Roles**
- **roles.create** - Crear roles
- **roles.read** - Ver roles y permisos
- **roles.update** - Modificar roles y asignar permisos  
- **roles.delete** - Eliminar roles

#### **Permisos**
- **permissions.create** - Crear permisos
- **permissions.read** - Ver permisos
- **permissions.update** - Modificar permisos
- **permissions.delete** - Eliminar permisos

### **📝 Ejemplos de Uso - Roles**

**Crear rol:**
```json
POST /api/v1/roles
{
  "name": "Administrador",
  "description": "Administrador del sistema con acceso completo",
  "permissionIds": ["perm-uuid-1", "perm-uuid-2"]
}
```

**Actualizar permisos de rol:**
```json
PUT /api/v1/roles/role-uuid-123/permissions
{
  "permissionIds": ["perm-uuid-1", "perm-uuid-2", "perm-uuid-3"]
}
```

### **📝 Ejemplos de Uso - Permisos**

**Crear permiso:**
```json
POST /api/v1/permissions
{
  "name": "users.create",
  "description": "Permite crear nuevos usuarios en el sistema",
  "module": "users",
  "action": "create"
}
```

## 👥 Sistema de Gestión de Usuarios

### **Administración de Usuarios**
- `POST /api/v1/users` - Crear nuevo usuario
- `GET /api/v1/users` - Listar todos los usuarios
- `GET /api/v1/users/:id` - Obtener usuario específico
- `PATCH /api/v1/users/:id` - Actualizar información del usuario
- `DELETE /api/v1/users/:id` - Eliminar usuario (soft delete)

### **🔒 Permisos Requeridos - Usuarios**

- **users.create** - Crear nuevos usuarios
- **users.read** - Ver información de usuarios
- **users.update** - Modificar datos de usuarios
- **users.delete** - Eliminar usuarios del sistema

### **📝 Ejemplos de Uso - Usuarios**

**Crear usuario:**
```json
POST /api/v1/users
{
  "rut": "12345678-9",
  "name": "Juan Carlos Pérez González",
  "email": "juan.perez@universidad.cl",
  "password": "MiContraseñaSegura123!",
  "age": 22,
  "confirmed": false
}
```

**Actualizar usuario:**
```json
PATCH /api/v1/users/user-uuid-123
{
  "name": "Juan Carlos Pérez Silva",
  "age": 23
}
```

### **🚀 Características del Módulo Usuarios**

- **Validación RUT**: Formato chileno con validación de longitud
- **Emails únicos**: No se permiten correos duplicados
- **Encriptación automática**: Las contraseñas se encriptan antes del almacenamiento
- **Soft Delete**: Los usuarios eliminados se marcan como eliminados pero se conservan para auditoría
- **Relaciones completas**: Incluye roles y permisos en las respuestas
- **Actualización parcial**: Solo se modifican los campos enviados

### **⚠️ Restricciones de Seguridad**

- **Eliminación protegida**: No se pueden eliminar roles/permisos asignados a usuarios activos
- **Nombres únicos**: Los nombres de roles y permisos deben ser únicos
- **Validación de formato**: Los permisos siguen el formato `modulo.accion`
- **Autorización granular**: Cada operación requiere permisos específicos
- **RUT único**: No se permiten RUTs duplicados en el sistema
- **Validación de email**: Formato válido y unicidad garantizada

## 🔧 Sistema de Gestión de Tokens

### **Administración de Tokens**
- `POST /api/v1/tokens` - Crear nuevo token
- `GET /api/v1/tokens` - Listar todos los tokens
- `GET /api/v1/tokens/:id` - Obtener token específico
- `PATCH /api/v1/tokens/:id` - Actualizar token
- `DELETE /api/v1/tokens/:id` - Eliminar token
- `DELETE /api/v1/tokens/cleanup/expired` - Limpiar tokens expirados

### **🔒 Permisos Requeridos - Tokens**

- **tokens.create** - Crear tokens de verificación
- **tokens.read** - Ver información de tokens
- **tokens.update** - Modificar tokens (no recomendado por seguridad)
- **tokens.delete** - Eliminar tokens específicos
- **tokens.cleanup** - Limpiar tokens expirados del sistema

### **📝 Ejemplos de Uso - Tokens**

**Crear token:**
```json
POST /api/v1/tokens
{
  "token": "123456",
  "userId": "user-uuid-123",
  "expiresAt": "2024-01-01T12:10:00Z"
}
```

**Limpiar tokens expirados:**
```json
DELETE /api/v1/tokens/cleanup/expired
Response: {
  "message": "Se eliminaron 15 tokens expirados",
  "removedCount": 15
}
```

### **🎯 Estructura RBAC**

```
Usuario → Roles → Permisos → Acciones
```

1. **Usuario** tiene uno o más **Roles**
2. **Rol** agrupa múltiples **Permisos**
3. **Permiso** define una **Acción** específica en un **Módulo**
4. El sistema valida permisos en cada request protegido