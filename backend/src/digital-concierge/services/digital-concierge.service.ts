import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConciergeSession, SessionStatus } from '../entities/concierge-session.entity';
import { RealtimeVoiceTokenService } from './realtime-voice-token.service';
import { UsersService } from '../../users/users.service';
import { FamiliesService } from '../../families/families.service';
import { VisitsService } from '../../visits/visits.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationsGateway } from '../../notifications/notifications.gateway';
import { VisitType, VisitStatus } from '../../visits/entities/visit.entity';
import { randomBytes } from 'crypto';
import { SmsService } from '../../common/services/sms.service';
import { QRCodeService } from '../../common/services/qrcode.service';
import { HubGateway } from '../../hub/hub.gateway';
import { User } from '../../users/entities/user.entity';

/**
 * Origen de una sesión, resuelto por el controller a partir de
 * `ConciergeAuthGuard` (Fase 1, Bloque A1) ANTES de llegar acá — este
 * servicio no conoce headers ni request, solo recibe el resultado ya
 * resuelto (hub autenticado, o sesión humana vía tenantContext).
 */
export interface ConciergeSessionOrigin {
  hubId: string | null;
  source: 'web' | 'hub';
  organizationId: string | null;
}

/**
 * Datos parciales del visitante que `guardar_datos_visitante` (Fase 1,
 * Bloque A2b) va acumulando de a uno en la `ConciergeSession` — el modelo
 * llama esta tool repetidamente con un campo a la vez (ver
 * `agent/prompts/sofia.prompt.ts`).
 */
export interface SaveVisitorDataInput {
  nombre?: string;
  rut?: string;
  telefono?: string;
  patente?: string;
  motivo?: string;
  casa?: string;
}

/**
 * Forma mínima de `AuthorizedContext` que este servicio necesita para el fix
 * M1 (defensa en profundidad, Bloque A2b — ver docstring de `notifyResident`
 * más abajo). Se define localmente en vez de importar `AuthorizedContext` de
 * `agent/types/` para no crear una dependencia de tipos del dominio hacia la
 * capa de agente (la dirección natural es agente → dominio, no al revés) —
 * cualquier objeto con estos dos campos (incluido un `AuthorizedContext`
 * completo) es asignable acá por tipado estructural.
 */
export interface TenantScope {
  tenantId: string | null;
  isSuperAdmin: boolean;
}

@Injectable()
export class DigitalConciergeService {
  private readonly logger = new Logger(DigitalConciergeService.name);

  constructor(
    @InjectRepository(ConciergeSession)
    private readonly sessionRepository: Repository<ConciergeSession>,
    private readonly tokenService: RealtimeVoiceTokenService,
    private readonly usersService: UsersService,
    private readonly familiesService: FamiliesService,
    private readonly visitsService: VisitsService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly hubGateway: HubGateway, // Para comunicarse con la Raspberry Pi
    private readonly smsService: SmsService,
    private readonly qrcodeService: QRCodeService,
  ) {}

  /**
   * Inicia una nueva sesión del conserje digital
   *
   * Fase 1, Bloque A1: `origin` estampa el tenant (`organizationId`) y, si
   * aplica, el hub físico que originó la sesión — resuelto por el
   * controller a partir de `ConciergeAuthGuard`. Con `organizationId`
   * poblado, `executeTool` → `buscar_residente`/`notificar_residente` quedan
   * automáticamente scopeados por condominio (vía `TenantContextService`,
   * que lee `request.tenantContext` — mismo request, sin lógica adicional acá).
   */
  async startSession(socketId: string | undefined, origin: ConciergeSessionOrigin) {
    this.logger.log('Starting new concierge session...');
    if (socketId) {
      this.logger.log(`Socket ID del visitante: ${socketId}`);
    }
    if (!origin.organizationId) {
      this.logger.warn(
        `Sesión iniciada sin organizationId resuelto (source=${origin.source}, hubId=${origin.hubId ?? 'n/a'}) — quedará en el "cajón nulo".`,
      );
    }

    // Generar token efímero de OpenAI
    const { token, expiresAt } = await this.tokenService.generateEphemeralToken();

    // Crear sesión en BD
    const sessionId = randomBytes(16).toString('hex');
    const session = this.sessionRepository.create({
      sessionId,
      status: SessionStatus.ACTIVE,
      startTime: new Date(),
      transcript: [],
      functionCalls: [],
      visitorSocketId: socketId || null,
      hubId: origin.hubId,
      source: origin.source,
      organizationId: origin.organizationId,
    });

    await this.sessionRepository.save(session);

    this.logger.log(`Session created: ${sessionId} (source=${origin.source}, organizationId=${origin.organizationId ?? 'null'})`);

    return {
      sessionId,
      ephemeralToken: token,
      expiresAt,
    };
  }

