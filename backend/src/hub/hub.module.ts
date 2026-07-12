import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { HubGateway } from './hub.gateway';
import { Hub } from './entities/hub.entity';
import { HubAuthGuard } from './guards/hub-auth.guard';
import { HubController } from './hub.controller';
import { HubsService } from './hub.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Hub]),
    ConfigModule,
    // Fase 1, Bloque A1.1 — provee AuthGuard/AuthorizationGuard para
    // HubController (`@UseGuards(AuthGuard, AuthorizationGuard)` por
    // referencia de clase, provisioning humano con RBAC — sin relación con
    // HubAuthGuard, que son credenciales de máquina del hub físico). Se
    // importa `UsersModule` explícitamente además de `AuthModule` porque
    // `AuthGuard` depende de `UserRepository`: mismo patrón exacto que
    // `OnboardingModule` (también usa `@UseGuards(AuthGuard,
    // AuthorizationGuard)` por clase) — sin este import directo, Nest no
    // resuelve `UserRepository` en el contexto de este módulo
    // (UnknownDependenciesException) aunque `AuthModule` ya la declare.
    UsersModule,
    AuthModule,
  ],
  controllers: [HubController],
  providers: [HubGateway, HubAuthGuard, HubsService],
  // Re-exporta `TypeOrmModule` (no solo `HubAuthGuard`): otros módulos que
  // usan `@UseGuards(HubAuthGuard)` por referencia de clase (p.ej.
  // UnitsController en GET /units/ai-enabled) necesitan que `HubRepository`
  // (registrado acá vía `TypeOrmModule.forFeature([Hub])`) también sea
  // visible en su propio contexto — mismo motivo por el que HubModule mismo
  // necesitó importar `UsersModule` directamente para `AuthGuard`.
  exports: [TypeOrmModule, HubGateway, HubAuthGuard, HubsService],
})
export class HubModule {}
