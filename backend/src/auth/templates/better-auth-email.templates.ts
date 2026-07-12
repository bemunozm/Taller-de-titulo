/**
 * Templates HTML para los flujos de email NATIVOS de better-auth (tarea #18,
 * docs/modulos/auth-multitenant.md sección 6/objetivo 3).
 *
 * Por qué un archivo aparte de `src/auth/services/auth-email.service.ts`:
 * `better-auth.ts` construye el objeto `auth` a nivel de import, ANTES de que
 * exista el contenedor de Nest (ver cabecera de ese archivo) — no hay DI ahí,
 * así que no puede inyectar `AuthEmailService` (depende de `MailerService`/
 * `ConfigService`). Estas funciones son puras (sin DI) para poder invocarse
 * desde los hooks `emailVerification.sendVerificationEmail` /
 * `emailAndPassword.sendResetPassword` de better-auth.ts, que arma su propio
 * transporter de nodemailer "a mano" (mismo patrón que el `pg.Pool` de ese
 * archivo). `AuthEmailService` (y sus templates) se mantiene intacto — sigue
 * sirviendo los flujos legacy que aún no fueron migrados/retirados.
 *
 * Diferencia de UX vs los templates legacy: better-auth genera links de
 * un solo uso con token OPACO (no un código de 6 dígitos "tipeable"), así que
 * estos templates solo muestran el botón de acción, no una caja de código.
 */

interface BaseTemplateOptions {
    title: string;
    heading: string;
    message: string;
    buttonText: string;
    buttonUrl: string;
    accentColor: string;
    footerNote: string;
}

function renderLinkEmailTemplate(name: string, options: BaseTemplateOptions): string {
    const { title, heading, message, buttonText, buttonUrl, accentColor, footerNote } = options;

    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
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
            .header h1 { color: #111827; font-size: 22px; font-weight: 600; margin-bottom: 8px; }
            .header p { color: #6b7280; font-size: 15px; }
            .content { padding: 32px; }
            .greeting { font-size: 18px; font-weight: 500; color: #111827; margin-bottom: 20px; }
            .message { font-size: 15px; color: #6b7280; line-height: 1.6; margin-bottom: 32px; }
            .cta { text-align: center; margin: 32px 0 24px; }
            .btn {
                display: inline-block;
                background: ${accentColor};
                color: #ffffff;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: 500;
                font-size: 15px;
            }
            .footer {
                padding: 24px 32px;
                text-align: center;
                background: #f9fafb;
                border-top: 1px solid #e5e7eb;
            }
            .footer p { color: #9ca3af; font-size: 13px; margin-bottom: 8px; }
            .security-note {
                background: #fef7f0;
                border: 1px solid #fed7aa;
                border-radius: 6px;
                padding: 12px;
                margin-top: 16px;
            }
            .security-note p { color: #c2410c; font-size: 12px; margin: 0; }
            @media (max-width: 600px) {
                .container { margin: 20px; border-radius: 8px; }
                .content, .header, .footer { padding: 24px 20px; }
                .btn { display: block; width: 100%; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo-space">LOGO</div>
                <h1>${heading}</h1>
                <p>Taller de Título</p>
            </div>
            <div class="content">
                <div class="greeting">Hola ${name}</div>
                <div class="message">${message}</div>
                <div class="cta">
                    <a href="${buttonUrl}" class="btn">${buttonText}</a>
                </div>
            </div>
            <div class="footer">
                <p>${footerNote}</p>
                <div class="security-note">
                    <p>🔒 Si no solicitaste esto, puedes ignorar este correo</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
}

/** Email de bienvenida tras confirmar la cuenta (hook `emailVerification.afterEmailVerification`). */
export function buildWelcomeAfterVerificationEmailHtml(name: string, frontendUrl: string): string {
    return renderLinkEmailTemplate(name, {
        title: 'Bienvenido',
        heading: '¡Cuenta confirmada!',
        message:
            'Tu cuenta fue verificada exitosamente. Ya puedes acceder a todas las funcionalidades de la plataforma.',
        buttonText: 'Ir a la plataforma',
        buttonUrl: `${frontendUrl}/auth/login`,
        accentColor: '#4f46e5',
        footerNote: '¡Gracias por confirmar tu cuenta!',
    });
}

/** Email de verificación de cuenta (hook `emailVerification.sendVerificationEmail`). */
export function buildAccountVerificationEmailHtml(name: string, url: string): string {
    return renderLinkEmailTemplate(name, {
        title: 'Confirma tu cuenta',
        heading: 'Verificación de cuenta',
        message:
            'Para completar la activación de tu cuenta, confirma tu dirección de email haciendo clic en el botón a continuación.',
        buttonText: 'Confirmar cuenta',
        buttonUrl: url,
        accentColor: '#059669',
        footerNote: 'Este enlace expira pronto por tu seguridad',
    });
}

/**
 * Email de restablecimiento/activación de contraseña (hook
 * `emailAndPassword.sendResetPassword`). `isNewAccount` distingue "primera
 * vez que este usuario define una contraseña vía better-auth" (cuenta creada
 * por un admin, ver src/users/users.service.ts#createAccountByAdmin) de un
 * genuino "olvidé mi contraseña", para dar el copy correcto sin necesitar un
 * hook distinto (better-auth no expone esa distinción directamente).
 */
export function buildPasswordResetEmailHtml(name: string, url: string, isNewAccount: boolean): string {
    if (isNewAccount) {
        return renderLinkEmailTemplate(name, {
            title: 'Establece tu contraseña',
            heading: '¡Bienvenido!',
            message:
                'Un administrador creó una cuenta para ti en Taller de Título. Para comenzar a usar la plataforma, establece tu contraseña haciendo clic en el botón a continuación.',
            buttonText: 'Establecer mi contraseña',
            buttonUrl: url,
            accentColor: '#4f46e5',
            footerNote: 'Este enlace expira pronto por tu seguridad',
        });
    }

    return renderLinkEmailTemplate(name, {
        title: 'Restablecer contraseña',
        heading: 'Recuperación de contraseña',
        message:
            'Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para elegir una nueva de forma segura.',
        buttonText: 'Restablecer contraseña',
        buttonUrl: url,
        accentColor: '#dc2626',
        footerNote: 'Este enlace expira pronto por tu seguridad',
    });
}

/**
 * Email de invitación a una organización (condominio), hook
 * `organization.sendInvitationEmail` (tarea #19,
 * docs/modulos/auth-multitenant.md §7b). NO es el camino primario de
 * onboarding hoy (ver docstring en better-auth.ts sobre por qué) — se deja
 * cableado por si un flujo futuro invoca `inviteMember` directamente.
 */
export function buildOrganizationInvitationEmailHtml(
    email: string,
    organizationName: string,
    inviterName: string,
    acceptUrl: string,
): string {
    return renderLinkEmailTemplate(email, {
        title: 'Invitación a un condominio',
        heading: 'Te invitaron a un condominio',
        message: `${inviterName} te invitó a unirte a "${organizationName}" en Taller de Título. Acepta la invitación para continuar.`,
        buttonText: 'Aceptar invitación',
        buttonUrl: acceptUrl,
        accentColor: '#4f46e5',
        footerNote: 'Esta invitación expira pronto',
    });
}
