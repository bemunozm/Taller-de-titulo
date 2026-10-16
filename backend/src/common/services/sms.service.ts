import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { maskPhone, scrubPiiInText } from '../privacy/pii-mask';
import { errorMessage } from '../utils/error-message.util';
import { parseBooleanFlag } from '../../config/env.validation';
import { escapeHtml, safeHttpUrl } from '../utils/escape-html.util';

/**
 * Dominio al que se manda el "SMS": Mailtrap convierte `sms+<número>@...` en
 * un SMS de prueba. Es un sandbox, no un proveedor de SMS real.
 */
export const SMS_GATEWAY_DOMAIN = 'sandbox.mailtrap.io';

/** Dominios de sandbox (el mensaje no llega a un teléfono real). */
const SANDBOX_SMS_DOMAINS: ReadonlySet<string> = new Set([
  'sandbox.mailtrap.io',
]);

/** ¿El destino del "SMS" es un sandbox de pruebas? */
export function isSandboxSmsDomain(domain: string): boolean {
  return SANDBOX_SMS_DOMAINS.has(domain.toLowerCase());
}

/**
 * Servicio para enviar SMS usando Mailtrap
 * Mailtrap soporta SMS testing en sandbox
 *
 * Corrección P7 (cyber B6, decisión de Nova): detrás de
 * `VISITOR_QR_SMS_ENABLED` (default `false`, validado en
 * config/env.validation.ts). El "SMS" es un email al sandbox de Mailtrap que
 * lleva el teléfono del visitante y el QR (una credencial de acceso).
 * Apagado: no se envía nada ni se registra el teléfono (ni enmascarado).
 * Encendido: el comportamiento de siempre, con logs enmascarados y un `warn`
 * en cada envío a un sandbox.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {
    this.enabled = parseBooleanFlag(
      'VISITOR_QR_SMS_ENABLED',
      this.configService.get<string>('VISITOR_QR_SMS_ENABLED'),
      false,
    );
  }

  /** ¿Está habilitado el envío del QR por "SMS" (`VISITOR_QR_SMS_ENABLED`)? */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Envía un SMS con un QR code adjunto (simulado como imagen)
   * @param phone Número de teléfono del destinatario (formato: +56912345678)
   * @param visitorName Nombre del visitante
   * @param qrDataUrl QR code en formato data URL (base64)
   * @param visitId ID de la visita
   * @returns `true` si se envió; `false` si el envío está desactivado.
   */
  async sendQRCodeSMS(params: {
    phone: string;
    visitorName: string;
    qrDataUrl: string;
    visitId: string;
  }): Promise<boolean> {
    const { phone, visitorName, qrDataUrl, visitId } = params;

    if (!this.enabled) {
      this.logger.debug(
        `Envío del QR por SMS desactivado (VISITOR_QR_SMS_ENABLED): visita ${visitId}`,
      );
      return false;
    }

    try {
      // Fase 4 · P7.L: sin el nombre del visitante y con el teléfono
      // enmascarado (docs/modulos/privacidad-ley-21719.md §3).
      this.logger.log(
        `📱 Enviando QR por SMS a ${maskPhone(phone)} (visita ${visitId})`,
      );
      this.warnIfSandbox(`el QR de la visita ${visitId}`);

      // Normalizar número de teléfono (remover espacios y caracteres especiales)
      const normalizedPhone = this.normalizePhoneNumber(phone);

      // En producción, aquí usarías una API real de SMS (Twilio, AWS SNS, etc.)
      // Para desarrollo, Mailtrap permite simular SMS enviando emails
      const message = this.generateSMSMessageTemplate(visitorName, visitId);

      // Simular SMS mediante email a Mailtrap
      // En producción, esto se reemplazaría con una API de SMS real
      await this.mailerService.sendMail({
        to: `sms+${normalizedPhone}@${SMS_GATEWAY_DOMAIN}`, // Formato especial de Mailtrap para SMS
        subject: `QR de Visita - Condominio San Lorenzo`,
        html: message,
        attachments: [
          {
            filename: `qr-visita-${visitId}.png`,
            content: qrDataUrl.split('base64,')[1], // Extraer solo la parte base64
            encoding: 'base64',
            cid: 'qr-code', // Content ID para referenciar en el HTML
          },
        ],
      });

      this.logger.log(
        `✅ SMS/QR enviado exitosamente a ${maskPhone(normalizedPhone)} (visita ${visitId})`,
      );
      return true;
    } catch (error) {
      // Solo el mensaje (enmascarado): el error del transporte de correo
      // puede repetir el destinatario (`sms+<teléfono>@...`).
      this.logger.error(
        `❌ Error al enviar SMS a ${maskPhone(phone)} (visita ${visitId}): ${scrubPiiInText(errorMessage(error))}`,
      );
      throw error;
    }
  }

  /**
   * Normaliza el número de teléfono
   * Elimina espacios, guiones y caracteres especiales
   * Agrega +56 si es un número chileno sin código de país
   */
  private warnIfSandbox(what: string): void {
    if (isSandboxSmsDomain(SMS_GATEWAY_DOMAIN)) {
      this.logger.warn(
        `El "SMS" con ${what} va a un sandbox (${SMS_GATEWAY_DOMAIN}), no a un teléfono real`,
      );
    }
  }

  private normalizePhoneNumber(phone: string): string {
    // Remover espacios, guiones, paréntesis
    let normalized = phone.replace(/[\s\-()]/g, '');

    // Si empieza con 9 y tiene 9 dígitos, es un celular chileno sin código
    if (/^9\d{8}$/.test(normalized)) {
      normalized = `+56${normalized}`;
    }

    // Si no tiene +, agregarlo
    if (!normalized.startsWith('+')) {
      normalized = `+${normalized}`;
    }

    return normalized;
  }

  /**
   * Genera el template del mensaje SMS/Email
   */
  private generateSMSMessageTemplate(
    visitorName: string,
    visitId: string,
  ): string {
    // Escapados: el nombre lo dicta el visitante por voz.
    const frontendUrl = safeHttpUrl(
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173',
    );
    const safeVisitorName = escapeHtml(visitorName);
    const safeVisitId = escapeHtml(visitId);

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px 20px;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: bold;
          }
          .content {
            padding: 40px 20px;
            text-align: center;
          }
          .greeting {
            font-size: 20px;
            color: #333;
            margin-bottom: 20px;
          }
          .message {
            font-size: 16px;
            color: #666;
            line-height: 1.6;
            margin-bottom: 30px;
          }
          .qr-container {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 30px;
            margin: 30px 0;
          }
          .qr-code {
            max-width: 250px;
            height: auto;
            margin: 0 auto;
            display: block;
          }
          .instructions {
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
            border-radius: 4px;
          }
          .instructions h3 {
            margin: 0 0 10px 0;
            color: #1976d2;
            font-size: 16px;
          }
          .instructions ul {
            margin: 0;
            padding-left: 20px;
            color: #555;
            font-size: 14px;
          }
          .instructions li {
            margin: 8px 0;
          }
          .footer {
            background: #f8f9fa;
            padding: 20px;
            text-align: center;
            color: #666;
            font-size: 12px;
          }
          .visit-id {
            font-size: 12px;
            color: #999;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏢 Condominio San Lorenzo</h1>
            <p style="margin: 5px 0 0 0; font-size: 16px;">Sistema de Control de Acceso</p>
          </div>
          
          <div class="content">
            <div class="greeting">
              ¡Hola ${safeVisitorName}! 👋
            </div>
            
            <div class="message">
              Tu visita ha sido <strong style="color: #4caf50;">autorizada</strong>. 
              Usa el siguiente código QR para <strong>registrar tu salida</strong> del condominio.
            </div>
            
            <div class="qr-container">
              <p style="color: #666; margin: 0 0 15px 0; font-size: 14px;">
                Escanea este código QR al salir
              </p>
              <img src="cid:qr-code" alt="QR Code" class="qr-code" />
            </div>
            
            <div class="instructions">
              <h3>📋 Instrucciones:</h3>
              <ul>
                <li><strong>Al ingresar:</strong> Ya has sido autorizado, puedes ingresar directamente.</li>
                <li><strong>Al salir:</strong> Escanea este código QR en el punto de control de salida.</li>
                <li><strong>Guarda este mensaje:</strong> Tendrás acceso al QR cuando lo necesites.</li>
              </ul>
            </div>
            
            <div style="margin-top: 30px; padding: 15px; background: #fff3cd; border-radius: 8px; border: 1px solid #ffc107;">
              <p style="margin: 0; color: #856404; font-size: 14px;">
                ⚠️ <strong>Importante:</strong> Este QR es personal e intransferible.
              </p>
            </div>
            
            <div class="visit-id">
              ID de Visita: ${safeVisitId}
            </div>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">Condominio San Lorenzo - Sistema Automatizado</p>
            <p style="margin: 5px 0 0 0;">
              <a href="${frontendUrl}" style="color: #667eea; text-decoration: none;">
                ${frontendUrl}
              </a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Envía un SMS de texto simple (sin QR)
   */
  async sendSimpleSMS(phone: string, message: string): Promise<boolean> {
    // Corrección P7 (cyber B6): mismo interruptor que el QR.
    if (!this.enabled) {
      this.logger.debug('Envío de SMS desactivado (VISITOR_QR_SMS_ENABLED)');
      return false;
    }
    try {
      const normalizedPhone = this.normalizePhoneNumber(phone);
      this.warnIfSandbox('un SMS simple');

      await this.mailerService.sendMail({
        to: `sms+${normalizedPhone}@${SMS_GATEWAY_DOMAIN}`,
        subject: 'Condominio San Lorenzo',
        text: message,
      });

      this.logger.log(`✅ SMS simple enviado a ${maskPhone(normalizedPhone)}`);
      return true;
    } catch (error) {
      this.logger.error(
        `❌ Error al enviar SMS a ${maskPhone(phone)}: ${scrubPiiInText(errorMessage(error))}`,
      );
      throw error;
    }
  }
}
