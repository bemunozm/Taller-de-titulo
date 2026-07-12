import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { DetectionsService } from './detections.service';
import { DetectionsController } from './detections.controller';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { VisitsModule } from '../visits/visits.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { HubModule } from '../hub/hub.module';

@Module({
  imports: [
    // `Camera` se agrega (tarea #19, docs/modulos/auth-multitenant.md §7) para
    // resolver el `organizationId` de la cámara asociada a cada detección
    // (resource-derived — el worker LPR no manda sesión de usuario). Solo se
    // usa read-only vía repository, no se importa CamerasModule completo para
    // evitar acoplar módulos.
    TypeOrmModule.forFeature([PlateDetection, AccessAttempt, Camera]),
    VehiclesModule,
    NotificationsModule,
    UsersModule,
    HubModule,
    forwardRef(() => VisitsModule),
  ],
  providers: [
    DetectionsService,
  ],
  controllers: [DetectionsController],
  exports: [DetectionsService],
})
export class DetectionsModule {}
