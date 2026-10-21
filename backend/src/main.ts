// Primero: carga el `.env` antes de leer `LOG_LEVEL`/`NODE_ENV` para el logger
// (no pisa variables ya definidas en el entorno).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import { AppModule } from './app.module';
import { resolveLogLevels } from './common/logging/log-levels';
import { buildHttpCorsOptions } from './common/http/http-cors.options';
import { parseListenHost, parseTrustProxy } from './config/env.validation';
import {
  isSwaggerEnabled,
  trustProxyExposureWarning,
} from './config/server-exposure';
import { createBodyParserMiddleware } from './common/http/body-limits';
import { verifyServiceApiKey } from './auth/service-api-key.verification';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { VigiliaIoAdapter } from './common/websocket/vigilia-io.adapter';

// Debe coincidir con el `basePath` configurado en src/auth/better-auth.ts.
const BETTER_AUTH_BASE_PATH = '/api/auth';

const bootstrapLogger = new Logger('Bootstrap');

// Tarea #21 (hardening): falla rápido en vez de arrancar con CORS abierto a
// cualquier origen (`origin: undefined` en `app.enableCors` deja pasar
// requests SIN header Origin, y en algunas configuraciones de Express/cors
// equivale a "cualquiera") o con un valor claramente mal formado.
function getRequiredFrontendOrigin(): string {
  const origin = process.env.FRONTEND_URL;
  if (!origin) {
    throw new Error(
      'FRONTEND_URL no está definido — es el origin permitido por CORS. Configúralo en tu .env antes de arrancar el backend.',
    );
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`FRONTEND_URL no es una URL válida: "${origin}"`);
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error(
      `FRONTEND_URL debe ser https:// en producción (valor actual: "${origin}")`,
    );
  }
  // Fase 4 · P6.R: el ORIGEN (sin ruta ni `/` final), que es lo que el
  // navegador manda en `Origin` y lo que comparan CORS y el WebSocket.
  return url.origin;
}

/**
 * Swagger UI en `/api`. Fase 4 · P9: en producción solo con
 * `SWAGGER_ENABLED=true` (ver config/server-exposure.ts).
 */
function setupSwagger(app: NestExpressApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Taller de Título - API')
    .setDescription(
      `
      API completa para el sistema de Taller de Título.

      ## Autenticación
      - **Personas:** sesión de better-auth en una cookie httpOnly. Se obtiene con
        \`POST /api/auth/sign-in/email\` y el navegador la envía sola en cada request.
      - **Servicios (worker LPR):** API key de servicio en el header \`x-api-key\`,
        emitida con \`POST /api/v1/auth/service-api-keys\`.
      - Un \`Authorization: Bearer <JWT>\` **no** autentica: el JWT legacy se retiró.

      ## Flujo de Autenticación
      1. **Alta**: un administrador crea la cuenta (no hay auto-registro)
      2. **Activación**: el usuario define su contraseña con el link enviado por email
      3. **Login**: \`POST /api/auth/sign-in/email\` abre la sesión (cookie)
      4. **Acceso**: los endpoints protegidos leen esa sesión

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
      - **Módulos**: users, roles, permissions, cameras, etc.
      - **Acciones**: create, read, update, delete, manage, cleanup

      ## Códigos de Respuesta
      - **200**: Operación exitosa
      - **201**: Recurso creado exitosamente
      - **400**: Datos inválidos o solicitud incorrecta
      - **401**: No autorizado (token inválido/expirado)
      - **404**: Recurso no encontrado
      - **500**: Error interno del servidor
    `,
    )
    .setVersion('1.0')
    .addTag(
      'Autenticación',
      'Endpoints para registro, login y gestión de cuentas',
    )
    .addTag(
      'Gestión de Usuarios',
      'Administración completa de usuarios del sistema',
    )
    .addTag('Gestión de Roles', 'Administración completa de roles del sistema')
    .addTag(
      'Gestión de Permisos',
      'Administración de permisos y control de acceso',
    )
    // El esquema conserva el nombre histórico 'JWT-auth' porque lo referencian
    // los ~100 `@ApiBearerAuth('JWT-auth')` de los controllers, pero ahora
    // describe la cookie de sesión de better-auth (Swagger UI la envía sola
    // tras iniciar sesión en el mismo origen).
    .addCookieAuth(
      'better-auth.session_token',
      {
        type: 'apiKey',
        in: 'cookie',
        description:
          'Cookie de sesión de better-auth (POST /api/auth/sign-in/email)',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'API key de servicio (worker LPR)',
      },
      'x-api-key', // Coincide con @ApiSecurity('x-api-key') de WorkersController
    )
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);
}

