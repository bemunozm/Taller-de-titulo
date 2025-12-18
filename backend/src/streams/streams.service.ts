import { Injectable, Logger, InternalServerErrorException, Inject, Optional, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { AxiosResponse } from 'axios';
import { LogsService } from '../logs/logs.service';
import { LogLevel, LogType, ServiceName } from '../logs/entities/system-log.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StreamsService {
  private readonly logger = new Logger(StreamsService.name);
  private mediamtxUrl = process.env.MEDIAMTX_URL || 'http://mediamtx:8889';

  constructor(
    private readonly httpService: HttpService,
    private readonly logsService: LogsService,
    @Optional() @Inject('CamerasService') private readonly camerasService?: any,
  ) {}

  /**
   * Reenvía una oferta SDP al endpoint WHEP de MediaMTX y devuelve la respuesta SDP
   * @param offerSdp la oferta SDP (string)
   * @param cameraMount identificador de cámara (mountPath o id), p. ej. live/cam1
   */
  async forwardOfferToMediaMtx(offerSdp: string, cameraMount: string): Promise<string> {
    if (!cameraMount || typeof cameraMount !== 'string') {
      this.logger.warn('Se indicó un cameraMount inválido');
      throw new BadRequestException('cameraMount debe ser una cadena no vacía');
    }

    const correlationId = uuidv4();
    const startTime = Date.now();

  // Resolver metadatos mediante CamerasService; cameraMount puede ser mountPath o id
    const fallbackPath = cameraMount.replace(/^\/+/g, '');
    let mountPath = fallbackPath;
    let decryptedSource: string | null = null;
    try {
      if (this.camerasService) {
        mountPath = await this.camerasService.getMountPath(cameraMount);
        decryptedSource = await this.camerasService.getDecryptedSourceUrl(cameraMount);
      }
    } catch (err) {
      this.logger.warn(`No se pudo resolver metadata de la cámara '${cameraMount}': ${err?.message || err}`);
      mountPath = fallbackPath;
    }

    const normalizedCameraId = (mountPath || fallbackPath).replace(/^\/+/, '');
    const safePath = normalizedCameraId.split('/').map((seg) => encodeURIComponent(seg)).join('/');
    const url = `${this.mediamtxUrl.replace(/\/$/, '')}/${safePath}/whep`;

    // Registrar sin revelar la URL desencriptada
  this.logger.log(`Reenviando oferta a MediaMTX: ${url} (cameraMount=${cameraMount}) [${correlationId}]`);
    try {
      const observable = this.httpService.post(url, offerSdp, {
        headers: { 'Content-Type': 'application/sdp' },
        responseType: 'text',
      });
      const withTimeout = observable.pipe(timeout(10000));
      const resp: AxiosResponse<string> = await lastValueFrom(withTimeout as any);
      
      const responseTime = Date.now() - startTime;
      
      if (!resp || typeof resp.data !== 'string') {
        this.logger.error(`MediaMTX devolvió una respuesta SDP vacía o inválida [${correlationId}]`);
        
        await this.logsService.log({
          level: LogLevel.ERROR,
          message: 'MediaMTX returned invalid SDP response',
          type: LogType.MEDIAMTX_API,
          service: ServiceName.MEDIAMTX,
          metadata: { cameraMount, mountPath, responseTime },
          correlationId,
        });
        
        throw new InternalServerErrorException('Respuesta inválida del gateway de medios');
      }
      
      this.logger.log(`MediaMTX respondió ${resp.status} [${correlationId}]`);
      
      // Log exitoso de negociación WHEP
      await this.logsService.log({
        level: LogLevel.INFO,
        message: 'WHEP negotiation successful',
        type: LogType.MEDIAMTX_API,
        service: ServiceName.MEDIAMTX,
        metadata: { cameraMount, mountPath, status: resp.status, responseTime },
        correlationId,
      });
      
      return resp.data as string;
    } catch (err: any) {
      const responseTime = Date.now() - startTime;
      
      this.logger.error(`Error al contactar MediaMTX: ${err?.message || err} [${correlationId}]`);
      
      // Log de error en negociación WHEP
      await this.logsService.log({
        level: LogLevel.ERROR,
        message: 'WHEP negotiation failed',
        type: LogType.MEDIAMTX_API,
        service: ServiceName.MEDIAMTX,
        metadata: { cameraMount, mountPath, responseTime, error: err?.message || String(err) },
        correlationId,
      });
      
      throw new InternalServerErrorException('Error negociando con el gateway de medios');
    }
  }
}
