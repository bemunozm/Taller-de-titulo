// IMPORTANTE (hallazgo tarea #21): al igual que better-auth.ts, este módulo
// necesita `process.env.JWT_SECRET` disponible EN EL MOMENTO DEL IMPORT
// (`JwtModule.register(...)` corre como side-effect síncrono al cargar el
// archivo, no dentro del cuerpo de `@Module`). Sin este `dotenv/config`,
// process.env.JWT_SECRET llega `undefined` acá: `AuthModule` se importa
// (app.module.ts) ANTES que `./auth/better-auth` en el orden de imports, y
// `ConfigModule.forRoot()` recién carga el .env cuando corre el cuerpo del
// decorador `@Module` de AppModule — MÁS TARDE que esto. Antes de esta tarea
// eso pasaba desapercibido porque `getRequiredJwtSecret` no existía y el
// fallback `|| 'yourSecretKey'` absorbía el `undefined` en silencio — es
// decir, EN LA PRÁCTICA el login legacy llevaba firmando/verificando JWTs
// con el secret hardcodeado 'yourSecretKey' pase lo que pasara en el .env
// (ver hallazgo detallado en el reporte de esta tarea).
import 'dotenv/config';
import { Logger, Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from 'src/users/users.module';
import { TokensModule } from 'src/tokens/tokens.module';
import { JwtModule } from '@nestjs/jwt';
import { User } from 'src/users/entities/user.entity';
import { Token } from 'src/tokens/entities/token.entity';
import { AuthEmailService } from './services/auth-email.service';
import { AuthorizationGuard } from './guards/authorization.guard';
import { MailerModule } from '@nestjs-modules/mailer';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';

// Tarea #21 (docs/modulos/auth-multitenant.md §11+, hardening): el arranque
// DEBE fallar si JWT_SECRET no está definido o es débil — antes había un
// fallback hardcodeado (`|| 'yourSecretKey'`) que dejaba el login legacy
// firmando/verificando JWTs con un secret público y conocido si alguien
// olvidaba setear la env var (p.ej. un deploy nuevo). 32 caracteres es el
// mínimo recomendado por la skill better-auth-security-best-practices para
// BETTER_AUTH_SECRET; se aplica el mismo piso acá porque ambos secrets
// protegen el mismo tipo de credencial (JWT de sesión).
function getRequiredJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      'JWT_SECRET no está definido o es demasiado corto (mínimo 32 caracteres). ' +
        'Genera uno fuerte con `openssl rand -base64 32` y configúralo en tu .env antes de arrancar el backend.',
    );
  }
  return secret;
}

const logger = new Logger('AuthModule');

@Module({
  imports: [
    forwardRef(() => UsersModule),
    TokensModule,
    ConfigModule,
    CloudinaryModule,
    TypeOrmModule.forFeature([User, Token]),
    JwtModule.register({
      global: true,
      secret: getRequiredJwtSecret(),
      signOptions: { expiresIn: process.env.JWT_EXPIRATION || '1d', algorithm: 'HS256' },
      verifyOptions: { algorithms: ['HS256'] },
    }),
    // Tarea #21: throttling del login legacy (`POST /api/v1/auth/login`,
    // ver AuthController) — better-auth ya protege su propio /sign-in/email
    // vía `rateLimit.customRules` (better-auth.ts), pero el login JWT propio
    // (AuthService.login) no pasa por ahí. Named throttler 'login' (no se
    // registra como guard global — solo se aplica explícitamente en la ruta
    // de login vía @UseGuards(ThrottlerGuard) + @Throttle, así no afecta el
    // resto de endpoints de AuthController).
    ThrottlerModule.forRoot([{ name: 'login', ttl: 60_000, limit: 5 }]),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = {
          transport: {
            host: configService.get<string>('SMTP_HOST'),
            port: configService.get<number>('SMTP_PORT'),
            secure: false,
            auth: {
              user: configService.get<string>('SMTP_USER'),
              pass: configService.get<string>('SMTP_PASS'),
            },
          },
          defaults: {
            from: 'UpTask <admin@uptask.com>',
          },
        };
        // Tarea #21 (hardening): ya no se loguea `SMTP_USER` (identifica una
        // cuenta de correo real) — solo host/puerto, suficiente para
        // diagnosticar un SMTP mal configurado sin filtrar PII a los logs.
        logger.debug(
          `Configuración de MailerModule: host=${config.transport.host} port=${config.transport.port} from=${config.defaults.from}`,
        );
        return config;
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthEmailService, AuthorizationGuard],
  exports: [AuthorizationGuard, AuthEmailService],
})
export class AuthModule {}
