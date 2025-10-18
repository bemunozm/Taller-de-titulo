import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CamerasService } from './cameras.service';
import { CamerasController } from './cameras.controller';
import { Camera } from './entities/camera.entity';
import { Role } from 'src/roles/entities/role.entity';
import { CameraViewGuard } from './guards/camera-view.guard';
import { MediamtxModule } from 'src/mediamtx/mediamtx.module';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Camera, Role]), MediamtxModule, AuthModule, UsersModule],
  controllers: [CamerasController],
  providers: [CamerasService, CameraViewGuard],
  exports: [CameraViewGuard, CamerasService],
})
export class CamerasModule {}
