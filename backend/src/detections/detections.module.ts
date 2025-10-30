import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import { DetectionsService } from './detections.service';
import { DetectionsController } from './detections.controller';
import { VehiclesModule } from '../vehicles/vehicles.module';

@Module({
  imports: [TypeOrmModule.forFeature([PlateDetection, AccessAttempt]), VehiclesModule],
  providers: [DetectionsService],
  controllers: [DetectionsController],
  exports: [DetectionsService],
})
export class DetectionsModule {}