  /**
   * Finaliza la sesión
   */
  async endSession(sessionId: string, finalStatus?: SessionStatus) {
    this.logger.log(`Ending session: ${sessionId}`);

    const session = await this.findSessionById(sessionId);
    
    session.status = finalStatus || SessionStatus.COMPLETED;
    session.endTime = new Date();

    await this.sessionRepository.save(session);

    // Si la sesión termina sin que los residentes hayan respondido, marcar las notificaciones como expiradas
    if (session.residentsNotified && session.residentsNotified.length > 0 && session.residentResponse === 'pending') {
      this.logger.log(`Sesión terminada sin respuesta de los residentes. Marcando notificaciones como expiradas...`);
      
      try {
        // Marcar notificaciones de TODOS los residentes
        for (const resident of session.residentsNotified) {
          const notifications = await this.notificationsService.findAll(
            { 
              recipientId: resident.id,
              read: false,
            },
            resident.id,
          );

          const relevantNotification = notifications.notifications.find(
            (n) => n.data?.sessionId === sessionId && n.requiresAction && !n.actionTaken
          );

          if (relevantNotification) {
            await this.notificationsService.markVisitorActionTaken(
              relevantNotification.id,
              false, // No aprobada (sesión terminada sin respuesta)
              'session_ended', // Razón adicional
            );
            this.logger.log(`✅ Notificación ${relevantNotification.id} marcada como expirada para ${resident.name}`);
          }
        }
      } catch (error) {
        this.logger.warn(`⚠️ No se pudo marcar las notificaciones como expiradas: ${error.message}`);
        // No es crítico, continuar
      }
    }

    const duration = Math.floor((session.endTime.getTime() - session.startTime.getTime()) / 1000);

    return {
      sessionId,
      status: session.status,
      duration,
      visitCreated: !!session.createdVisit,
    };
  }

  /**
   * Validar si una sesión está activa y puede recibir respuestas
   */
  async isSessionActive(sessionId: string): Promise<{ active: boolean; reason?: string }> {
    try {
      const session = await this.findSessionById(sessionId);

      // Verificar estado de la sesión
      if (session.status !== SessionStatus.ACTIVE) {
        return { 
          active: false, 
          reason: `La sesión ya no está activa (estado: ${session.status})` 
        };
      }

      // Verificar si ya se respondió
      if (session.residentResponse && session.residentResponse !== 'pending') {
        return { 
          active: false, 
          reason: `Ya se respondió a esta solicitud (respuesta: ${session.residentResponse})` 
        };
      }

      // Verificar timeout (15 minutos)
      const sessionAge = Date.now() - session.startTime.getTime();
      const maxAge = 15 * 60 * 1000; // 15 minutos
      
      if (sessionAge > maxAge) {
        // Marcar sesión como expirada
        session.status = SessionStatus.TIMEOUT;
        await this.sessionRepository.save(session);

        // Si los residentes no respondieron, marcar las notificaciones como expiradas
        if (session.residentsNotified && session.residentsNotified.length > 0 && session.residentResponse === 'pending') {
          try {
            for (const resident of session.residentsNotified) {
              const notifications = await this.notificationsService.findAll(
                { 
                  recipientId: resident.id,
                  read: false,
                },
                resident.id,
              );

              const relevantNotification = notifications.notifications.find(
                (n) => n.data?.sessionId === sessionId && n.requiresAction && !n.actionTaken
              );

              if (relevantNotification) {
                await this.notificationsService.markVisitorActionTaken(
                  relevantNotification.id,
                  false,
                  'session_timeout',
                );
                this.logger.log(`⏱️ Notificación ${relevantNotification.id} marcada como expirada por timeout para ${resident.name}`);
              }
            }
          } catch (error) {
            this.logger.warn(`⚠️ No se pudo marcar las notificaciones como expiradas: ${error.message}`);
          }
        }
        
        return { 
          active: false, 
          reason: 'La sesión ha expirado (máximo 15 minutos)' 
        };
      }

      return { active: true };
    } catch (error) {
      return { 
        active: false, 
        reason: 'Sesión no encontrada' 
      };
    }
  }

