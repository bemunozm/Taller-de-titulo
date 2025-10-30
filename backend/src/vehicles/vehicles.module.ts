import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle]), UsersModule],
  providers: [VehiclesService],
  controllers: [VehiclesController],
  exports: [VehiclesService],
})
export class VehiclesModule {}
