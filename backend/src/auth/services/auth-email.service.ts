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

            const result = await this.mailerService.sendMail({
                to: user.email,
                subject: 'UpTask - Confirma tu cuenta',
                html: `<p>Hola: ${user.name}, has creado tu cuenta en UpTask, ya casi esta todo listo, solo debes confirmar tu cuenta</p>
                    <p>Visita el siguiente enlace:</p>
                    <a href="${this.configService.get('FRONTEND_URL')}/auth/confirm-account">Confirmar cuenta</a>
                    <p>E ingresa el código: <b>${user.token}</b></p>
                    <p>Este token expira en 10 minutos</p>
                `
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

            const result = await this.mailerService.sendMail({
                to: user.email,
                subject: 'UpTask - Reestablece tu password',
                html: `<p>Hola: ${user.name}, has solicitado reestablecer tu password.</p>
                    <p>Visita el siguiente enlace:</p>
                    <a href="${this.configService.get('FRONTEND_URL')}/auth/new-password">Reestablecer Password</a>
                    <p>E ingresa el código: <b>${user.token}</b></p>
                    <p>Este token expira en 10 minutos</p>
                `
            });

            console.log('Email de reset enviado exitosamente a:', user.email);
            console.log('Resultado:', result);
        } catch (error) {
            console.error('Error al enviar email de reset:', error);
            throw error;
        }
    }
}