  /**
   * Responde a una solicitud de visita (aprobación o rechazo del residente)
   * NUEVO: Actualiza el estado de la visita que ya fue creada en notifyResident
   */
  async respondToVisitor(sessionId: string, approved: boolean, residentId?: string) {
    this.logger.log(`Responding to visitor for session: ${sessionId}, approved: ${approved}, residentId: ${residentId}`);

    // NUEVO: Validar que la sesión esté activa
    const validation = await this.isSessionActive(sessionId);
    if (!validation.active) {
      throw new BadRequestException(validation.reason || 'La sesión no está activa');
    }

    const session = await this.findSessionById(sessionId);

    if (!session.residentsNotified || session.residentsNotified.length === 0) {
      throw new BadRequestException('No se ha notificado a ningún residente para esta sesión');
    }

    if (!session.createdVisit) {
      throw new BadRequestException('No existe visita creada para esta sesión');
    }

    // Actualizar la respuesta del residente en la sesión
    session.residentResponse = approved ? 'approved' : 'denied';
    await this.sessionRepository.save(session);

    this.logger.log(`✅ Resident response saved: ${session.residentResponse}`);

    // NUEVO: Actualizar el estado de la visita según la respuesta
    try {
      if (approved) {
        // Si se aprueba, registrar entrada (checkIn) para incrementar usedCount correctamente
        // Tarea de aislamiento tenant (branch fix/visits-tenant-isolation): este
        // flujo (Conserje Digital) no tiene sesión de usuario en absoluto
        // (DigitalConciergeController no tiene guards — el visitante habla con
        // la IA de forma anónima) — TenantContextService no puede resolver el
        // condominio del caller. La visita ya fue creada y su id ya vive en
        // esta MISMA sesión (resource-derived), así que se bypassa el scoping
        // por tenant en vez de romper el flujo de aprobación.
        await this.visitsService.checkIn(session.createdVisit.id, { skipTenantScope: true });
        this.logger.log(`✅ Visit ${session.createdVisit.id} check-in registered (status: ACTIVE, usedCount incremented)`);
      } else {
        // Si se niega, solo cambiar el status
        await this.visitsService.updateStatus(session.createdVisit.id, 'denied');
        this.logger.log(`✅ Visit ${session.createdVisit.id} status updated to: denied`);
      }

      // NUEVO: Actualizar anfitrión de la visita si se proporcionó residentId
      // IMPORTANTE: Hacerlo DESPUÉS del checkIn/updateStatus para no perder el cambio
      if (residentId) {
        this.logger.log(`🔄 Intentando actualizar host a residentId: ${residentId}`);
        
        // Verificar que el residente esté en la lista de notificados
        const residentIsValid = session.residentsNotified.some(r => r.id === residentId);
        
        if (residentIsValid) {
          // Actualizar el host de la visita al residente que respondió
          // (sin sesión de usuario — ver comentario del checkIn más arriba)
          const updatedVisit = await this.visitsService.update(session.createdVisit.id, { hostId: residentId }, { skipTenantScope: true });
          this.logger.log(`✅ Visit host updated to residentId: ${residentId}, new host: ${updatedVisit.host.name}`);
        } else {
          this.logger.warn(`⚠️ ResidentId ${residentId} no está en la lista de residentes notificados`);
          this.logger.warn(`⚠️ Residentes notificados:`, session.residentsNotified.map(r => ({ id: r.id, name: r.name })));
        }
      } else {
        this.logger.warn(`⚠️ No se proporcionó residentId, usando el host por defecto de la visita`);
      }

      // Si la visita fue aprobada, generar y enviar QR por SMS
      if (approved && session.visitorPhone && session.visitorName) {
        try {
          await this.sendQRToVisitor(
            session.createdVisit.id, 
            session.visitorName, 
            session.visitorPhone
          );
          this.logger.log(`✅ QR code enviado por SMS a ${session.visitorPhone}`);
        } catch (qrError) {
          // No fallar si el envío de QR falla, solo registrar el error
          this.logger.error(`❌ Error al enviar QR por SMS: ${qrError.message}`);
          this.logger.warn(`⚠️ La visita fue aprobada pero no se pudo enviar el QR al visitante`);
        }
      } else if (approved && !session.visitorPhone) {
        this.logger.warn(`⚠️ No se pudo enviar QR: visitante sin número de teléfono`);
      }
    } catch (error) {
      this.logger.error(`Error updating visit status: ${error.message}`);
      throw new BadRequestException('Error al actualizar el estado de la visita');
    }

    // NUEVO: Buscar y marcar TODAS las notificaciones como procesadas
    try {
      // Marcar notificaciones de TODOS los residentes notificados
      for (const resident of session.residentsNotified) {
        const notifications = await this.notificationsService.findAll(
          { 
            recipientId: resident.id,
            read: false,
          },
          resident.id,
        );

        // Encontrar la notificación que corresponde a esta sesión
        const relevantNotification = notifications.notifications.find(
          (n) => n.data?.sessionId === sessionId && n.requiresAction && !n.actionTaken
        );

        if (relevantNotification) {
          await this.notificationsService.markVisitorActionTaken(
            relevantNotification.id,
            approved,
          );
          this.logger.log(`✅ Notificación ${relevantNotification.id} marcada como procesada para ${resident.name}`);
        }
      }
    } catch (error) {
      this.logger.warn(`⚠️ No se pudo marcar las notificaciones como procesadas: ${error.message}`);
      // No es crítico, continuar
    }

    // Notificar al visitante/conserje en tiempo real mediante Socket.IO
    const eventName = `visitor:response:${sessionId}`;
    const payload = {
      sessionId,
      approved,
      residentResponse: session.residentResponse,
      visitId: session.createdVisit.id,
      timestamp: new Date(),
    };

    this.logger.log(`📡 Enviando evento: ${eventName}`);
    this.logger.log(`📦 Payload:`, JSON.stringify(payload));

    // El frontend web tiene su propio NotificationsGateway (app movil/web de residentes),
    // pero el vigilIA-hub de la Raspberry Pi escucha en HubGateway (namespace /hub).
    // Notificamos al hub directamente porque es el agente activo que está esperando la respuesta.
    //
    // Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — hallazgo H2
    // de la auditoría): antes esto era `broadcastToAllHubs` — TODOS los hubs
    // conectados (de CUALQUIER condominio) recibían la respuesta de esta
    // sesión. `notifyHub` dirige el evento al hub que originó la sesión
    // (`session.hubId`, más preciso) o, si no se conoce, a todos los hubs del
    // MISMO condominio (`session.organizationId`) — nunca a otro tenant.
    this.notifyHub(session, eventName, payload);

    this.logger.log(`✅ Notificación en tiempo real enviada para sesión ${sessionId}`);

    // NUEVO: Si la visita es aprobada, ordenar la apertura física de la puerta/portón al Hub
    if (approved && session.createdVisit) {
      const doorPayload = {
        type: session.createdVisit.type === VisitType.VEHICULAR ? 'vehicular' : 'pedestrian',
        visitId: session.createdVisit.id
      };

      // Hallazgo H2 (ALTO): antes `broadcastToAllHubs('hub:door_open', ...)`
      // abría el portón físico de TODOS los condominios conectados al
      // aprobar UNA visita en UNO solo. Ahora se dirige exclusivamente al hub
      // que originó la sesión o, en su defecto, a los hubs del mismo
      // condominio — ver `notifyHub`.
      this.logger.log(`🔑 Emitiendo comando de apertura de accesos al Hub (${doorPayload.type})`);
      this.notifyHub(session, 'hub:door_open', doorPayload);
    }

    return {
      success: true,
      message: approved
        ? 'Visita aprobada exitosamente'
        : 'Visita rechazada exitosamente',
    };
  }

