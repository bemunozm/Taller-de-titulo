import { Injectable, NotFoundException, forwardRef, Inject, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import { CreateAccessAttemptDto } from './dto/create-access-attempt.dto';
import { RespondPendingDetectionDto } from './dto/respond-pending-detection.dto';
import { VehiclesService } from '../vehicles/vehicles.service';
import { VisitsService } from '../visits/visits.service';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { NotificationType, NotificationPriority } from '../notifications/entities/notification.entity';
import { HubGateway } from '../hub/hub.gateway';

@Injectable()
export class DetectionsService {
  private readonly logger = new Logger(DetectionsService.name);

  constructor(
    @InjectRepository(PlateDetection)
    private readonly detectionsRepo: Repository<PlateDetection>,
    @InjectRepository(AccessAttempt)
    private readonly attemptsRepo: Repository<AccessAttempt>,
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
    private readonly hubGateway: HubGateway,
    @Inject(forwardRef(() => VisitsService))
    private readonly visitsService: VisitsService,
  ) {}

  /**
   * Tarea #19 (docs/modulos/auth-multitenant.md §7): resuelve el
   * `organizationId` de la cámara asociada a una detección. RESOURCE-DERIVED
   * (no TenantContext): estos endpoints los llama el worker LPR sin sesión de
   * usuario (`POST /detections/plates`, sin AuthGuard — ver
   * DetectionsController). Réplica minimalista de
   * `CamerasService.resolveCameraByIdOrMount` (id UUID o mountPath, limpiando
   * el sufijo `_guardia` del worker manager) para no acoplar módulos.
   */
  private async resolveCameraOrganizationId(cameraIdOrMount: string): Promise<string | null> {
    if (!cameraIdOrMount) return null;
    const cleanId = cameraIdOrMount.replace('_guardia', '');
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanId);

    const camera = isUuid
      ? await this.cameraRepository.findOne({ where: { id: cleanId } })
      : await this.cameraRepository.findOne({ where: { mountPath: cleanId } });

    return camera?.organizationId ?? null;
  }

  async createDetection(dto: CreatePlateDetectionDto) {
    // Mapear DTO a la entidad PlateDetection. Usamos el campo `meta` como JSONB
    // para guardar bbox, snapshot y estadísticas de caracteres.
    const ent = this.detectionsRepo.create(dto);
    // Tarea #19: estampar organizationId derivado de la cámara (ver docstring
    // de resolveCameraOrganizationId arriba).
    ent.organizationId = await this.resolveCameraOrganizationId(dto.cameraId);

    // `create()` solo instancia la entidad; `save()` persiste en la BD.
    const saved = await this.detectionsRepo.save(ent);

    // Validar acceso siguiendo este orden de prioridad:
    // 1. Vehículo residente registrado y activo
    // 2. Visita vehicular válida y dentro del período
    // 3. Auto check-in si es entrada (PENDING → ACTIVE)
    // 4. Auto check-out si es salida (ACTIVE → COMPLETED)
    // 5. Denegado en cualquier otro caso
    
    let decision: string;
    let reason: string;
    let residente: User | null = null;
    let isExit = false; // Flag para identificar si es una salida

    // 1. Verificar si es un vehículo registrado
    const vehicle = await this.vehiclesService.findByPlate(dto.plate);
    
    if (vehicle && vehicle.active) {
      // Verificar el tipo de vehículo
      if (vehicle.vehicleType === 'residente' || vehicle.accessLevel === 'permanente') {
        // Vehículo residente con acceso permanente
        decision = 'Permitido';
        reason = 'Vehículo residente registrado y activo';
        residente = vehicle.owner;
      } else if (vehicle.vehicleType === 'visitante' || vehicle.accessLevel === 'temporal') {
        // Vehículo de visitante, verificar si tiene visita válida
        try {
          // Tarea de aislamiento tenant (branch fix/visits-tenant-isolation):
          // este endpoint lo llama el worker LPR sin sesión de usuario
          // (ServiceApiKeyGuard, no puebla request.user) — TenantContextService
          // no puede resolver el condominio del caller. `skipTenantScope`
          // preserva el comportamiento resource-derived existente (igual que
          // resolveCameraOrganizationId arriba): la patente ya es el criterio
          // de búsqueda, no hace falta acotar por tenant para no romper el
          // flujo de apertura automática.
          const visitValidation = await this.visitsService.validateAccess(dto.plate, 'plate', { skipTenantScope: true });

          if (visitValidation.valid && visitValidation.visit) {
            const visit = visitValidation.visit;
            decision = 'Permitido';
            residente = visit.host; // El anfitrión es el residente

            // Determinar si es entrada o salida basado en el estado de la visita
            if (visit.status === 'pending' || visit.status === 'ready') {
              // Entrada: Visita pendiente o lista para reingreso → registrar check-in
              await this.visitsService.checkIn(visit.id, { skipTenantScope: true });
              reason = visit.status === 'pending'
                ? `Entrada autorizada - ${visit.visitorName}`
                : `Reingreso autorizado - ${visit.visitorName}`;
              isExit = false;
            } else if (visit.status === 'active') {
              // Salida: Visita activa → registrar check-out
              await this.visitsService.checkOut(visit.id, { skipTenantScope: true });
              reason = `Salida registrada - ${visit.visitorName}`;
              isExit = true;
            } else {
              // Visita ya completada o en otro estado
              reason = `Visita ${visit.status} - ${visit.visitorName}`;
              isExit = false;
            }
          } else {
            decision = 'Denegado';
            reason = visitValidation.message || 'Visita no válida o expirada';
          }
        } catch (error) {
          this.logger.error(`Error al validar visita para vehículo visitante ${dto.plate}:`, error);
          decision = 'Denegado';
          reason = 'Error al validar visita';
        }
      } else {
        // Vehículo activo pero sin tipo específico, permitir por defecto
        decision = 'Permitido';
        reason = 'Vehículo registrado y activo';
        residente = vehicle.owner;
      }
    } else if (!vehicle) {
      // No existe el vehículo, verificar si hay una visita programada
      try {
        // Ver comentario equivalente más arriba: worker LPR sin sesión de
        // usuario, bypass explícito del scoping por tenant.
        const visitValidation = await this.visitsService.validateAccess(dto.plate, 'plate', { skipTenantScope: true });

        if (visitValidation.valid && visitValidation.visit) {
          const visit = visitValidation.visit;
          decision = 'Permitido';
          residente = visit.host;

          // Determinar si es entrada o salida basado en el estado de la visita
          if (visit.status === 'pending' || visit.status === 'ready') {
            // Entrada: Visita pendiente o lista para reingreso → registrar check-in
            await this.visitsService.checkIn(visit.id, { skipTenantScope: true });
            reason = visit.status === 'pending'
              ? `Entrada autorizada - ${visit.visitorName}`
              : `Reingreso autorizado - ${visit.visitorName}`;
            isExit = false;
          } else if (visit.status === 'active') {
            // Salida: Visita activa → registrar check-out
            await this.visitsService.checkOut(visit.id, { skipTenantScope: true });
            reason = `Salida registrada - ${visit.visitorName}`;
            isExit = true;
          } else {
            reason = `Visita ${visit.status} - ${visit.visitorName}`;
            isExit = false;
          }
        } else {
          // No hay visita válida, enviar a aprobación del conserje
          return await this.createPendingDetectionForConcierge(saved, visitValidation.message || 'Vehículo no registrado y sin visita autorizada');
        }
      } catch (error) {
        this.logger.error(`Error al validar visita para patente ${dto.plate}:`, error);
        // En caso de error, enviar a aprobación del conserje
        return await this.createPendingDetectionForConcierge(saved, 'Error al validar - requiere aprobación manual');
      }
    } else {
      // Vehículo existe pero está inactivo, enviar a aprobación del conserje
      return await this.createPendingDetectionForConcierge(saved, 'Vehículo inactivo - requiere aprobación');
    }

    // Calcular tiempo de respuesta: T2 (ahora) - T1 (detectionTimestamp del LPR o createdAt como fallback)
    // Si el LPR envió detectionTimestamp, usar ese valor para mayor precisión
    // Sino, usar createdAt (timestamp de recepción en backend)
    const t1 = saved.detectionTimestamp || saved.createdAt.getTime();
    const responseTimeMs = Date.now() - t1;

    const att = this.attemptsRepo.create({
      detection: saved,
      decision,
      reason,
      method: isExit ? 'Patente - Salida' : 'Patente - Entrada',
      residente,
      responseTimeMs, // Guardar métrica de tiempo de respuesta
      organizationId: saved.organizationId, // Tarea #19: hereda de la detección
    });

    const savedAtt = await this.attemptsRepo.save(att);

    // Log de rendimiento si el tiempo supera el umbral de 5 segundos
    if (responseTimeMs > 5000) {
      this.logger.warn(
        `⚠️ Tiempo de respuesta alto: ${responseTimeMs}ms para detección ${saved.id} (${dto.plate})`
      );
    }

    // Enviar notificaciones según el tipo de detección
    await this.sendDetectionNotifications(dto.plate, decision, reason, isExit, residente, vehicle);

    // AUTO-APERTURA INTEGRADADA AL HUB:
    // Si la placa está autorizada, mandamos evento directo a la Raspberry Pi saltándonos a Sofía
    if (decision === 'Permitido') {
      this.logger.log(`🚗 Placa autorizada (${dto.plate}) detectada. Enviando comando de apertura al Portón Vehicular...`);
      // Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — hallazgo
      // H2 de la auditoría, reportado también aquí aunque no era el foco del
      // bloque): mismo patrón que `DigitalConciergeService.respondToVisitor` —
      // antes `broadcastToAllHubs` abría el portón físico de TODOS los
      // condominios ante una patente autorizada en UNO solo. Se dirige por
      // `organizationId` de la detección (`saved.organizationId`, tarea #19).
      this.hubGateway.sendToOrganization(saved.organizationId, 'hub:door_open', {
        type: 'vehicular',
        plate: dto.plate,
      });
    }

    return { detection: saved, attempt: savedAtt, isExit };
  }

  async listDetections(filters?: { familyId?: string }, limit = 50) {
    const query = this.detectionsRepo
      .createQueryBuilder('detection')
      .leftJoinAndSelect('detection.accessAttempts', 'attempts')
      .orderBy('detection.createdAt', 'DESC')
      .take(limit);

    // Si hay filtro por familyId, obtener solo detecciones de vehículos de esa familia
    if (filters?.familyId) {
      // Obtener usuarios de la familia
      const familyUsers = await this.usersService.findByFamily(filters.familyId);
      const userIds = familyUsers.map(u => u.id);
      
      if (userIds.length === 0) {
        return [];
      }
      
      // Obtener patentes de vehículos de esos usuarios
      const vehicles = await this.vehiclesService.findByOwnerIds(userIds);
      const plates = vehicles.map(v => v.plate.toUpperCase());
      
      if (plates.length === 0) {
        return [];
      }
      
      // Filtrar detecciones por esas patentes
      query.where('UPPER(detection.plate) IN (:...plates)', { plates });
      
      this.logger.debug(`🔍 Filtrando detecciones por familia ${filters.familyId}: ${plates.length} patentes`);
    }

    return query.getMany();
  }

  async createAttempt(dto: CreateAccessAttemptDto) {
    const det = await this.detectionsRepo.findOne({ where: { id: dto.detectionId } });
    if (!det) throw new NotFoundException('detection not found');
    
    // Calcular tiempo de respuesta usando detectionTimestamp si está disponible
    const t1 = det.detectionTimestamp || det.createdAt.getTime();
    const responseTimeMs = Date.now() - t1;
    
    const att = this.attemptsRepo.create({
      detection: det,
      decision: dto.decision,
      reason: dto.reason ?? null,
      method: dto.method ?? null,
      responseTimeMs,
      organizationId: det.organizationId, // Tarea #19: hereda de la detección
    });
    if (dto.residenteId) {
      (att as any).residente = { id: dto.residenteId };
    }
    return this.attemptsRepo.save(att);
  }

  async listAttempts(limit = 50) {
    return this.attemptsRepo.find({ 
      relations: ['detection', 'residente', 'residente.family'], 
      take: limit, 
      order: { createdAt: 'DESC' } 
    });
  }

  /**
   * Enviar notificaciones de detección según el tipo de vehículo
   * - Si es un vehículo de visita: notificar a la familia y al conserje
   * - Cualquier otra detección: notificar solo al conserje
   */
  private async sendDetectionNotifications(
    plate: string,
    decision: string,
    reason: string,
    isExit: boolean,
    residente: User | null,
    vehicle: any,
  ) {
    try {
      const action = isExit ? 'salida' : 'entrada';
      const actionCapitalized = isExit ? 'Salida' : 'Entrada';
      
      // Determinar el tipo de notificación según la decisión
      const notificationType = decision === 'Permitido' 
        ? NotificationType.VEHICLE_DETECTED 
        : NotificationType.UNKNOWN_VEHICLE;

      // Prioridad alta para accesos denegados, normal para permitidos
      const priority = decision === 'Permitido' 
        ? NotificationPriority.NORMAL 
        : NotificationPriority.HIGH;

      // Si el vehículo es de tipo visitante y hay un residente (host) asociado
      if (vehicle?.vehicleType === 'visitante' && residente) {
        // Notificar solo al host (creador de la visita)
        await this.notificationsService.create({
          recipientId: residente.id,
          type: notificationType,
          title: `${actionCapitalized} de Visita Detectada`,
          message: `Se detectó la ${action} del vehículo de visita con patente ${plate}. ${reason}`,
          priority,
          data: {
            plate,
            decision,
            reason,
            isExit,
            detectionType: 'visit',
          },
        });
        
        this.logger.log(`Notificación de visita enviada al host para patente ${plate}`);
      }

      // Siempre notificar a todos los conserjes
      await this.notificationsService.notifyByRole(
        'Conserje',
        notificationType,
        `Detección de Vehículo - ${actionCapitalized}`,
        `Se detectó la ${action} del vehículo con patente ${plate}. Decisión: ${decision}. ${reason}`,
        { priority },
      );

      this.logger.log(`Notificación enviada a conserjes para detección ${plate}`);
    } catch (error) {
      this.logger.error(`Error al enviar notificaciones de detección: ${error.message}`, error.stack);
      // No lanzar el error para no interrumpir el flujo de detección
    }
  }

  /**
   * Crear una detección pendiente que requiere aprobación del conserje
   */
  private async createPendingDetectionForConcierge(detection: PlateDetection, reason: string) {
    this.logger.log(`🔔 Creando detección pendiente para patente ${detection.plate} - Razón: ${reason}`);
    
    // Calcular tiempo de respuesta: tiempo desde detección hasta envío de notificación al conserje
    const t1 = detection.detectionTimestamp || detection.createdAt.getTime();
    const responseTimeMs = Date.now() - t1;
    
    // Crear AccessAttempt con decisión "Pendiente" (expira en 5 minutos)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);
    
    const attempt = this.attemptsRepo.create({
      detection,
      decision: 'Pendiente',
      reason,
      method: 'Patente - Requiere Aprobación',
      residente: null,
      expiresAt,
      respondedBy: null,
      respondedAt: null,
      responseTimeMs, // Tiempo hasta notificación al conserje
      organizationId: detection.organizationId, // Tarea #19: hereda de la detección
    });
    
    const savedAttempt = await this.attemptsRepo.save(attempt);
    
    // Log de rendimiento si el tiempo supera el umbral de 5 segundos
    if (responseTimeMs > 5000) {
      this.logger.warn(
        `⚠️ Tiempo de respuesta alto para notificación pendiente: ${responseTimeMs}ms para detección ${detection.id} (${detection.plate})`
      );
    }
    
    // Notificar a todos los conserjes
    const notifications = await this.notificationsService.notifyByRole(
      'Conserje',
      NotificationType.UNKNOWN_VEHICLE,
      'Vehículo No Reconocido - Requiere Aprobación',
      `Se detectó el vehículo con patente ${detection.plate}. ${reason}. Por favor, revisa y toma una decisión.`,
      {
        priority: NotificationPriority.HIGH,
        data: {
          attemptId: savedAttempt.id,
          detectionId: detection.id,
          plate: detection.plate,
          reason,
          expiresAt: expiresAt.toISOString(),
          fullFramePath: detection.full_frame_path,
          requiresAction: true,
        },
      },
    );
    
    // Guardar el ID de la notificación (tomamos la primera ya que notifyByRole devuelve array)
    if (notifications && notifications.length > 0) {
      savedAttempt.notificationId = notifications[0].id;
      await this.attemptsRepo.save(savedAttempt);
    }
    
    this.logger.log(`✅ Detección pendiente creada con ID ${savedAttempt.id}`);
    
    return {
      detection,
      attempt: savedAttempt,
      requiresApproval: true,
    };
  }

  /**
   * Responder a una detección pendiente (aprobar o rechazar)
   */
  async respondToPendingDetection(
    attemptId: string,
    userId: string,
    dto: RespondPendingDetectionDto,
  ) {
    const attempt = await this.attemptsRepo.findOne({
      where: { id: attemptId },
      relations: ['detection', 'respondedBy'],
    });
    
    if (!attempt) {
      throw new NotFoundException('Intento de acceso no encontrado');
    }
    
    if (attempt.decision !== 'Pendiente') {
      throw new BadRequestException(`Este intento ya fue procesado con decisión: ${attempt.decision}`);
    }
    
    // Verificar que no haya expirado
    if (attempt.expiresAt && new Date() > attempt.expiresAt) {
      attempt.decision = 'Expirado';
      attempt.reason = 'Tiempo de decisión expirado';
      await this.attemptsRepo.save(attempt);
      throw new BadRequestException('Esta detección ha expirado');
    }
    
    // Obtener el usuario que responde (conserje)
    const concierge = await this.usersService.findOne(userId);
    
    // Actualizar la decisión
    const decision = dto.decision === 'approved' ? 'Permitido' : 'Denegado';
    const finalReason = dto.response || (dto.decision === 'approved' 
      ? 'Aprobado manualmente por conserje' 
      : 'Rechazado manualmente por conserje');
    
    attempt.decision = decision;
    attempt.reason = `${attempt.reason} - ${finalReason}`;
    attempt.method = 'Manual - Conserje';
    attempt.respondedBy = concierge;
    attempt.respondedAt = new Date();
    
    const savedAttempt = await this.attemptsRepo.save(attempt);
    
    this.logger.log(
      `✅ Detección ${attemptId} ${dto.decision === 'approved' ? 'aprobada' : 'rechazada'} por conserje ${concierge.name}`,
    );
    
    return {
      attempt: savedAttempt,
      decision: dto.decision,
    };
  }

  /**
   * Listar detecciones pendientes
   */
  async listPendingDetections() {
    const now = new Date();
    
    // Primero marcar las expiradas
    await this.attemptsRepo
      .createQueryBuilder()
      .update(AccessAttempt)
      .set({ 
        decision: 'Expirado',
        reason: 'Tiempo de decisión expirado'
      })
      .where('decision = :decision', { decision: 'Pendiente' })
      .andWhere('expiresAt < :now', { now })
      .execute();
    
    // Luego obtener las que siguen pendientes
    return this.attemptsRepo.find({
      where: { decision: 'Pendiente' },
      relations: ['detection', 'respondedBy'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Verificar estado de una detección pendiente
   */
  async checkPendingDetectionStatus(attemptId: string) {
    const attempt = await this.attemptsRepo.findOne({
      where: { id: attemptId },
      relations: ['detection', 'respondedBy'],
    });
    
    if (!attempt) {
      return { active: false, reason: 'Intento de acceso no encontrado' };
    }
    
    if (attempt.decision !== 'Pendiente') {
      return { 
        active: false, 
        reason: `Intento ya procesado: ${attempt.decision}` 
      };
    }
    
    if (attempt.expiresAt && new Date() > attempt.expiresAt) {
      // Marcar como expirado
      attempt.decision = 'Expirado';
      attempt.reason = 'Tiempo de decisión expirado';
      await this.attemptsRepo.save(attempt);
      return { active: false, reason: 'Detección expirada' };
    }
    
    return { active: true };
  }
}

