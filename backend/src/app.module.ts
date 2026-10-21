import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { buildTypeOrmOptions } from './database/typeorm-options';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { TokensModule } from './tokens/tokens.module';
import { AuthModule } from './auth/auth.module';
import { auth } from './auth/better-auth';
import { clientIpHeaderMiddleware } from './auth/middleware/client-ip.middleware';
import { PermissionsModule } from './permissions/permissions.module';
import { StreamsModule } from './streams/streams.module';
import { DataInitializationService } from './common/services/data-initialization.service';
import { ExpirationService } from './common/services/expiration.service';
import { Role } from './roles/entities/role.entity';
import { Permission } from './permissions/entities/permission.entity';
import { AccessAttempt } from './detections/entities/access-attempt.entity';
import { Notification } from './notifications/entities/notification.entity';
import { Visit } from './visits/entities/visit.entity';
import { ConciergeSession } from './digital-concierge/entities/concierge-session.entity';
import { CamerasModule } from './cameras/cameras.module';
import { DetectionsModule } from './detections/detections.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { WorkersModule } from './workers/workers.module';
import { FamiliesModule } from './families/families.module';
import { UnitsModule } from './units/units.module';
import { VisitsModule } from './visits/visits.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DigitalConciergeModule } from './digital-concierge/digital-concierge.module';
import { AuditModule } from './audit/audit.module';
import { LogsModule } from './logs/logs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HubModule } from './hub/hub.module';
import { AnomaliesModule } from './anomalies/anomalies.module';
import { TenantModule } from './common/tenant/tenant.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AgentModule } from './agent/agent.module';
import { PrivacyModule } from './privacy/privacy.module';

@Module({
  imports: [
    // Carga las variables de entorno, las hace globales y las VALIDA al arrancar
    // (P2: falla si faltan, si hay placeholders o si los secretos son débiles).
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(), // Habilita las tareas programadas
    // Fuente única de opciones (src/database/typeorm-options.ts), compartida con
    // el CLI de migraciones (src/database/data-source.ts). El esquema lo crean
    // las migraciones; `synchronize` solo con DB_SYNCHRONIZE=true (nunca en prod).
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
    }),
    TypeOrmModule.forFeature([
      Role,
      Permission,
      AccessAttempt,
      Notification,
      Visit,
      // Fase 4 · P7 (QA A2): ExpirationService cierra las sesiones abandonadas.
      ConciergeSession,
    ]),
    // POC Fase 0 (docs/modulos/auth-multitenant.md): better-auth montado EN
    // PARALELO al AuthModule propio (JWT+RBAC, sigue intacto más abajo).
    // `disableGlobalAuthGuard: true` es CRÍTICO: sin esto la librería registra
    // su AuthGuard como guard global (APP_GUARD) y protegería/rompería TODAS
    // las rutas existentes, que hoy usan su propio guard. Con el guard global
    // deshabilitado, better-auth solo expone sus endpoints (/api/auth/*) y no
    // interfiere con el resto de la API.
    //
    // `middleware` corre justo antes del handler de /api/auth (hallazgo M1):
    // fija `x-client-ip = req.ip` (respeta TRUST_PROXY) y borra los headers
    // de IP del cliente, para que el rate-limit de better-auth vea la IP real.
    BetterAuthModule.forRoot({
      auth,
      disableGlobalAuthGuard: true,
      middleware: clientIpHeaderMiddleware,
    }),
    // Tarea #19 (docs/modulos/auth-multitenant.md §7): mecanismo de tenant
    // scoping reutilizable (TenantContextService + interceptor global).
    // Global, así que no hace falta re-importarlo en cada módulo de dominio.
    TenantModule,
    UsersModule,
    RolesModule,
    TokensModule,
    AuthModule,
    PermissionsModule,
    StreamsModule,
    CamerasModule,
    DetectionsModule,
    VehiclesModule,
    WorkersModule,
    FamiliesModule,
    UnitsModule,
    VisitsModule,
    NotificationsModule,
    DigitalConciergeModule,
    AuditModule,
    LogsModule,
    DashboardModule,
    HubModule,
    AnomaliesModule,
    OnboardingModule,
    AgentModule,
    // Fase 4 · P7.R: retención diaria y supresión (Ley 21.719).
    PrivacyModule,
  ],
  controllers: [],
  providers: [DataInitializationService, ExpirationService],
})
export class AppModule {}
