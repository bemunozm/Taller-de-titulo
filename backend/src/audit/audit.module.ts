import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuthAuditSinkRegistrar } from './auth-audit-sink.registrar';
import { AuditController } from './audit.controller';
import { AuditLog } from './entities/audit-log.entity';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { OrganizationMembershipModule } from '../organization-membership/organization-membership.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
    OrganizationMembershipModule,
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    // Fase 4 · P4.B: auditoría de login de better-auth (fuera de DI).
    AuthAuditSinkRegistrar,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
