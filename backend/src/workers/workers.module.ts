import { Module } from '@nestjs/common';
import { WorkerNotifierService } from './worker-notifier.service';
import { WorkersController } from './workers.controller';
import { UsersModule } from '../users/users.module';
import { CamerasModule } from '../cameras/cameras.module';

@Module({
  // UsersModule (tarea #21): WorkersController ahora usa `AuthGuard` en
  // GET ia-health, que inyecta @InjectRepository(User) — UsersModule exporta
  // TypeOrmModule.forFeature([User]).
  // CamerasModule: GET /workers/cameras* reutiliza CamerasService (listado y
  // descifrado acotados por organización) con ServiceApiKeyGuard.
  imports: [UsersModule, CamerasModule],
  providers: [WorkerNotifierService],
  controllers: [WorkersController],
  exports: [WorkerNotifierService],
})
export class WorkersModule {}
