import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import { DetectionsService } from './detections.service';
import { DetectionsController } from './detections.controller';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { VisitsModule } from '../visits/visits.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { HubModule } from '../hub/hub.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlateDetection, AccessAttempt]), 
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
