import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

interface IEmailData {
    email: string;
    name: string;
    token: string;
}

@Injectable()
export class AuthEmailService {
    constructor(
        private readonly mailerService: MailerService,
        private readonly configService: ConfigService
    ) {}

    async sendConfirmationEmail(user: IEmailData): Promise<void> {
        try {
            console.log('Intentando enviar email a:', user.email);
            console.log('SMTP Config:', {
                host: this.configService.get('SMTP_HOST'),
                port: this.configService.get('SMTP_PORT'),
                user: this.configService.get('SMTP_USER'),
                frontendUrl: this.configService.get('FRONTEND_URL')
            });

            const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
            const confirmationHtml = this.generateConfirmationEmailTemplate(user.name, user.token, frontendUrl);

            const result = await this.mailerService.sendMail({
                to: user.email,
                subject: '✨ Confirma tu cuenta - Taller de Título',
                html: confirmationHtml
            });

            console.log('Email de confirmación enviado exitosamente a:', user.email);
            console.log('Resultado:', result);
        } catch (error) {
            console.error('Error al enviar email de confirmación:', error);
            throw error;
        }
    }

    async sendPasswordResetToken(user: IEmailData): Promise<void> {
        try {
            console.log('Intentando enviar email de reset a:', user.email);

            const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
            const passwordResetHtml = this.generatePasswordResetEmailTemplate(user.name, user.token, frontendUrl);

            const result = await this.mailerService.sendMail({
                to: user.email,
                subject: '🔐 Reestablece tu contraseña - Taller de Título',
                html: passwordResetHtml
            });

            console.log('Email de reset enviado exitosamente a:', user.email);
            console.log('Resultado:', result);
        } catch (error) {
            console.error('Error al enviar email de reset:', error);
            throw error;
        }
    }

    async sendWelcomeEmail(user: { email: string; name: string }): Promise<void> {
        try {
            console.log('Intentando enviar email de bienvenida a:', user.email);

            const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
            const welcomeHtml = this.generateWelcomeEmailTemplate(user.name, frontendUrl);

            const result = await this.mailerService.sendMail({
                to: user.email,
                subject: '🎉 ¡Bienvenido a Taller de Título!',
                html: welcomeHtml
            });

            console.log('Email de bienvenida enviado exitosamente a:', user.email);
            console.log('Resultado:', result);
        } catch (error) {
            console.error('Error al enviar email de bienvenida:', error);
            throw error;
        }
    }

