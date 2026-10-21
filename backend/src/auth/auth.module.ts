import { Logger, Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from 'src/users/users.module';
import { User } from 'src/users/entities/user.entity';
import { AuthorizationGuard } from './guards/authorization.guard';
import { AuthGuard } from './auth.guard';
import { MailerModule } from '@nestjs-modules/mailer';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { THROTTLER_MODULE_OPTIONS } from '../common/rate-limit/rate-limit.policies';
import { DataExportService } from '../privacy/data-export.service';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Visit } from '../visits/entities/visit.entity';
import { Notification } from '../notifications/entities/notification.entity';

const logger = new Logger('AuthModule');

@Module({
  imports: [
    forwardRef(() => UsersModule),
    ConfigModule,
    CloudinaryModule,
    // Vehicle/Visit/Notification: exportación del titular (Fase 4 · P7.R,
    // `GET /auth/me/data-export`, DataExportService).
    TypeOrmModule.forFeature([User, Vehicle, Visit, Notification]),
    // Fase 4 · P4.B (D9): UN solo throttler (`default`). Cada ruta elige su
    // límite con `@RateLimit('<política>')` (common/rate-limit/), que aplica
    // `VigiliaThrottlerGuard` (contador por hub, usuario o IP) a nivel de
    // método. Antes había dos throttlers nombrados y `ThrottlerGuard` aplicaba
    // ambos a cada ruta: `execute-tool` quedaba en 20/min en vez de 60.
    // `ThrottlerModule` es `@Global()`: registrarlo acá alcanza para todos los
    // módulos. Sin `APP_GUARD`: un guard global correría antes de la
    // autenticación. better-auth limita su `/sign-in/email` aparte
    // (`rateLimit.customRules`, better-auth.ts).
    ThrottlerModule.forRoot(THROTTLER_MODULE_OPTIONS),
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
  providers: [AuthService, AuthorizationGuard, AuthGuard, DataExportService],
  // AuthGuard: Fase 1, Bloque A1 — se exporta explícitamente para que
  // `ConciergeAuthGuard` (digital-concierge) pueda inyectarlo por
  // constructor y componerlo con `HubAuthGuard` (OR de transporte: hub O
  // sesión humana). Antes solo se usaba vía `@UseGuards(AuthGuard)` (21
  // usos, instanciación ad-hoc de Nest para guards referenciados por clase);
  // exportarlo no cambia ese comportamiento existente, solo lo formaliza
  // como provider inyectable para consumidores nuevos.
  exports: [AuthorizationGuard, AuthGuard],
})
export class AuthModule {}
