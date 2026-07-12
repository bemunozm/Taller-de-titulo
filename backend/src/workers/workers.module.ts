import { Module } from '@nestjs/common';
import { WorkerNotifierService } from './worker-notifier.service';
import { WorkersController } from './workers.controller';
import { UsersModule } from '../users/users.module';

@Module({
  // UsersModule (tarea #21): WorkersController ahora usa `AuthGuard` en
  // GET ia-health, que inyecta @InjectRepository(User) — UsersModule exporta
  // TypeOrmModule.forFeature([User]).
  imports: [UsersModule],
  providers: [WorkerNotifierService],
  controllers: [WorkersController],
  exports: [WorkerNotifierService],
})
export class WorkersModule {}