    /**
     * Genera el template HTML para correo de bienvenida (sin token)
     */
    private generateWelcomeEmailTemplate(name: string, frontendUrl: string): string {
        return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Bienvenido a Taller de Título</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    line-height: 1.6; 
                    color: #374151; 
                    background: #f9fafb;
                }
                .container { 
                    max-width: 600px; 
                    margin: 40px auto; 
                    background: #ffffff; 
                    border-radius: 12px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    overflow: hidden;
                }
                .header { 
                    padding: 48px 40px 32px; 
                    text-align: center; 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                }
                .logo-space {
                    width: 64px; 
                    height: 64px; 
                    background: rgba(255,255,255,0.15);
                    border: 2px dashed rgba(255,255,255,0.3);
                    border-radius: 12px;
                    margin: 0 auto 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: rgba(255,255,255,0.7);
                    font-size: 10px;
                    font-weight: 500;
                }
                .header h1 { 
                    color: #ffffff; 
                    font-size: 24px; 
                    font-weight: 600; 
                    margin-bottom: 8px;
                }
                .header p { 
                    color: rgba(255,255,255,0.9); 
                    font-size: 16px; 
                }
                .content { 
                    padding: 40px; 
                }
                .greeting { 
                    font-size: 20px; 
                    font-weight: 600; 
                    color: #111827; 
                    margin-bottom: 24px; 
                }
                .message { 
                    font-size: 16px; 
                    color: #6b7280; 
                    line-height: 1.7; 
                    margin-bottom: 32px; 
                }
                .cta { 
                    text-align: center; 
                    margin: 32px 0; 
                }
                .btn { 
                    display: inline-block; 
                    background: #4f46e5; 
                    color: #ffffff; 
                    text-decoration: none; 
                    padding: 12px 28px; 
                    border-radius: 8px; 
                    font-weight: 500; 
                    font-size: 16px; 
                }
                .features {
                    background: #f9fafb;
                    padding: 24px;
                    border-radius: 8px;
                    margin: 32px 0;
                }
                .features h3 {
                    color: #111827;
                    font-size: 16px;
                    font-weight: 600;
                    margin-bottom: 16px;
                }
                .feature-list {
                    list-style: none;
                    padding: 0;
                }
                .feature-list li {
                    color: #6b7280;
                    font-size: 14px;
                    padding: 4px 0;
                    padding-left: 20px;
                    position: relative;
                }
                .feature-list li:before {
                    content: "✓";
                    color: #10b981;
                    font-weight: 600;
                    position: absolute;
                    left: 0;
                }
                .footer { 
                    padding: 32px 40px; 
                    text-align: center; 
                    background: #f9fafb; 
                    border-top: 1px solid #e5e7eb; 
                }
                .footer p { 
                    color: #9ca3af; 
                    font-size: 14px; 
                }
                @media (max-width: 600px) {
                    .container { margin: 20px; border-radius: 8px; }
                    .content, .header, .footer { padding: 24px; }
                    .header h1 { font-size: 22px; }
                    .btn { display: block; width: 100%; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo-space">LOGO</div>
                    <h1>¡Bienvenido a Taller de Título!</h1>
                    <p>Tu plataforma de gestión académica</p>
                </div>
                <div class="content">
                    <div class="greeting">Hola ${name}</div>
                    <div class="message">
                        Nos complace darte la bienvenida a <strong>Taller de Título</strong>. 
                        Tu cuenta ha sido creada exitosamente y ya puedes comenzar a explorar 
                        todas las herramientas que hemos preparado para ti.
                    </div>
                    <div class="cta">
                        <a href="${frontendUrl}/auth/login" class="btn">Comenzar ahora</a>
                    </div>
                    <div class="features">
                        <h3>¿Qué puedes hacer ahora?</h3>
                        <ul class="feature-list">
                            <li>Gestionar tu perfil y configuración</li>
                            <li>Acceder a herramientas de seguimiento</li>
                            <li>Colaborar con tu equipo</li>
                            <li>Recibir notificaciones importantes</li>
                        </ul>
                    </div>
                </div>
                <div class="footer">
                    <p>© 2024 Taller de Título. Todos los derechos reservados.</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Template unificado para todos los emails que requieren token
     */
    private generateTokenEmailTemplate(
        type: 'confirmation' | 'password-reset' | 'verification',
        name: string, 
        token: string, 
        frontendUrl: string
    ): string {
        const config = {
            confirmation: {
                title: 'Confirma tu cuenta',
                heading: 'Verificación de cuenta',
                message: 'Para completar tu registro, confirma tu dirección de email haciendo clic en el botón a continuación. También puedes ingresar manualmente el código mostrado.',
                buttonText: 'Confirmar cuenta',
                buttonUrl: `${frontendUrl}/auth/confirm-account?token=${token}`,
                color: '#4f46e5'
            },
            'password-reset': {
                title: 'Restablecer contraseña',
                heading: 'Recuperación de contraseña',
                message: 'Haz clic en el botón para restablecer tu contraseña de forma segura. También puedes ingresar manualmente el código mostrado.',
                buttonText: 'Restablecer contraseña',
                buttonUrl: `${frontendUrl}/auth/new-password?token=${token}`,
                color: '#dc2626'
            },
            verification: {
                title: 'Código de verificación',
                heading: 'Verificación requerida',
                message: 'Se requiere verificación adicional. Haz clic en el botón para continuar automáticamente o ingresa el código manualmente.',
                buttonText: 'Verificar',
                buttonUrl: `${frontendUrl}/auth/confirm-account?token=${token}`,
                color: '#059669'
            }
        };

        const current = config[type];

        return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${current.title}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    line-height: 1.6; 
                    color: #374151; 
                    background: #f9fafb;
                }
                .container { 
                    max-width: 500px; 
                    margin: 60px auto; 
                    background: #ffffff; 
                    border-radius: 12px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    overflow: hidden;
                }
                .header { 
                    padding: 40px 32px 24px; 
                    text-align: center; 
                    border-bottom: 1px solid #f3f4f6;
                }
                .logo-space {
                    width: 56px; 
                    height: 56px; 
                    background: #f3f4f6;
                    border: 2px dashed #d1d5db;
                    border-radius: 10px;
                    margin: 0 auto 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #9ca3af;
                    font-size: 10px;
                    font-weight: 500;
                }
                .header h1 { 
                    color: #111827; 
                    font-size: 22px; 
                    font-weight: 600; 
                    margin-bottom: 8px;
                }
                .header p { 
                    color: #6b7280; 
                    font-size: 15px; 
                }
                .content { 
                    padding: 32px; 
                }
                .greeting { 
                    font-size: 18px; 
                    font-weight: 500; 
                    color: #111827; 
                    margin-bottom: 20px; 
                }
                .message { 
                    font-size: 15px; 
                    color: #6b7280; 
                    line-height: 1.6; 
                    margin-bottom: 32px; 
                }
                .token-section {
                    background: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    padding: 24px;
                    text-align: center;
                    margin: 32px 0;
                }
                .token-label {
                    color: #6b7280;
                    font-size: 13px;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    margin-bottom: 12px;
                }
                .token-code {
                    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
                    font-size: 28px;
                    font-weight: 700;
                    color: #111827;
                    letter-spacing: 4px;
                    margin: 8px 0;
                }
                .cta { 
                    text-align: center; 
                    margin: 32px 0 24px; 
                }
                .btn { 
                    display: inline-block; 
                    background: ${current.color}; 
                    color: #ffffff; 
                    text-decoration: none; 
                    padding: 12px 24px; 
                    border-radius: 8px; 
                    font-weight: 500; 
                    font-size: 15px; 
                    transition: opacity 0.2s;
                }
                .btn:hover { opacity: 0.9; }
                .footer { 
                    padding: 24px 32px; 
                    text-align: center; 
                    background: #f9fafb; 
                    border-top: 1px solid #e5e7eb; 
                }
                .footer p { 
                    color: #9ca3af; 
                    font-size: 13px; 
                    margin-bottom: 8px;
                }
                .security-note {
                    background: #fef7f0;
                    border: 1px solid #fed7aa;
                    border-radius: 6px;
                    padding: 12px;
                    margin-top: 16px;
                }
                .security-note p {
                    color: #c2410c;
                    font-size: 12px;
                    margin: 0;
                }
                @media (max-width: 600px) {
                    .container { 
                        margin: 20px; 
                        border-radius: 8px; 
                    }
                    .content, .header, .footer { 
                        padding: 24px 20px; 
                    }
                    .header h1 { 
                        font-size: 20px; 
                    }
                    .token-code { 
                        font-size: 24px; 
                        letter-spacing: 2px; 
                    }
                    .btn { 
                        display: block; 
                        width: 100%; 
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo-space">LOGO</div>
                    <h1>${current.heading}</h1>
                    <p>Taller de Título</p>
                </div>
                <div class="content">
                    <div class="greeting">Hola ${name}</div>
                    <div class="message">${current.message}</div>
                    
                    <div class="token-section">
                        <div class="token-label">Tu código</div>
                        <div class="token-code">${token}</div>
                        <p style="color: #6b7280; font-size: 13px; margin-top: 12px;">
                            El botón de abajo completará automáticamente este código
                        </p>
                    </div>
                    
                    <div class="cta">
                        <a href="${current.buttonUrl}" class="btn">${current.buttonText}</a>
                    </div>
                </div>
                <div class="footer">
                    <p>Este código expira en 10 minutos</p>
                    <div class="security-note">
                        <p>🔒 Nunca compartas este código con nadie</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Genera el template HTML para el email de confirmación de cuenta
     */
    private generateConfirmationEmailTemplate(name: string, token: string, frontendUrl: string): string {
        return this.generateTokenEmailTemplate('confirmation', name, token, frontendUrl);
    }

    /**
     * Genera el template HTML para el email de recuperación de contraseña
     */
    private generatePasswordResetEmailTemplate(name: string, token: string, frontendUrl: string): string {
        return this.generateTokenEmailTemplate('password-reset', name, token, frontendUrl);
    }
}