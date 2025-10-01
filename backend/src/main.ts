import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configuración de CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL, // URLs del frontend
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // Métodos HTTP permitidos
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Bearer'], // Headers permitidos
    credentials: true, // Permite el envío de cookies y credenciales
  });

  // Prefijo global para las rutas de la API
  app.setGlobalPrefix('api/v1');

  // Configuración global de validación
  // Agrega validadores a los DTOs y transforma los tipos automáticamente
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Elimina propiedades no definidas en el DTO
    forbidNonWhitelisted: true, // Lanza un error si se reciben propiedades no definidas
    transform: true, // Transforma automáticamente los tipos de datos
  }));

  const config = new DocumentBuilder()
    .setTitle('Taller de Título - API')
    .setDescription(`
      API completa para el sistema de Taller de Título.
      
      ## Autenticación
      Esta API utiliza JWT (JSON Web Tokens) para la autenticación. Los tokens se obtienen 
      a través del endpoint de login y deben incluirse en el header Authorization con el formato:
      \`Authorization: Bearer <token>\`
      
      ## Flujo de Autenticación
      1. **Registro**: Crear cuenta con email y datos personales
      2. **Confirmación**: Verificar cuenta usando código enviado por email  
      3. **Login**: Obtener token JWT con credenciales válidas
      4. **Acceso**: Usar token para acceder a endpoints protegidos
      
      ## Recuperación de Contraseña
      1. Solicitar recuperación con email
      2. Validar token recibido por email
      3. Establecer nueva contraseña
      
      ## Gestión de Usuarios
      Sistema completo de administración de usuarios que incluye:
      - **Creación**: Registro de nuevos usuarios con validación de RUT chileno
      - **Consulta**: Visualización de usuarios con roles y permisos
      - **Actualización**: Modificación parcial de datos de usuario
      - **Eliminación**: Soft delete para mantener auditoría
      - **Seguridad**: Encriptación automática de contraseñas
      
      ## Sistema de Roles y Permisos
      La API implementa un sistema RBAC (Role-Based Access Control) donde:
      - **Permisos**: Definen acciones específicas (ej: users.create, roles.read)
      - **Roles**: Agrupan múltiples permisos (ej: Administrador, Usuario)
      - **Usuarios**: Tienen roles asignados que determinan sus permisos
      
      ### Estructura de Permisos
      Los permisos siguen la nomenclatura: módulo.acción
      - **Módulos**: users, roles, permissions, tokens, etc.
      - **Acciones**: create, read, update, delete, manage, cleanup
      
      ## Códigos de Respuesta
      - **200**: Operación exitosa
      - **201**: Recurso creado exitosamente  
      - **400**: Datos inválidos o solicitud incorrecta
      - **401**: No autorizado (token inválido/expirado)
      - **404**: Recurso no encontrado
      - **500**: Error interno del servidor
    `)
    .setVersion('1.0')
    .addTag('Autenticación', 'Endpoints para registro, login y gestión de cuentas')
    .addTag('Gestión de Usuarios', 'Administración completa de usuarios del sistema')
    .addTag('Gestión de Roles', 'Administración completa de roles del sistema')
    .addTag('Gestión de Permisos', 'Administración de permisos y control de acceso')
    .addTag('Gestión de Tokens', 'Administración de tokens de verificación y autenticación')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Ingresa el JWT token',
        in: 'header',
      },
      'JWT-auth', // Este nombre debe coincidir con el usado en @ApiBearerAuth()
    )
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
