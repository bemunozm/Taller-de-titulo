import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import {
  AuditAction,
  AuditModule,
} from '../../audit/entities/audit-log.entity';
import { HubGateway } from '../../hub/hub.gateway';
import { errorMessage } from '../../common/utils/error-message.util';
import {
  NotificationPriority,
  NotificationType,
} from '../../notifications/entities/notification.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { UsersService } from '../../users/users.service';
import {
  VisitStatus,
  VisitType,
  type Visit,
} from '../../visits/entities/visit.entity';
import { VisitEntryAlreadyRegisteredException } from '../../visits/visit-entry-already-registered.exception';
import { hasActiveVisitHost } from '../../visits/visit-host';
import { QR_VALID } from '../../visits/visit-state-machine';
import { VisitsService } from '../../visits/visits.service';
import type {
  RedeemQrDenialReason,
  RedeemQrResponse,
} from '../dto/redeem-qr.dto';

/** Hub (kiosko) que canjea: ya autenticado y validado como `web-kiosk`. */
export interface KioskRedeemer {
  hubId: string;
  organizationId: string;
}

const DOOR_NOT_ORDERED_TITLE = 'Visita con QR sin apertura automática';
const DOOR_NOT_ORDERED_MESSAGE =
  'Una visita canjeó su QR en el kiosko y el ingreso quedó registrado, pero ningún hub físico del condominio recibió la orden de apertura. Abre el acceso manualmente.';

/**
 * Canje del QR de una visita desde el kiosko (apertura DETERMINISTA, sin el
 * agente). Cadena: `validateAccess` → anfitrión activo → `checkIn` (único
 * escritor atómico) → `hub:door_open` SOLO si el check-in tuvo éxito.
 *
 * Aislamiento: `validateAccess`/`findByQRCode` ya filtran por el
 * `tenantContext` del hub; además se exige `visit.organizationId` igual al del
 * kiosko y se pasa el scope explícito a `checkIn` (defensa en profundidad).
 * Replay: un QR estático ya canjeado deja la visita ACTIVE, y `checkIn` lanza
 * `VisitEntryAlreadyRegisteredException` → `already_inside`.
 *
 * Nada de lo que devuelve incluye PII, y el `qrCode` nunca se registra.
 */
@Injectable()
export class KioskQrService {
  private readonly logger = new Logger(KioskQrService.name);

  constructor(
    private readonly visitsService: VisitsService,
    private readonly usersService: UsersService,
    private readonly hubGateway: HubGateway,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  async redeem(
    kiosk: KioskRedeemer,
    qrCode: string,
  ): Promise<RedeemQrResponse> {
    const { organizationId } = kiosk;

    const validation = await this.visitsService.validateAccess(qrCode, 'qr');
    const visit = validation.visit;

    // Otro condominio se trata como inexistente (sin revelar que existe).
    if (visit && visit.organizationId !== organizationId) {
      return this.deny(kiosk, null, 'invalid');
    }
    if (!validation.valid || !visit) {
      return this.deny(kiosk, visit ?? null, this.reasonOf(visit));
    }

    if (!(await hasActiveVisitHost(visit, organizationId, this.usersService))) {
      return this.deny(kiosk, visit, 'host_inactive');
    }

    // Solo la PRIMERA entrada: un QR estático fotografiado no debe permitir
    // reingresar (ni abrir el portón vehicular a pie) cada vez que la visita
    // vuelve a READY_FOR_REENTRY tras una salida. Los reingresos los resuelve
    // el LPR o la llamada con aprobación del residente. Riesgo residual: un QR
    // fotografiado ANTES de la primera entrada; se mitiga con el aviso al
    // anfitrión (canal kiosco). QR rotativo = Fase 6. La visita peatonal queda
    // ACTIVE hasta un checkOut manual.
    if (visit.status !== VisitStatus.PENDING || visit.usedCount > 0) {
      return this.deny(kiosk, visit, 'no_uses_left');
    }

    try {
      // `onlyFromStatus` repite la guarda dentro de checkIn, sobre el mismo
      // estado que condiciona su UPDATE atómico (si cambió por carrera -> 409).
      await this.visitsService.checkIn(
        visit.id,
        { organizationId },
        { channel: 'kiosk', onlyFromStatus: VisitStatus.PENDING },
      );
    } catch (error) {
      if (error instanceof VisitEntryAlreadyRegisteredException) {
        return this.deny(kiosk, visit, 'already_inside');
      }
      // Carrera con otra request que movió la visita (estado/ventana): se
      // deniega sin abrir. Cualquier otro error es un fallo real (500).
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        return this.deny(kiosk, visit, 'invalid');
      }
      throw error;
    }

    const access =
      visit.type === VisitType.VEHICULAR ? 'vehicular' : 'pedestrian';
    const doorOpened = this.openDoor(kiosk, visit, access);
    if (!doorOpened) {
      await this.alertConserjes(kiosk, visit);
    }

    this.logger.log(
      `Canje de QR en kiosko ${kiosk.hubId}: concedido (visita=${visit.id}, acceso=${access}, puerta=${doorOpened ? 'abierta' : 'NO abierta'})`,
    );
    await this.audit(kiosk, visit.id, 'granted', undefined, doorOpened);
    return { status: 'granted', access, doorOpened };
  }