  /**
   * Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — hallazgo H2):
   * dirige un evento al hub correcto en vez de `broadcastToAllHubs`. Prioriza
   * el hub exacto que originó la sesión (`session.hubId`, vía
   * `HubGateway.sendToHub`) — más preciso que por-organización si un
   * condominio tiene más de un hub. Si ese hub no está conectado (o la
   * sesión no tiene `hubId`, p.ej. transporte web), cae a
   * `HubGateway.sendToOrganization`, que igual respeta el límite de tenant
   * (nunca cruza a otro condominio, y no hace nada si `organizationId` es
   * `null` — ver su docstring sobre el "cajón nulo").
   */
  private notifyHub(session: ConciergeSession, event: string, payload: unknown): void {
    if (session.hubId && this.hubGateway.isHubConnected(session.hubId)) {
      this.hubGateway.sendToHub(session.hubId, event, payload);
      return;
    }

    this.hubGateway.sendToOrganization(session.organizationId, event, payload);
  }

  // ========== HERRAMIENTAS ==========
  //
  // Fase 1, Bloque A2b (docs/modulos/agente-cerebro.md §5/§7/§10.2 paso 4):
  // estos métodos eran `private`, invocados solo desde el `switch` de
  // `executeTool` (ya eliminado). Ahora son `public` porque los adaptadores
  // `VigiliaTool` en `agent/tools/*.tool.ts` los invocan directamente — la
  // lógica de negocio NO se reescribe, solo cambia quién la llama (el
  // `ToolDispatcherService`, vía el adaptador, en vez del switch). Ver
  // `findSessionForTenant` más abajo para cómo el adaptador resuelve la
  // `ConciergeSession` de forma tenant-aware antes de llamar a cualquiera de
  // estos métodos.

