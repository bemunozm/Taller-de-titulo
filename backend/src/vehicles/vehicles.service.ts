import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, FindOptionsWhere } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationType,
  NotificationPriority,
} from '../notifications/entities/notification.entity';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import {
  applyTenantFilter,
  isActiveMemberOfOrganization,
  scopeWhere,
} from '../common/tenant/tenant-context.util';
import type { FamilyScope } from '../common/tenant/tenant-actor';
import { vehicleAccessLevelRank } from './vehicle-access';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../common/utils/unique-violation.util';
import { maskPlate } from '../common/privacy/pii-mask';

/** Datos del vehículo que van en las notificaciones al propietario. */
type VehicleNotificationData = Pick<
  Vehicle,
  'id' | 'plate' | 'brand' | 'model'
> &
  Partial<Pick<Vehicle, 'color' | 'year'>>;

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    @InjectRepository(Vehicle) private readonly repo: Repository<Vehicle>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    // Tarea #19 / P5.B (D12): scoping por tenant en create/listAll/update/
    // remove y en `findByPlate` sin condominio explícito (ver su docstring).
    // `findByOwnerIds` sigue sin scopear (uso interno vía ownerIds ya
    // resueltos por tenant en el caller).
    private readonly tenantContext: TenantContextService,
    // P5.B: membresía del propietario (`isActiveMemberOfOrganization`).
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Fase 4 · P5.B: el propietario debe ser miembro ACTIVO del condominio del
   * vehículo (tabla `member` + cuenta no deshabilitada). Si no, 403 (también
   * si el usuario no existe: no se distingue, no enumera usuarios). Un
   * vehículo sin condominio (super-admin o cuenta sin membresía, hasta P5.C)
   * no puede tener propietario.
   */
  private async assertOwnerIsMember(
    ownerId: string,
    organizationId: string | null,
  ): Promise<void> {
    const isMember =
      organizationId !== null &&
      (await isActiveMemberOfOrganization(
        ownerId,
        organizationId,
        this.dataSource,
      ));
    if (!isMember) {
      throw new ForbiddenException(
        'El propietario debe ser un miembro activo del condominio del vehículo',
      );
    }
  }

  /**
   * Guarda el vehículo; si la BD rechaza la patente por duplicada en el
   * condominio (índice UNIQUE `(organizationId, plate)`, P5.B) responde 409,
   * no 500.
   */
  private async saveOrConflict(vehicle: Vehicle): Promise<Vehicle> {
    try {
      return await this.repo.save(vehicle);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Ya existe un vehículo con patente ${vehicle.plate} en este condominio`,
        );
      }
      throw error;
    }
  }

  /**
   * Ids de los usuarios cuyos vehículos alcanza un actor acotado a su familia
   * (Fase 4 · P5.C): él y los miembros de su familia; sin familia, solo él.
   */
  private async familyOwnerIds(scope: FamilyScope): Promise<string[]> {
    if (!scope.familyId) {
      return [scope.userId];
    }
    const members = await this.usersService.findByFamily(scope.familyId);
    return [...new Set([scope.userId, ...members.map((member) => member.id)])];
  }

  /**
   * Fase 4 · P5.C: un actor acotado a su familia solo asigna como propietario
   * a sí mismo o a un miembro de su familia (si no, 403).
   */
  private async assertOwnerInFamilyScope(
    ownerId: string,
    scope: FamilyScope | null,
  ): Promise<void> {
    if (!scope) {
      return;
    }
    if (!(await this.familyOwnerIds(scope)).includes(ownerId)) {
      throw new ForbiddenException(
        'Solo puedes registrar vehículos tuyos o de tu familia',
      );
    }
  }

  /**
   * Alta de un vehículo (`POST /vehicles`).
   *
   * Fase 4 · P5.C:
   *  - creación estricta: el condominio es el del actor; el super-admin debe
   *    indicar `organizationId` (400 sin él; 403 si lo envía otro actor; 403
   *    para un actor sin condominio);
   *  - un actor acotado a su familia (`scope`, sin `condominium.view-all`)
   *    registra vehículos suyos o de su familia: sin `ownerId`, el
   *    propietario es él mismo (si no, no vería el vehículo que creó).
   */
  async create(dto: CreateVehicleDto, scope: FamilyScope | null) {
    const organizationId =
      await this.tenantContext.resolveCreationOrganizationId(
        dto.organizationId,
      );
    const ownerId = dto.ownerId ?? scope?.userId ?? null;
    if (ownerId) {
      await this.assertOwnerInFamilyScope(ownerId, scope);
    }

    const ent = this.repo.create({
      plate: dto.plate,
      brand: dto.brand ?? null,
      model: dto.model ?? null,
      color: dto.color ?? null,
      year: dto.year ?? null,
      vehicleType: dto.vehicleType ?? null,
      accessLevel: dto.accessLevel ?? null,
      // La columna es NOT NULL (default true): `null` respondía 500.
      active: dto.active ?? true,
      ownerId,
    });
    ent.organizationId = organizationId;

    if (ownerId) {
      await this.assertOwnerIsMember(ownerId, organizationId);
    }

    const savedVehicle = await this.saveOrConflict(ent);

    this.logger.log(
      `Vehículo ${savedVehicle.id} (${maskPlate(savedVehicle.plate)}) registrado`,
    );

    // Notificar al propietario y familia
    if (savedVehicle.owner) {
      const ownerWithFamily = await this.usersService.findOneWithFamily(
        savedVehicle.owner.id,
      );
      await this.notifyVehicleAction(
        ownerWithFamily,
        savedVehicle,
        NotificationType.VEHICLE_REGISTERED,
        'Vehículo Registrado',
        'registrado',
      );
    }

    return savedVehicle;
  }

  /**
   * 404 si el vehículo está fuera del alcance por familia del actor (Fase 4 ·
   * P5.C): solo los de él o de su familia. Un vehículo sin propietario
   * (temporal de visitante) no es de ninguna familia.
   */
  private async assertVehicleInFamilyScope(
    vehicle: Vehicle,
    scope: FamilyScope | null,
    notFoundMessage: string,
  ): Promise<void> {
    if (!scope) {
      return;
    }
    const ownerId = vehicle.ownerId ?? vehicle.owner?.id ?? null;
    if (!ownerId || !(await this.familyOwnerIds(scope)).includes(ownerId)) {
      throw new NotFoundException(notFoundMessage);
    }
  }

  /**
   * Vehículo por id del condominio del actor (super-admin: cualquiera) y, si
   * el actor está acotado a su familia, de él o de su familia. 404 si no
   * existe o está fuera de alcance (P5.B: antes `update`/`remove` lo buscaban
   * en toda la plataforma; P5.C: alcance por familia). Lo usa también
   * `GET /vehicles/:id`.
   */
  async findOneForActorOrFail(
    id: string,
    scope: FamilyScope | null,
  ): Promise<Vehicle> {
    const ctx = await this.tenantContext.getContext();
    const vehicle = await this.repo.findOne({
      where: scopeWhere({ id }, ctx),
      relations: ['owner'],
    });
    const notFoundMessage = `Vehículo con ID ${id} no encontrado`;
    if (!vehicle) {
      throw new NotFoundException(notFoundMessage);
    }
    await this.assertVehicleInFamilyScope(vehicle, scope, notFoundMessage);
    return vehicle;
  }

  /**
   * Corrección P5 (cyber M1, revocación del Administrador): un actor acotado
   * a su familia (`scope`) no reactiva un vehículo desactivado, no le sube el
   * nivel de acceso (`vehicleAccessLevelRank`; solo puede bajarlo) y no le
   * cambia la patente (QA R2). 403 si no. Al CREAR sí puede usar `residente` (decisión de Benjamin,
   * 2026-10-09: el vehículo que registra un residente abre de inmediato).
   */
  private assertNoPrivilegeEscalation(
    vehicle: Vehicle,
    dto: UpdateVehicleDto,
    scope: FamilyScope | null,
  ): void {
    if (!scope) {
      return;
    }
    // Corrección P5 (QA R2): la patente es la identidad del vehículo ante el
    // portón; desde la familia no se cambia (se borra y se registra de nuevo,
    // sujeto a que el vehículo esté activo, ver `remove`).
    if (dto.plate !== undefined && dto.plate !== vehicle.plate) {
      throw new ForbiddenException(
        'No puedes cambiar la patente de un vehículo: elimínalo y regístralo de nuevo',
      );
    }
    if (dto.active === true && vehicle.active === false) {
      throw new ForbiddenException(
        'Solo la administración del condominio puede reactivar un vehículo',
      );
    }
    if (
      dto.accessLevel !== undefined &&
      vehicleAccessLevelRank(dto.accessLevel) >
        vehicleAccessLevelRank(vehicle.accessLevel)
    ) {
      throw new ForbiddenException(
        'Solo la administración del condominio puede subir el nivel de acceso de un vehículo',
      );
    }
  }

  /**
   * `PUT /vehicles/:id`. Fase 4 · P5.C: un actor acotado a su familia solo
   * edita vehículos suyos o de su familia (404 si no) y solo les asigna como
   * propietario a sí mismo o a un miembro de su familia (403 si no).
   */
  async update(id: string, dto: UpdateVehicleDto, scope: FamilyScope | null) {
    const vehicle = await this.findOneForActorOrFail(id, scope);
    this.assertNoPrivilegeEscalation(vehicle, dto, scope);

    // Update fields
    if (dto.plate !== undefined) vehicle.plate = dto.plate;
    if (dto.brand !== undefined) vehicle.brand = dto.brand ?? null;
    if (dto.model !== undefined) vehicle.model = dto.model ?? null;
    if (dto.color !== undefined) vehicle.color = dto.color ?? null;
    if (dto.year !== undefined) vehicle.year = dto.year ?? null;
    if (dto.vehicleType !== undefined)
      vehicle.vehicleType = dto.vehicleType ?? null;
    if (dto.accessLevel !== undefined)
      vehicle.accessLevel = dto.accessLevel ?? null;
    // `active` es NOT NULL: un `null` explícito no cambia el estado (antes 500).
    if (typeof dto.active === 'boolean') vehicle.active = dto.active;

    // Update owner relation if ownerId is provided. La relación `owner` viene
    // cargada y TypeORM la prioriza sobre la columna `ownerId` al guardar:
    // se reemplazan ambas, si no el cambio de propietario se ignoraba.
    if (dto.ownerId !== undefined) {
      if (dto.ownerId) {
        // P5.C: el propietario nuevo, del alcance por familia del actor.
        await this.assertOwnerInFamilyScope(dto.ownerId, scope);
        // P5.B: miembro activo del condominio del vehículo (si no, 403).
        await this.assertOwnerIsMember(dto.ownerId, vehicle.organizationId);
        vehicle.ownerId = dto.ownerId;
        vehicle.owner = { id: dto.ownerId } as User;
      } else {
        // Corrección P5 (QA): `ownerId: null` quita el propietario. Solo con
        // `condominium.view-all`: desde la familia el vehículo dejaría de ser
        // suyo (y de verse).
        if (scope) {
          throw new ForbiddenException(
            'Solo la administración del condominio puede quitar el propietario de un vehículo',
          );
        }
        vehicle.ownerId = null;
        vehicle.owner = null;
      }
    }

    const savedVehicle = await this.saveOrConflict(vehicle);

    this.logger.log(
      `Vehículo ${savedVehicle.id} (${maskPlate(savedVehicle.plate)}) actualizado`,
    );

    // Notificar si tiene propietario
    if (savedVehicle.owner) {
      const ownerWithFamily = await this.usersService.findOneWithFamily(
        savedVehicle.owner.id,
      );
      await this.notifyVehicleAction(
        ownerWithFamily,
        savedVehicle,
        NotificationType.VEHICLE_UPDATED,
        'Vehículo Actualizado',
        'actualizado',
      );
    }

    return savedVehicle;
  }

  /** `DELETE /vehicles/:id` (P5.C: con el mismo alcance por familia que `update`). */
  async remove(id: string, scope: FamilyScope | null) {
    const vehicle = await this.findOneForActorOrFail(id, scope);
    // Corrección P5 (QA R1 / cyber M1): un vehículo desactivado por la
    // administración no lo borra la familia (borrarlo y registrarlo de nuevo
    // como `residente` deshacía la revocación).
    if (scope && vehicle.active === false) {
      throw new ForbiddenException(
        'Solo la administración del condominio puede eliminar un vehículo desactivado',
      );
    }

    const vehicleData: VehicleNotificationData = {
      id: vehicle.id,
      plate: vehicle.plate,
      brand: vehicle.brand,
      model: vehicle.model,
    };

    const owner = vehicle.owner;

    try {
      await this.repo.remove(vehicle);
    } catch (error) {
      // Manejar error de restricción de clave foránea
      if (isForeignKeyViolation(error)) {
        const vehicleDesc =
          vehicle.brand && vehicle.model
            ? `${vehicle.brand} ${vehicle.model} (${vehicle.plate})`
            : `con patente ${vehicle.plate}`;

        throw new ConflictException(
          `No se puede eliminar el vehículo ${vehicleDesc} porque está asociado a una o más visitas. ` +
            `Primero debes eliminar o modificar las visitas que usan este vehículo.`,
        );
      }
      throw error; // Re-lanzar otros errores
    }

    this.logger.log(
      `Vehículo ${id} (${maskPlate(vehicleData.plate)}) eliminado`,
    );

    // Notificar si tenía propietario
    if (owner) {
      const ownerWithFamily = await this.usersService.findOneWithFamily(
        owner.id,
      );
      await this.notifyVehicleAction(
        ownerWithFamily,
        vehicleData,
        NotificationType.VEHICLE_REMOVED,
        'Vehículo Eliminado',
        'eliminado',
      );
    }

    return { message: 'Vehículo eliminado exitosamente' };
  }

  /**
   * Notifica al propietario y su familia sobre una acción en un vehículo
   */
  private async notifyVehicleAction(
    owner: User,
    vehicle: VehicleNotificationData,
    type: NotificationType,
    title: string,
    action: string,
  ) {
    const vehicleDesc =
      vehicle.brand && vehicle.model
        ? `${vehicle.brand} ${vehicle.model} (${vehicle.plate})`
        : `patente ${vehicle.plate}`;

    // Notificar al propietario
    await this.notificationsService.create({
      recipientId: owner.id,
      type,
      title,
      message: `Tu vehículo ${vehicleDesc} ha sido ${action} exitosamente`,
      priority: NotificationPriority.NORMAL,
      data: {
        vehicleId: vehicle.id,
        plate: vehicle.plate,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        year: vehicle.year,
      },
    });

    // Notificar a la familia si existe
    if (owner.family?.members) {
      const familyMembers = owner.family.members.filter(
        (m) => m.id !== owner.id,
      );

      for (const member of familyMembers) {
        await this.notificationsService.create({
          recipientId: member.id,
          type,
          title: `Vehículo ${action.charAt(0).toUpperCase() + action.slice(1)} en la Familia`,
          message: `${owner.name} ha ${action} el vehículo ${vehicleDesc}`,
          priority: NotificationPriority.NORMAL,
          data: {
            vehicleId: vehicle.id,
            plate: vehicle.plate,
            brand: vehicle.brand,
            model: vehicle.model,
            ownerId: owner.id,
            ownerName: owner.name,
            familyId: owner.family.id,
          },
        });
      }
    }
  }

  /**
   * Buscar vehículo por patente.
   *
   * `options.organizationId`: fix cross-tenant (feature/cierre-fases-1-2) —
   * cuando se provee, acota la búsqueda a ESE condominio (usado por
   * DetectionsService en el camino de apertura autónoma del portón, con el
   * organizationId de la CÁMARA, sin actor humano).
   *
   * Fase 4 · P5.B: sin ese parámetro ya NO busca en toda la plataforma: se
   * acota al condominio del actor de la request (`TenantContextService`,
   * super-admin: todos). Lo usan `GET /vehicles/plate/:plate` y la tool
   * `consultar_vehiculo`. Con la patente única POR condominio, una búsqueda
   * global podía devolver el vehículo de otro condominio aunque el propio
   * existiera.
   */
  async findByPlate(plate: string, options?: { organizationId?: string }) {
    const where: FindOptionsWhere<Vehicle> = options?.organizationId
      ? { plate, organizationId: options.organizationId }
      : (scopeWhere(
          { plate },
          await this.tenantContext.getContext(),
        ) as FindOptionsWhere<Vehicle>);
    return this.repo.findOne({ where, relations: ['owner'] });
  }

  /**
   * `findByPlate` acotado al actor, con 404 si no existe en su condominio o
   * (P5.C) si está fuera de su alcance por familia.
   */
  async findByPlateForActorOrFail(
    plate: string,
    scope: FamilyScope | null,
  ): Promise<Vehicle> {
    const vehicle = await this.findByPlate(plate);
    const notFoundMessage = `No se encontró un vehículo con patente ${plate}`;
    if (!vehicle) {
      throw new NotFoundException(notFoundMessage);
    }
    await this.assertVehicleInFamilyScope(vehicle, scope, notFoundMessage);
    return vehicle;
  }

  /**
   * `GET /vehicles`: vehículos del condominio del actor (super-admin: todos).
   *
   * Fase 4 · P5.C: con `scope` (actor sin `condominium.view-all`), solo los
   * suyos y los de su familia; sin familia, solo los suyos. El filtro se SUMA
   * al de tenant (`andWhere`). Reemplaza al `UserFilterInterceptor`, que
   * decidía "admin" por nombre de rol y dejaba SIN filtro a un no-admin sin
   * familia.
   */
  async listAll(scope: FamilyScope | null, limit = 100) {
    const ctx = await this.tenantContext.getContext();
    const query = this.repo
      .createQueryBuilder('vehicle')
      .leftJoinAndSelect('vehicle.owner', 'owner')
      .orderBy('vehicle.createdAt', 'DESC')
      .take(limit);

    applyTenantFilter(query, 'vehicle', ctx);

    if (scope) {
      query.andWhere('vehicle.ownerId IN (:...familyOwnerIds)', {
        familyOwnerIds: await this.familyOwnerIds(scope),
      });
    }

    return query.getMany();
  }

  /**
   * Busca vehículos por múltiples IDs de propietarios
   * Útil para obtener todos los vehículos de una familia
   */
  async findByOwnerIds(ownerIds: string[]) {
    if (!ownerIds || ownerIds.length === 0) {
      return [];
    }

    return this.repo
      .createQueryBuilder('vehicle')
      .leftJoinAndSelect('vehicle.owner', 'owner')
      .where('vehicle.ownerId IN (:...ownerIds)', { ownerIds })
      .getMany();
  }
}
