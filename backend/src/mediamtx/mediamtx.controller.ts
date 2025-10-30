import { Controller, Get } from '@nestjs/common';
import { MediamtxService } from './mediamtx.service';

@Controller('mediamtx')
export class MediamtxController {
  constructor(private readonly mediamtxService: MediamtxService) {}

  @Get('health')
  async getHealth() {
  const res: any = (await this.mediamtxService.getHealth()) || { ok: false, status: 'unavailable' };

    const base = {
      ok: !!res.ok,
      status: res.status,
      message: res.message ?? null,
    } as any;

    // Normalize details: extract version and started (and compute uptime) when available
    if (res.details) {
      const d: any = res.details;
      const version = d.version ?? d.Version ?? null;
      const startedRaw = d.started ?? d.Started ?? d.started_at ?? null;
      let startedIso: string | null = null;
      let uptimeSeconds: number | null = null;
      if (startedRaw) {
        const parsed = Date.parse(String(startedRaw));
        if (!isNaN(parsed)) {
          startedIso = new Date(parsed).toISOString();
          uptimeSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
        }
      }

      return {
        ...base,
        version,
        started: startedIso ?? startedRaw,
        uptimeSeconds,
        // keep original parsed/raw details for debugging clients
        details: d.raw ?? d,
      };
    }

    return { ...base, details: null };
  }
}