  /**
   * Guarda datos del visitante en la sesión
   */
  async saveVisitorData(session: ConciergeSession, data: SaveVisitorDataInput) {
    this.logger.debug('Saving visitor data...', data);

    if (data.nombre) session.visitorName = data.nombre;
    if (data.rut) session.visitorRut = data.rut;
    if (data.telefono) session.visitorPhone = data.telefono;
    if (data.patente) session.vehiclePlate = data.patente;
    if (data.motivo) session.visitReason = data.motivo;
    if (data.casa) session.destinationHouse = data.casa;

    await this.sessionRepository.save(session);

    return {
      message: 'Datos guardados correctamente',
      saved: {
        nombre: session.visitorName,
        rut: session.visitorRut,
        telefono: session.visitorPhone,
        patente: session.vehiclePlate,
        motivo: session.visitReason,
        casa: session.destinationHouse,
      },
    };
  }

  /**
   * Notifica a TODOS los residentes de la familia sobre la visita
   * NUEVO: Crea la visita en estado PENDING automáticamente
   *
   * Fix M1 (Fase 1, Bloque A2b — docs/modulos/agente-cerebro.md §6/§11):
   * antes, `usersService.findOne(id)` cargaba CUALQUIER usuario por id, sin
   * verificar que perteneciera al condominio de la sesión — un id de OTRO
   * condominio (adivinado, filtrado desde otra sesión, o inyectado por un
   * modelo comprometido) se notificaba/asignaba como host igual. Ahora se
   * exige que `user.family.organizationId` coincida con `tenantScope`
   * (mismo criterio que `scopeWhere`/`stampOrganizationId` del resto del
   * sistema — super-admin sin restricción, resto exige igualdad exacta
   * incluyendo el caso `null === null`) ANTES de aceptarlo como destinatario
   * válido; un id que no matchea se descarta igual que un id inexistente
   * (mismo log + mismo comportamiento observable para el modelo).
   */
  async notifyResident(
    session: ConciergeSession,
    params: { residentes_ids: string[] },
    tenantScope: TenantScope,
  ) {
    this.logger.debug(`Notifying residents:`, params.residentes_ids);

    try {
      // Validar que hay al menos un residente
      if (!params.residentes_ids || params.residentes_ids.length === 0) {
        throw new BadRequestException('No se proporcionaron IDs de residentes');
      }

      // Obtener todos los residentes, ignorando los que no se encuentren (ej.
      // usuarios eliminados) o no pertenezcan al condominio de esta sesión
      // (fix M1, ver docstring del método).
      const validResidents: User[] = [];
      for (const id of params.residentes_ids) {
        try {
          const user = await this.usersService.findOne(id);
          if (!user) {
            continue;
          }

          const userOrganizationId = user.family?.organizationId ?? null;
          if (!tenantScope.isSuperAdmin && userOrganizationId !== tenantScope.tenantId) {
            this.logger.warn(
              `Fix M1: residente ${id} pertenece a otro condominio (organizationId=${userOrganizationId ?? 'null'}, esperado=${tenantScope.tenantId ?? 'null'}) — se ignora.`,
            );
            continue;
          }

          validResidents.push(user);
        } catch (error) {
          this.logger.warn(`No se pudo cargar el residente con ID ${id}: ${error.message}`);
        }
      }

      if (validResidents.length === 0) {
        throw new NotFoundException('No se encontraron residentes válidos para notificar');
      }

      // Guardar residentes notificados en la sesión
      session.residentsNotified = validResidents.map(r => ({
        id: r.id,
        name: r.name,
        responded: false,
      }));
      session.residentResponse = 'pending';

      // NUEVO: Crear visita en estado PENDING inmediatamente
      // Validar datos requeridos
      if (!session.visitorName || !session.destinationHouse) {
        throw new BadRequestException('Faltan datos requeridos del visitante (nombre, casa)');
      }

      // IMPORTANTE: Usar el primer residente solo como PLACEHOLDER temporal
      // El host definitivo se asignará cuando algún residente apruebe la visita
      const temporaryHost = validResidents[0];

      // Crear visita en estado PENDING
      const visitType = session.vehiclePlate ? VisitType.VEHICULAR : VisitType.PEDESTRIAN;

      const visit = await this.visitsService.create({
        visitorName: session.visitorName,
        visitorRut: session.visitorRut ?? undefined,
        visitorPhone: session.visitorPhone ?? undefined,
        vehiclePlate: session.vehiclePlate ?? undefined,
        reason: session.visitReason || 'Visita',
        type: visitType,
        hostId: temporaryHost.id, // Host temporal - se actualizará al aprobar
        // familyId se asigna automáticamente desde el anfitrión
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 horas
        maxUses: 1,
        status: VisitStatus.PENDING, // Estado inicial: PENDING
      });

      // Guardar la visita creada en la sesión
      session.createdVisit = visit;
      await this.sessionRepository.save(session);

      this.logger.log(`✅ Visita creada en estado PENDING: ${visit.id}`);
      this.logger.log(`⚠️ Host temporal: ${temporaryHost.name} (id: ${temporaryHost.id})`);

      // NUEVO: Enviar notificación a TODOS los residentes de la familia
      const notifications = await Promise.all(
        validResidents.map(resident => 
          this.notificationsService.notifyVisitorArrival(
            resident.id,
            session.sessionId,
            {
              name: session.visitorName || 'Visitante',
              rut: session.visitorRut ?? undefined,
              phone: session.visitorPhone ?? undefined,
              plate: session.vehiclePlate ?? undefined,
              reason: session.visitReason ?? undefined,
            },
          )
        )
      );

      this.logger.log(`📬 ${notifications.length} notificaciones creadas para todos los miembros de la familia`);

      return {
        notificado: true,
        residentes_notificados: validResidents.map(r => r.name),
        cantidad_notificados: validResidents.length,
        visita_creada: true,
        visita_id: visit.id,
        mensaje: `Notificación enviada a ${validResidents.length} residente(s) y visita creada en estado pendiente. Esperando respuesta...`,
      };
    } catch (error) {
      this.logger.error(`Error notifying resident: ${error.message}`);
      return {
        notificado: false,
        mensaje: 'Error al enviar la notificación. Por favor intente nuevamente.',
      };
    }
  }

