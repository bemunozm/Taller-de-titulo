import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediamtxService } from './mediamtx.service';
import { MediamtxController } from './mediamtx.controller';
import { MediamtxAuthController } from './auth/mediamtx-auth.controller';
import { MediamtxAuthService } from './auth/mediamtx-auth.service';
import { Camera } from '../cameras/entities/camera.entity';
import { User } from '../users/entities/user.entity';

/**
 * Fase 4 · P6.M (D14): además del cliente de la Control API, el módulo
 * expone el endpoint interno de autorización de MediaMTX
 * (`MediamtxAuthController`, lee `Camera` por repositorio para no depender de
 * `CamerasModule`, que importa este módulo) y protege `GET /mediamtx/health`
 * con `AuthGuard` + `AuthorizationGuard` (necesitan el repositorio de `User`).
 */
@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Camera, User])],
  providers: [MediamtxService, MediamtxAuthService],
  controllers: [MediamtxController, MediamtxAuthController],
  exports: [MediamtxService],
})
export class MediamtxModule {}
