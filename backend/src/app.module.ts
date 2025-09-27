import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { TokensModule } from './tokens/tokens.module';
import { AuthModule } from './auth/auth.module';
import { PermissionsModule } from './permissions/permissions.module';
import { DataInitializationService } from './common/services/data-initialization.service';
import { CleanupService } from './common/services/cleanup.service';
import { Role } from './roles/entities/role.entity';
import { Permission } from './permissions/entities/permission.entity';

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
    TypeOrmModule.forFeature([Role, Permission]),
    UsersModule,
    RolesModule,
    TokensModule,
    AuthModule,
    PermissionsModule,
  ],
  controllers: [],
  providers: [DataInitializationService, CleanupService],
})
export class AppModule {}