  /**
   * Reenvía la notificación a los residentes que ya estaban en la lista (si hubo timeout)
   */
  async resendNotification(session: ConciergeSession) {
    this.logger.debug(`Resending notification for session: ${session.sessionId}`);

    if (!session.residentsNotified || session.residentsNotified.length === 0) {
      return {
        reenviado: false,
        mensaje: "No hay residentes previos a quienes reenviar la notificación.",
      };
    }

    try {
      await Promise.all(
        session.residentsNotified.map(resident => 
          this.notificationsService.notifyVisitorArrival(
            resident.id,
            session.sessionId,
            {
              name: session.visitorName || 'Visitante',
              rut: session.visitorRut ?? undefined,
              phone: session.visitorPhone ?? undefined,
              plate: session.vehiclePlate ?? undefined,
              reason: session.visitReason ?? undefined,
            },
          )
        )
      );

      this.logger.log(`📬 Notificaciones reenviadas a ${session.residentsNotified.length} residentes`);

      return {
        reenviado: true,
        mensaje: "Notificación reenviada. Diles que vas a seguir esperando un momento.",
      };
    } catch (error) {
      this.logger.error(`Error resending notification: ${error.message}`);
      return {
        reenviado: false,
        mensaje: "Hubo un error al intentar reenviar la notificación.",
      };
    }
  }

