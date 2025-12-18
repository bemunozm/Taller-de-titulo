import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FamiliesController } from './families.controller';
import { FamiliesService } from './families.service';
import { Family } from './entities/family.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { UnitsModule } from '../units/units.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Family, User]),
    NotificationsModule,
    UnitsModule,
  ],
  controllers: [FamiliesController],
  providers: [FamiliesService],
  exports: [FamiliesService],
})
export class FamiliesModule {}