import { Injectable, Logger, InternalServerErrorException, Inject, Optional, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { AxiosResponse } from 'axios';

@Injectable()
export class StreamsService {
  private readonly logger = new Logger(StreamsService.name);
  private mediamtxUrl = process.env.MEDIAMTX_URL || 'http://mediamtx:8889';

  constructor(private readonly httpService: HttpService,
    @Optional() @Inject('CamerasService') private readonly camerasService?: any) {}

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
  this.logger.log(`Reenviando oferta a MediaMTX: ${url} (cameraMount=${cameraMount})`);
    try {
      const observable = this.httpService.post(url, offerSdp, {
        headers: { 'Content-Type': 'application/sdp' },
        responseType: 'text',
      });
      const withTimeout = observable.pipe(timeout(10000));
      const resp: AxiosResponse<string> = await lastValueFrom(withTimeout as any);
      if (!resp || typeof resp.data !== 'string') {
        this.logger.error('MediaMTX devolvió una respuesta SDP vacía o inválida');
        throw new InternalServerErrorException('Respuesta inválida del gateway de medios');
      }
      this.logger.log(`MediaMTX respondió ${resp.status}`);
      return resp.data as string;
    } catch (err: any) {
      this.logger.error(`Error al contactar MediaMTX: ${err?.message || err}`);
      throw new InternalServerErrorException('Error negociando con el gateway de medios');
    }
  }
}
