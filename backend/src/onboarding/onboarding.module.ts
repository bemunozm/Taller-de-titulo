import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { Role } from '../roles/entities/role.entity';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Onboarding / multi-tenant (Fase 0, tarea #19 —
 * docs/modulos/auth-multitenant.md §7b).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Role]), UsersModule, AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