  /**
   * Genera el string de contexto de historial para inyectar en el Prompt de IA
   */
  async getHouseContext(houseNumber: string): Promise<string> {
    try {
      const family = await this.familiesService.findByDepartment(houseNumber);
      if (!family) {
        return 'Sin contexto histórico previo para esta casa.';
      }

      // Sin sesión de usuario (ver comentario en respondToVisitor) — ya está
      // acotado a UNA familia resource-derived (familyId), que a su vez
      // pertenece a un único condominio, así que el bypass no reabre el leak
      // cross-tenant que motivó esta tarea.
      const visits = await this.visitsService.findAll({ familyId: family.id }, { skipTenantScope: true });
      const today = new Date();
      
      // Filtrar pre-aprobadas para hoy
      const preAprobadas = visits.filter(v => 
        v.status === VisitStatus.PENDING && 
        new Date(v.validFrom) <= today && 
        new Date(v.validUntil) >= today
      );

      // Frecuentes (COMPLETED)
      const frecuentes = visits.filter(v => v.status === VisitStatus.COMPLETED);
      
      // Obtener nombres únicos (hasta 5)
      const nombresFrecuentes = Array.from(new Set(frecuentes.map(v => v.visitorName))).filter(n => n).slice(0, 5);

      let contextStr = '';
      if (preAprobadas.length > 0) {
        contextStr += `ATENCIÓN - VISITAS PRE-APROBADAS HOY (Tienen pase directo): ${preAprobadas.map(v => v.visitorName).join(', ')}. `;
      }
      if (nombresFrecuentes.length > 0) {
        contextStr += `VISITANTES FRECUENTES (Reconócelos amistosamente): ${nombresFrecuentes.join(', ')}.`;
      }

      return contextStr || 'Esta casa no tiene visitas pre-aprobadas ni frecuentes registradas.';
    } catch (e) {
      this.logger.warn(`Error al obtener contexto de casa ${houseNumber}: ${e.message}`);
      return 'No se pudo obtener el historial de visitas.';
    }
  }



  // ========== HELPERS ==========

  async findSessionById(sessionId: string): Promise<ConciergeSession> {
    const session = await this.sessionRepository.findOne({
      where: { sessionId },
      relations: ['createdVisit'],
    });

    if (!session) {
      throw new NotFoundException(`Session not found: ${sessionId}`);
    }

    return session;
  }

  /**
   * Resuelve una `ConciergeSession` Y verifica que pertenezca al condominio
   * de `tenantScope` (Fase 1, Bloque A2b — docs/modulos/agente-cerebro.md
   * §6: "toda tool y todo lookup filtran por el condominio activo"). Punto
   * de entrada único que usan los adaptadores `VigiliaTool` de
   * `agent/tools/*.tool.ts` que operan sobre una sesión de citófono
   * (`guardar_datos_visitante`, `notificar_residente`, `reenviar_notificacion`,
   * `finalizar_llamada`) — evita que el contexto del condominio A pueda leer
   * o mutar una `ConciergeSession` que originó el condominio B, aunque
   * conozca (o adivine) su `sessionId`.
   */
  async findSessionForTenant(
    sessionId: string,
    tenantScope: TenantScope,
  ): Promise<ConciergeSession> {
    const session = await this.findSessionById(sessionId);

    if (!tenantScope.isSuperAdmin && session.organizationId !== tenantScope.tenantId) {
      throw new ForbiddenException(
        `La sesión "${sessionId}" no pertenece al condominio del contexto autorizado`,
      );
    }

    return session;
  }

  /**
   * Genera un QR code y lo envía por SMS al visitante
   * El QR se usa para registrar la salida del condominio
   */
  private async sendQRToVisitor(visitId: string, visitorName: string, visitorPhone: string): Promise<void> {
    this.logger.log(`📱 Generando y enviando QR para visita ${visitId}`);

    try {
      // 1. Generar QR code para salida (checkout)
      const qrDataUrl = await this.qrcodeService.generateVisitQR(visitId, 'checkout');

      // 2. Enviar QR por SMS
      await this.smsService.sendQRCodeSMS({
        phone: visitorPhone,
        visitorName,
        qrDataUrl,
        visitId,
      });

      this.logger.log(`✅ QR enviado exitosamente a ${visitorPhone} para visita ${visitId}`);
    } catch (error) {
      this.logger.error(`Error sending QR to visitor:`, error);
      throw error;
    }
  }
}
