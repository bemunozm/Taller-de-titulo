import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { TokensModule } from './tokens/tokens.module';
import { AuthModule } from './auth/auth.module';
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
      synchronize: true, // no usar en produccion
    }),
    TypeOrmModule.forFeature([Role, Permission, AccessAttempt, Notification, Visit]),
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
  ],
  controllers: [],
  providers: [DataInitializationService, ExpirationService],
})
export class AppModule {}
