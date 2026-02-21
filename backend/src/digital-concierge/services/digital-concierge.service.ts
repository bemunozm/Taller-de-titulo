import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConciergeSession, SessionStatus } from '../entities/concierge-session.entity';
import { OpenAITokenService } from './openai-token.service';
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

@Injectable()
export class DigitalConciergeService {
  private readonly logger = new Logger(DigitalConciergeService.name);

  constructor(
    @InjectRepository(ConciergeSession)
    private readonly sessionRepository: Repository<ConciergeSession>,
    private readonly tokenService: OpenAITokenService,
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
   */
  async startSession(socketId?: string) {
    this.logger.log('Starting new concierge session...');
    if (socketId) {
      this.logger.log(`Socket ID del visitante: ${socketId}`);
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
    });

    await this.sessionRepository.save(session);

    this.logger.log(`Session created: ${sessionId}`);

    return {
      sessionId,
      ephemeralToken: token,
      expiresAt,
    };
  }

  /**
   * Ejecuta una herramienta solicitada por el agente de OpenAI
   */
  async executeTool(sessionId: string, toolName: string, parameters: Record<string, any>) {
    this.logger.debug(`Executing tool: ${toolName} for session: ${sessionId}`);

    const session = await this.findSessionById(sessionId);

    // Log de la llamada
    const functionCall = {
      timestamp: new Date(),
      toolName,
      parameters,
    };

    try {
      let result: any;

      switch (toolName) {
        case 'guardar_datos_visitante':
          result = await this.saveVisitorData(session, parameters);
          break;

        case 'buscar_residente':
          result = await this.findResident(parameters as { casa: string });
          break;

        case 'notificar_residente':
          result = await this.notifyResident(session, parameters as { residentes_ids: string[] });
          break;

        default:
          throw new BadRequestException(`Unknown tool: ${toolName}`);
      }

      // Actualizar log de función
      session.functionCalls.push({ ...functionCall, result, success: true });
      await this.sessionRepository.save(session);

      return { success: true, data: result };
    } catch (error) {
      this.logger.error(`Tool execution failed: ${error.message}`, error.stack);
      
      session.functionCalls.push({ ...functionCall, error: error.message, success: false });
      await this.sessionRepository.save(session);

      return { success: false, error: error.message };
    }
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
        await this.visitsService.checkIn(session.createdVisit.id);
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
          const updatedVisit = await this.visitsService.update(session.createdVisit.id, { hostId: residentId });
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
    this.logger.log(`🎯 Enviando a todos los Hubs conectados vía HubGateway...`);
    this.hubGateway.broadcastToAllHubs(eventName, payload);

    this.logger.log(`✅ Notificación en tiempo real enviada para sesión ${sessionId}`);

    // NUEVO: Si la visita es aprobada, ordenar la apertura física de la puerta/portón al Hub
    if (approved && session.createdVisit) {
      const doorPayload = {
        type: session.createdVisit.type === VisitType.VEHICULAR ? 'vehicular' : 'pedestrian',
        visitId: session.createdVisit.id
      };
      
      this.logger.log(`🔑 Emitiendo comando de apertura de accesos al Hub (${doorPayload.type})`);
      this.hubGateway.broadcastToAllHubs('hub:door_open', doorPayload);
    }

    return {
      success: true,
      message: approved 
        ? 'Visita aprobada exitosamente' 
        : 'Visita rechazada exitosamente',
    };
  }

  // ========== HERRAMIENTAS ==========

  /**
   * Guarda datos del visitante en la sesión
   */
  private async saveVisitorData(session: ConciergeSession, data: any) {
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
   * Busca un residente por número de casa/departamento
   * Soporta múltiples formatos: "15", "Casa 15", "Depto A-1234", etc.
   */
  private async findResident(params: { casa: string }) {
    this.logger.debug(`Searching resident for house: ${params.casa}`);

    try {
      // Usar búsqueda flexible que maneja múltiples formatos
      const family = await this.familiesService.findByDepartment(params.casa);

      if (!family) {
        this.logger.debug(`No family found for search term: ${params.casa}`);
        return {
          encontrado: false,
          mensaje: `No se encontró ningún residente en ${params.casa}. El visitante debe verificar el número o nombre correcto de la casa/departamento.`,
        };
      }

      this.logger.debug(`Found family: ${family.name} - Unit: ${family.unit?.identifier || 'sin unidad'}`);

      // Obtener miembros de la familia (ya vienen en family.members)
      if (!family.members || family.members.length === 0) {
        return {
          encontrado: false,
          mensaje: `La casa/departamento "${family.unit?.identifier || params.casa}" existe pero no tiene residentes registrados`,
        };
      }

      // Devolver TODOS los miembros de la familia
      const residentes = family.members.map(member => ({
        id: member.id,
        nombre: member.name,
        telefono: member.phone,
      }));

      return {
        encontrado: true,
        casa: params.casa,
        residentes: residentes,
        cantidad_residentes: residentes.length,
        familia: family.name,
      };
    } catch (error) {
      this.logger.error(`Error finding resident: ${error.message}`);
      return {
        encontrado: false,
        mensaje: 'Error al buscar el residente. Por favor intente nuevamente.',
      };
    }
  }

  /**
   * Notifica a TODOS los residentes de la familia sobre la visita
   * NUEVO: Crea la visita en estado PENDING automáticamente
   */
  private async notifyResident(session: ConciergeSession, params: { residentes_ids: string[] }) {
    this.logger.debug(`Notifying residents:`, params.residentes_ids);

    try {
      // Validar que hay al menos un residente
      if (!params.residentes_ids || params.residentes_ids.length === 0) {
        throw new BadRequestException('No se proporcionaron IDs de residentes');
      }

      // Obtener todos los residentes, ignorando los que no se encuentren (ej. usuarios eliminados)
      const validResidents = [];
      for (const id of params.residentes_ids) {
        try {
          const user = await this.usersService.findOne(id);
          if (user) {
            validResidents.push(user);
          }
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



  // ========== HELPERS ==========

  private async findSessionById(sessionId: string): Promise<ConciergeSession> {
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
