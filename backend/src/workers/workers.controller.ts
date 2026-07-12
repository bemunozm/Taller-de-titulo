import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { WorkerNotifierService } from './worker-notifier.service';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('Workers')
@Controller('workers')
export class WorkersController {
  constructor(private readonly workerNotifier: WorkerNotifierService) {}

  /**
   * Tarea #21 (docs/modulos/auth-multitenant.md §11+, hardening de ingesta
   * LPR): el audit original agrupó este endpoint junto a los de ingesta
   * (POST plates/attempts, POST/GET anomalies) porque hoy tampoco tiene
   * guard. A DIFERENCIA de esos, este endpoint NO lo llama el worker LPR —
   * lo consume el FRONTEND (CamerasPanel.tsx vía CameraAPI.getIAHealth) con
   * sesión de usuario humano (JWT/cookie), para mostrar el estado del worker
   * IA en el panel de cámaras. Protegerlo con ServiceApiKeyGuard rompería esa
   * pantalla (el frontend no manda x-api-key). Se protege en su lugar con
   * `AuthGuard` (mismo guard dual-mode que el resto de la API autenticada) —
   * cierra el acceso anónimo sin requerir un permiso específico (ningún rol
   * salvo "Desarrollador" tiene hoy `workers.read`, y ese permiso no está
   * cableado a este endpoint — ver default-roles.constant.ts).
   */
  @Get('ia-health')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Estado del worker IA', description: 'Requiere sesión de usuario autenticado.' })
  @ApiResponse({ status: 200, description: 'Estado del worker IA' })
  @ApiUnauthorizedResponse({ description: 'Sesión/token inválido, expirado o ausente' })
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
