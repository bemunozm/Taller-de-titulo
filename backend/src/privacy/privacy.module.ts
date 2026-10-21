import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { DisabledUserAnonymizer } from './disabled-user-anonymizer.service';
import { ErasureRepository } from './erasure.repository';
import { MediaPurgerService } from './media-purger.service';
import { PrivacyErasureService } from './privacy-erasure.service';
import { PrivacyController } from './privacy.controller';
import { RetentionRepository } from './retention.repository';
import { RetentionService } from './retention.service';

/**
 * Fase 4 · P7.R (Ley 21.719, docs/modulos/privacidad-ley-21719.md §3/§4):
 * retención diaria (`RetentionService`) y supresión por la administración
 * (`POST /privacy/erasure`). La exportación del titular
 * (`GET /auth/me/data-export`) vive en `AuthController` con
 * `DataExportService` (provisto por `AuthModule`).
 */
@Module({
  imports: [
    // User: repositorio de AuthGuard/AuthorizationGuard.
    TypeOrmModule.forFeature([User]),
    CloudinaryModule,
    UsersModule,
    AuditModule,
  ],
  controllers: [PrivacyController],
  providers: [
    RetentionRepository,
    ErasureRepository,
    MediaPurgerService,
    DisabledUserAnonymizer,
    RetentionService,
    PrivacyErasureService,
  ],
})
export class PrivacyModule {}
