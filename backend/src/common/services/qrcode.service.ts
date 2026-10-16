import { Injectable, Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { errorMessage } from '../utils/error-message.util';

/** Opciones de render comunes a todos los QR (PNG, corrección de errores alta). */
const QR_RENDER_OPTIONS = {
  errorCorrectionLevel: 'H',
  margin: 1,
  width: 300,
} as const;

/**
 * Servicio para generar códigos QR.
 *
 * El contenido de un QR de acceso es una credencial: nunca se registra en los
 * logs.
 */
@Injectable()
export class QRCodeService {
  private readonly logger = new Logger(QRCodeService.name);

  /**
   * QR de acceso de una visita como data URL (`data:image/png;base64,...`).
   *
   * Codifica `qrCode` TAL CUAL (sin JSON): es el valor que muestra
   * `QRCodeModal` en el frontend y el que busca el escáner del guardia
   * (`GET /visits/qr/:qrCode`). Un QR con otro contenido no encuentra la
   * visita.
   */
  async generateAccessQR(qrCode: string): Promise<string> {
    try {
      return await QRCode.toDataURL(qrCode, {
        ...QR_RENDER_OPTIONS,
        type: 'image/png',
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch (error) {
      this.logger.error(
        `Error al generar el QR de acceso: ${errorMessage(error)}`,
      );
      throw new Error('No se pudo generar el código QR');
    }
  }

  /**
   * QR con `data` serializado en JSON, como data URL (base64).
   */
  async generateQRDataURL(data: unknown): Promise<string> {
    try {
      return await QRCode.toDataURL(JSON.stringify(data), {
        ...QR_RENDER_OPTIONS,
        type: 'image/png',
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch (error) {
      this.logger.error(`Error al generar QR code: ${errorMessage(error)}`);
      throw new Error('No se pudo generar el código QR');
    }
  }

  /**
   * QR con `data` serializado en JSON, como buffer PNG (útil para guardarlo
   * como archivo).
   */
  async generateQRBuffer(data: unknown): Promise<Buffer> {
    try {
      return await QRCode.toBuffer(JSON.stringify(data), {
        ...QR_RENDER_OPTIONS,
        type: 'png',
      });
    } catch (error) {
      this.logger.error(`Error al generar QR buffer: ${errorMessage(error)}`);
      throw new Error('No se pudo generar el código QR');
    }
  }
}
