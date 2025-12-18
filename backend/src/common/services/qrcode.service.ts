import { Injectable, Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';

/**
 * Servicio para generar códigos QR
 */
@Injectable()
export class QRCodeService {
  private readonly logger = new Logger(QRCodeService.name);

  /**
   * Genera un QR code como data URL (base64)
   * @param data Datos a codificar en el QR
   * @returns Data URL del QR code (data:image/png;base64,...)
   */
  async generateQRDataURL(data: any): Promise<string> {
    try {
      const qrString = JSON.stringify(data);

      const qrDataUrl = await QRCode.toDataURL(qrString, {
        errorCorrectionLevel: 'H', // Alto nivel de corrección de errores
        type: 'image/png',
        margin: 1,
        width: 300,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });

      this.logger.debug(`QR code generado para datos:`, data);
      return qrDataUrl;
    } catch (error) {
      this.logger.error('Error al generar QR code:', error);
      throw new Error('No se pudo generar el código QR');
    }
  }

  /**
   * Genera un QR code como buffer (útil para guardar como archivo)
   * @param data Datos a codificar
   * @returns Buffer con la imagen PNG
   */
  async generateQRBuffer(data: any): Promise<Buffer> {
    try {
      const qrString = JSON.stringify(data);

      const buffer = await QRCode.toBuffer(qrString, {
        errorCorrectionLevel: 'H',
        type: 'png',
        margin: 1,
        width: 300,
      });

      return buffer;
    } catch (error) {
      this.logger.error('Error al generar QR buffer:', error);
      throw new Error('No se pudo generar el código QR');
    }
  }

  /**
   * Genera un QR code para una visita
   * @param visitId ID de la visita
   * @param action Acción: 'checkin' o 'checkout'
   * @returns Data URL del QR
   */
  async generateVisitQR(visitId: string, action: 'checkin' | 'checkout' = 'checkout'): Promise<string> {
    const qrData = {
      type: 'visit',
      visitId,
      action,
      timestamp: new Date().toISOString(),
    };

    return this.generateQRDataURL(qrData);
  }
}
