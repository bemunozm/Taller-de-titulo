import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CamerasService } from './cameras.service';
import { WorkerNotifierService } from 'src/workers/worker-notifier.service';
import { CamerasController } from './cameras.controller';
import { Camera } from './entities/camera.entity';
import { Role } from 'src/roles/entities/role.entity';
import { CameraViewGuard } from './guards/camera-view.guard';
import { MediamtxModule } from 'src/mediamtx/mediamtx.module';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users/users.module';
import { MediamtxSyncService } from './mediamtx-sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Camera, Role]),
    MediamtxModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [CamerasController],
  // Fase 4 · P6.M: MediamtxSyncService re-registra las cámaras al arrancar y
  // cuando MediaMTX se reinicia (sus paths viven en memoria).
  providers: [
    CamerasService,
    CameraViewGuard,
    WorkerNotifierService,
    MediamtxSyncService,
  ],
  exports: [CameraViewGuard, CamerasService, WorkerNotifierService],
})
export class CamerasModule {}
