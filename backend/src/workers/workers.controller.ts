import { Controller, Get } from '@nestjs/common';
import { WorkerNotifierService } from './worker-notifier.service';

@Controller('workers')
export class WorkersController {
  constructor(private readonly workerNotifier: WorkerNotifierService) {}

  @Get('ia-health')
  async getIaHealth() {
    const res = await this.workerNotifier.getHealth();
    // Normalizamos la respuesta para el frontend
    return {
      ok: !!res.ok,
      status: res.status,
      details: res.details ?? null,
      message: res.message ?? null,
    };
  }
}
