import { GetNotificationsDto } from './get-notifications.dto';

/**
 * Query de `GET /notifications`: las notificaciones del usuario de la sesión.
 *
 * Fase 4 · P5.B (IDOR): sin `recipientId`. Antes `?recipientId=<uuid>` leía
 * las notificaciones de CUALQUIER usuario. Con `forbidNonWhitelisted`, mandar
 * `recipientId` responde 400. Fase 4 · P5.C: el campo deprecated se retiró
 * también de `GetNotificationsDto` (el destinatario es siempre el parámetro
 * `userId` de `NotificationsService.findAll`).
 */
export class ListMyNotificationsDto extends GetNotificationsDto {}
