import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnomalyEvent } from './entities/anomaly-event.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { AnomaliesService } from './anomalies.service';
import { AnomaliesController } from './anomalies.controller';
import { VisionAnalysisService } from './services/vision-analysis.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    // User: repositorio de AuthGuard/AuthorizationGuard (`GET /anomalies`
    // con sesión humana, Fase 4 · P5.C).
    TypeOrmModule.forFeature([AnomalyEvent, Camera, User]),
    // Fase 4 · P6.R: sin HubModule (`HubGateway` estaba inyectado sin uso).
    NotificationsModule,
  ],
  controllers: [AnomaliesController],
  providers: [AnomaliesService, VisionAnalysisService],
  exports: [AnomaliesService],
})
export class AnomaliesModule {}