  /**
   * Motivo de rechazo según el ESTADO de la visita, no según el texto de
   * `validateAccess` (que es un mensaje para humanos y puede cambiar).
   */
  private reasonOf(visit: Visit | undefined): RedeemQrDenialReason {
    if (!visit) {
      return 'invalid';
    }
    if (visit.status === VisitStatus.EXPIRED) {
      return 'expired';
    }
    if (visit.status === VisitStatus.COMPLETED) {
      return 'no_uses_left';
    }
    if (!QR_VALID.includes(visit.status)) {
      return 'invalid';
    }
    const now = new Date();
    if (now < visit.validFrom) {
      return 'not_yet_valid';
    }
    if (now > visit.validUntil) {
      return 'expired';
    }
    return 'no_uses_left';
  }

  private openDoor(
    kiosk: KioskRedeemer,
    visit: Visit,
    access: 'pedestrian' | 'vehicular',
  ): boolean {
    try {
      // `hubId: null`: la orden va a los hubs físicos del condominio, nunca
      // al kiosko (que no tiene relés).
      return (
        this.hubGateway.sendDoorOpen(
          { hubId: null, organizationId: kiosk.organizationId },
          { type: access, visitId: visit.id },
        ) > 0
      );
    } catch (error) {
      this.logger.error(
        `No se pudo emitir la orden de apertura de la visita ${visit.id}: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  /** Alerta (best-effort) a conserjería: ingreso registrado sin apertura. */
  private async alertConserjes(
    kiosk: KioskRedeemer,
    visit: Visit,
  ): Promise<void> {
    try {
      await this.notificationsService.notifyByRoleForOrganization(
        'Conserje',
        kiosk.organizationId,
        NotificationType.SYSTEM_ALERT,
        DOOR_NOT_ORDERED_TITLE,
        DOOR_NOT_ORDERED_MESSAGE,
        {
          priority: NotificationPriority.HIGH,
          data: { visitId: visit.id, hubId: kiosk.hubId },
        },
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo alertar a los conserjes por la visita ${visit.id}: ${errorMessage(error)}`,
      );
    }
  }

  private async deny(
    kiosk: KioskRedeemer,
    visit: Visit | null,
    reason: RedeemQrDenialReason,
  ): Promise<RedeemQrResponse> {
    this.logger.log(
      `Canje de QR en kiosko ${kiosk.hubId}: denegado (visita=${visit?.id ?? 'n/a'}, motivo=${reason})`,
    );
    await this.audit(kiosk, visit?.id, 'denied', reason);
    return { status: 'denied', reason };
  }

  /**
   * Auditoría con actor de máquina: `AuditLog.userId` es nullable, así que el
   * kiosko queda identificado por `hubId` en `newValue` (no hay usuario). Sin
   * `qrCode`. Best-effort: un fallo de auditoría no cambia el resultado.
   */
  private async audit(
    kiosk: KioskRedeemer,
    visitId: string | undefined,
    result: 'granted' | 'denied',
    reason?: RedeemQrDenialReason,
    doorOpened?: boolean,
  ): Promise<void> {
    try {
      await this.auditService.log({
        module: AuditModule.DIGITAL_CONCIERGE,
        action: AuditAction.VISIT_QR_VALIDATE,
        organizationId: kiosk.organizationId,
        entityId: visitId,
        entityType: visitId ? 'Visit' : undefined,
        newValue: {
          source: 'kiosk',
          hubId: kiosk.hubId,
          result,
          reason,
          doorOpened,
        },
        description: `Canje de QR en kiosko: ${result}`,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo auditar el canje de QR del kiosko ${kiosk.hubId}: ${errorMessage(error)}`,
      );
    }
  }
}
