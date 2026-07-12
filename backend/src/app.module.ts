import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { TokensModule } from './tokens/tokens.module';
import { AuthModule } from './auth/auth.module';
import { auth } from './auth/better-auth';
import { PermissionsModule } from './permissions/permissions.module';
import { StreamsModule } from './streams/streams.module';
import { DataInitializationService } from './common/services/data-initialization.service';
import { ExpirationService } from './common/services/expiration.service';
import { Role } from './roles/entities/role.entity';
import { Permission } from './permissions/entities/permission.entity';
import { AccessAttempt } from './detections/entities/access-attempt.entity';
import { Notification } from './notifications/entities/notification.entity';
import { Visit } from './visits/entities/visit.entity';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // Carga las variables de entorno y las hace globales
    ScheduleModule.forRoot(), // Habilita las tareas programadas
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true, // Carga automaticamente las entidades
      // Tarea #21 (hardening): `synchronize: true` en producción puede alterar
      // el schema de forma destructiva en cada arranque (drop/recreate de
      // columnas, pérdida de datos) — solo debe usarse en dev. Producción
      // necesita migraciones reales de TypeORM (`typeorm migration:generate` +
      // `migration:run`), que hoy NO existen en este repo — son prerequisito
      // antes de desplegar con NODE_ENV=production (ver reporte de la tarea).
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    TypeOrmModule.forFeature([Role, Permission, AccessAttempt, Notification, Visit]),
    // POC Fase 0 (docs/modulos/auth-multitenant.md): better-auth montado EN
    // PARALELO al AuthModule propio (JWT+RBAC, sigue intacto más abajo).
    // `disableGlobalAuthGuard: true` es CRÍTICO: sin esto la librería registra
    // su AuthGuard como guard global (APP_GUARD) y protegería/rompería TODAS
    // las rutas existentes, que hoy usan su propio guard. Con el guard global
    // deshabilitado, better-auth solo expone sus endpoints (/api/auth/*) y no
    // interfiere con el resto de la API.
    BetterAuthModule.forRoot({ auth, disableGlobalAuthGuard: true }),
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
  ],
  controllers: [],
  providers: [DataInitializationService, ExpirationService],
})
export class AppModule {}