async function bootstrap() {
  // better-auth necesita leer el body/raw-stream de la request por su cuenta
  // (@thallesp/nestjs-better-auth se encarga de eso vía toNodeHandler). Por
  // eso desactivamos el body parser propio de Nest (igual que pide el README
  // de la librería) y lo re-agregamos nosotros mismos más abajo, saltándonos
  // SOLO las rutas de better-auth para no consumirle el stream.
  // Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): niveles según
  // `LOG_LEVEL`; en producción, por defecto sin `debug` ni `verbose`.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: resolveLogLevels(process.env),
  });

  // TRUST_PROXY (P2): cantidad de reverse proxies de confianza, para que
  // `req.ip` (rate limit, auditoría y el `x-client-ip` que lee better-auth)
  // sea la IP real del cliente y no la del proxy. Solo un número: con `true`
  // Express confiaría también en el X-Forwarded-For que manda el cliente, así
  // que `parseTrustProxy` nunca lo devuelve (y lanza si llega). Por defecto
  // no se confía en X-Forwarded-*.
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  app.set('trust proxy', trustProxy);

  // HOST (Fase 4 · P9): interfaz de escucha, default 0.0.0.0 (el hub y el
  // LPR llegan por la LAN). Con TRUST_PROXY activo y una interfaz no
  // loopback, el puerto debe quedar detrás de un firewall: si no, cualquiera
  // falsifica X-Forwarded-For y evade el límite de login por IP.
  const host = parseListenHost(process.env.HOST);
  const exposureWarning = trustProxyExposureWarning(trustProxy, host);
  if (exposureWarning) {
    bootstrapLogger.warn(exposureWarning);
  }

  // Tarea #21 (hardening): cabeceras de seguridad HTTP estándar (HSTS,
  // X-Content-Type-Options, X-Frame-Options, quita X-Powered-By, etc).
  // `contentSecurityPolicy: false` — esta es una API JSON (más el HTML propio
  // de better-auth para /reset-password), no sirve HTML de la app; el CSP
  // por default de helmet está pensado para apps que sirven vistas y puede
  // romper Swagger UI (/api) o el flujo de better-auth sin aportar valor acá.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Body parser propio, aplicado a todo EXCEPTO /api/auth/* (better-auth
  // parsea su propio body — si lo consumimos acá antes, sign-up/sign-in se
  // rompen). Fase 4 · P7 (corrección cyber, DoS sin sesión): 100 kb en
  // general (más grande → 413) y 10 MB solo en la ingesta del LPR (fotos en
  // base64). Fase 4 · P9: el límite grande exige una API key VERIFICADA con el
  // mismo mecanismo que ServiceApiKeyGuard, que reutiliza ese resultado (una
  // sola verificación por request). Ver common/http/body-limits.ts.
  const betterAuthService = app.get(BetterAuthService);
  app.use(
    createBodyParserMiddleware({
      skipPathPrefix: BETTER_AUTH_BASE_PATH,
      verifyServiceApiKey: (apiKey) =>
        verifyServiceApiKey(betterAuthService, apiKey),
    }),
  );

  // Configuración de CORS — `getRequiredFrontendOrigin()` falla el arranque
  // si FRONTEND_URL falta o está mal formado (tarea #21, hardening).
  const frontendOrigin = getRequiredFrontendOrigin();

  // Fase 4 · P6.R (D13): el mismo origen gobierna socket.io (`/` y `/hub`):
  // CORS del polling con credenciales y rechazo del handshake con un
  // `Origin` ajeno (ver VigiliaIoAdapter). Antes: `origin: '*'`.
  app.useWebSocketAdapter(new VigiliaIoAdapter(app, [frontendOrigin]));

  // Origen del frontend (validado al arrancar); headers permitidos y
  // expuestos en `buildHttpCorsOptions`.
  app.enableCors(buildHttpCorsOptions(frontendOrigin));

  // Prefijo global para las rutas de la API
  app.setGlobalPrefix('api/v1');

  // Configuración global de validación
  // Agrega validadores a los DTOs y transforma los tipos automáticamente
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Elimina propiedades no definidas en el DTO
      forbidNonWhitelisted: true, // Lanza un error si se reciben propiedades no definidas
      transform: true, // Transforma automáticamente los tipos de datos
    }),
  );

  // Fase 4 · P9: en producción, Swagger solo con SWAGGER_ENABLED=true.
  if (isSwaggerEnabled(process.env)) {
    setupSwagger(app);
  } else {
    bootstrapLogger.log('Swagger UI (/api) deshabilitado');
  }
  const port = process.env.PORT ?? 3000;
  await app.listen(port, host);
  bootstrapLogger.log(
    `Backend escuchando en ${host}:${port} — CORS origin: ${frontendOrigin}`,
  );
}

bootstrap().catch((error: unknown) => {
  // Arranque fallido (env inválido, BD caída, puerto ocupado): se loguea con
  // el Logger de Nest y se sale con código != 0 en vez de una promesa
  // rechazada sin manejar.
  bootstrapLogger.error(
    'El backend no pudo arrancar',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
