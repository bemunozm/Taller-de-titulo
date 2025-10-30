import { Module } from '@nestjs/common';
import { WorkerNotifierService } from './worker-notifier.service';
import { WorkersController } from './workers.controller';

@Module({
  providers: [WorkerNotifierService],
  controllers: [WorkersController],
  exports: [WorkerNotifierService],
})
export class WorkersModule {}
