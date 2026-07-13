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
import { applyTenantFilter } from '../common/tenant/tenant-context.util';
import type { TenantContext } from '../common/tenant/tenant-context.types';

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

    // FIX aislamiento cross-tenant en la apertura física autónoma del portón
    // (rama feature/cierre-fases-1-2, hallazgo reportado): hasta acá, la
    // búsqueda de vehículo/visita para decidir si abrir el portón se hacía
    // con `skipTenantScope: true` (TODOS los condominios) — una visita o
    // vehículo pre-aprobado del condominio B abría el portón físico del
    // condominio A si una cámara de A leía esa patente. El `organizationId`
    // de la CÁMARA (resource-derived, `saved.organizationId` arriba) es la
    // fuente de tenant confiable en este flujo (el worker LPR no tiene
    // `request.user`), así que se usa para acotar ambas búsquedas al MISMO
    // condominio de la cámara — ver `VehiclesService.findByPlate` y
    // `VisitsService.findByPlate`/`validateAccess`, que ahora aceptan este
    // scope explícito además de `skipTenantScope`.
    //
    // Fail-closed: si la cámara no tiene organizationId (legacy, pre-tarea
    // #19), no hay ningún tenant confiable con el cual acotar la búsqueda —
    // abrir igual (o buscar sin scope) reintroduciría el mismo leak. Se
    // deriva directo a aprobación manual del conserje, sin ejecutar ninguna
    // búsqueda de vehículo/visita (createPendingDetectionForConcierge ya
    // maneja bien organizationId === null, ver sendDetectionNotifications).
    if (!saved.organizationId) {
      this.logger.warn(
        `Detección de patente ${dto.plate} en cámara sin organizationId (legacy, pre-tarea #19) — fail-closed, requiere aprobación manual del conserje`,
      );
      return await this.createPendingDetectionForConcierge(
        saved,
        'Cámara sin condominio asignado - requiere aprobación manual',
      );
    }

    const cameraOrganizationId = saved.organizationId;

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

    // 1. Verificar si es un vehículo registrado (scopeado al condominio de la cámara)
    const vehicle = await this.vehiclesService.findByPlate(dto.plate, { organizationId: cameraOrganizationId });
    
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
          // Fix cross-tenant (rama feature/cierre-fases-1-2 — ver docstring
          // grande arriba, sobre `saved`): el worker LPR sin sesión de
          // usuario (ServiceApiKeyGuard, no puebla request.user) no puede
          // resolver el tenant vía TenantContextService, pero SÍ conoce el
          // organizationId de la cámara (resource-derived). Se acota la
          // búsqueda de la visita a ESE condominio en vez de saltarse el
          // scoping (antes `skipTenantScope: true` buscaba en TODOS los
          // condominios — la causa raíz del leak).
          const visitValidation = await this.visitsService.validateAccess(dto.plate, 'plate', { organizationId: cameraOrganizationId });

          if (visitValidation.valid && visitValidation.visit) {
            const visit = visitValidation.visit;
            decision = 'Permitido';
            residente = visit.host; // El anfitrión es el residente

            // Determinar si es entrada o salida basado en el estado de la visita
            if (visit.status === 'pending' || visit.status === 'ready') {
              // Entrada: Visita pendiente o lista para reingreso → registrar check-in
              await this.visitsService.checkIn(visit.id, { organizationId: cameraOrganizationId });
              reason = visit.status === 'pending'
                ? `Entrada autorizada - ${visit.visitorName}`
                : `Reingreso autorizado - ${visit.visitorName}`;
              isExit = false;
            } else if (visit.status === 'active') {
              // Salida: Visita activa → registrar check-out
              await this.visitsService.checkOut(visit.id, { organizationId: cameraOrganizationId });
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
        // Ver comentario equivalente más arriba: mismo fix cross-tenant,
        // scopeado explícitamente al condominio de la cámara.
        const visitValidation = await this.visitsService.validateAccess(dto.plate, 'plate', { organizationId: cameraOrganizationId });

        if (visitValidation.valid && visitValidation.visit) {
          const visit = visitValidation.visit;
          decision = 'Permitido';
          residente = visit.host;

          // Determinar si es entrada o salida basado en el estado de la visita
          if (visit.status === 'pending' || visit.status === 'ready') {
            // Entrada: Visita pendiente o lista para reingreso → registrar check-in
            await this.visitsService.checkIn(visit.id, { organizationId: cameraOrganizationId });
            reason = visit.status === 'pending'
              ? `Entrada autorizada - ${visit.visitorName}`
              : `Reingreso autorizado - ${visit.visitorName}`;
            isExit = false;
          } else if (visit.status === 'active') {
            // Salida: Visita activa → registrar check-out
            await this.visitsService.checkOut(visit.id, { organizationId: cameraOrganizationId });
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
    await this.sendDetectionNotifications(dto.plate, decision, reason, isExit, residente, vehicle, saved.organizationId);

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

  /**
   * Fase 2, Bloque F2.1 (docs/modulos/agente-cerebro.md §12): `tenantScope`
   * es OPCIONAL y ADITIVO — el caller existente (`DetectionsController`,
   * gap conocido de tarea #19: "filtrado por tenant... queda PENDIENTE")
   * sigue llamando sin este parámetro y mantiene su comportamiento actual
   * (sin filtrar). La tool `consultar_accesos_recientes` es la primera en
   * pasarlo, porque SÍ tiene un `AuthorizedContext` con tenant resuelto y NO
   * puede confiar en el default sin filtro.
   */
  async listAttempts(limit = 50, tenantScope?: TenantContext) {
    const query = this.attemptsRepo
      .createQueryBuilder('attempt')
      .leftJoinAndSelect('attempt.detection', 'detection')
      .leftJoinAndSelect('attempt.residente', 'residente')
      .leftJoinAndSelect('residente.family', 'family')
      .orderBy('attempt.createdAt', 'DESC')
      .take(limit);

    if (tenantScope) {
      applyTenantFilter(query, 'attempt', tenantScope);
    }

    return query.getMany();
  }

  /**
   * Enviar notificaciones de detección según el tipo de vehículo
   * - Si es un vehículo de visita: notificar a la familia y al conserje
   * - Cualquier otra detección: notificar solo al conserje
   *
   * Fix cross-tenant (mismo leak que `createPendingDetectionForConcierge`,
   * cerrado en el mismo follow-up): notificar a los conserjes vía
   * `notifyByRoleForOrganization` (filtra por la tabla `member`) en vez de
   * `notifyByRole`, que ignora la organización y llegaba a los conserjes de
   * TODOS los condominios en CADA detección de patente (no solo las
   * pendientes). El aviso directo al host (`notificationsService.create` más
   * abajo) no necesita este scoping: va a un `recipientId` puntual ya
   * resuelto (el residente/host de la visita), no es un broadcast por rol.
   */
  private async sendDetectionNotifications(
    plate: string,
    decision: string,
    reason: string,
    isExit: boolean,
    residente: User | null,
    vehicle: any,
    organizationId: string | null,
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
        // Notificar solo al host (creador de la visita) — recipientId puntual,
        // no un broadcast por rol, no requiere scoping por organización.
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

      // Notificar a los conserjes del MISMO condominio que la detección.
      // Fail-closed en cámaras legacy sin organización asignada
      // (organizationId === null, pre-tarea #19): en vez de dejar que
      // `notifyByRoleForOrganization` compare "null === null" (que en teoría
      // podría calzar con un conserje sin membresía registrada), se opta
      // explícitamente por NO notificar a nadie — preferible a arriesgar un
      // broadcast o un match accidental cross-tenant.
      if (organizationId === null) {
        this.logger.warn(
          `Detección de patente ${plate} sin organizationId (cámara legacy) — no se notifica a conserjes (fail-closed)`,
        );
      } else {
        await this.notificationsService.notifyByRoleForOrganization(
          'Conserje',
          organizationId,
          notificationType,
          `Detección de Vehículo - ${actionCapitalized}`,
          `Se detectó la ${action} del vehículo con patente ${plate}. Decisión: ${decision}. ${reason}`,
          { priority },
        );

        this.logger.log(`Notificación enviada a conserjes para detección ${plate}`);
      }
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
    
    // Fix cross-tenant (follow-up post-auditoría Fase 0/1): notificar SOLO a
    // los conserjes del condominio de la detección (vía `notifyByRoleForOrganization`,
    // que filtra por la tabla `member`) — antes se usaba `notifyByRole`, que
    // notifica a TODOS los conserjes de la plataforma sin importar su
    // organización, filtrando conserjes de otros condominios con la
    // detección pendiente de otro.
    const notifications = await this.notificationsService.notifyByRoleForOrganization(
      'Conserje',
      detection.organizationId,
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

