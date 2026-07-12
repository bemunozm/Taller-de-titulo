import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnomalyEvent } from './entities/anomaly-event.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { AnomaliesService } from './anomalies.service';
import { AnomaliesController } from './anomalies.controller';
import { VisionAnalysisService } from './services/vision-analysis.service';
import { HubModule } from '../hub/hub.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnomalyEvent, Camera]),
    HubModule,
    NotificationsModule,
  ],
  controllers: [AnomaliesController],
  providers: [AnomaliesService, VisionAnalysisService],
  exports: [AnomaliesService],
})
export class AnomaliesModule {}
