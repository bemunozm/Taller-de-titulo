import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PlateDetection } from '../detections/entities/plate-detection.entity';
import { Visit } from '../visits/entities/visit.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { User } from '../users/entities/user.entity';
import { Family } from '../families/entities/family.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { SystemLog } from '../logs/entities/system-log.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlateDetection,
      Visit,
      Camera,
      User,
      Family,
      AuditLog,
      SystemLog,
      Vehicle,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
