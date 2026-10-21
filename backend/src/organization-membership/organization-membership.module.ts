import { Module } from '@nestjs/common';
import { OrganizationMembershipService } from './organization-membership.service';

/**
 * Membresías de condominio (Fase 4 · P5, D11). Sin imports: usa el
 * `DataSource` de TypeORM y el `AuthService` de better-auth, que son globales
 * (app.module.ts). Lo importan los módulos que crean o consultan membresías
 * (usuarios, onboarding, auditoría).
 */
@Module({
  providers: [OrganizationMembershipService],
  exports: [OrganizationMembershipService],
})
export class OrganizationMembershipModule {}
