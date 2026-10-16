import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Family } from './entities/family.entity';
import { CreateFamilyDto } from './dto/create-family.dto';
import { UpdateFamilyDto } from './dto/update-family.dto';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationType,
  NotificationPriority,
} from '../notifications/entities/notification.entity';
import { UnitsService } from '../units/units.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import {
  applyTenantFilter,
  isActiveMemberOfOrganization,
  scopeWhere,
} from '../common/tenant/tenant-context.util';
import type { FamilyScope } from '../common/tenant/tenant-actor';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { Unit } from '../units/entities/unit.entity';
import {
  activeFamilyOf,
  matchUnitByIdentifier,
  matchUnitByNumber,
  normalizeHouseTerm,
  type HouseResolution,
} from './house-resolution';

@Injectable()
export class FamiliesService {
  private readonly logger = new Logger(FamiliesService.name);

  constructor(
    @InjectRepository(Family)
    private readonly familyRepository: Repository<Family>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly unitsService: UnitsService,
    // Tarea #19 (docs/modulos/auth-multitenant.md §7): scoping por tenant.
    private readonly tenantContext: TenantContextService,
    // P5.B: membresía del usuario que entra a una familia.
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Alta de una familia. Fase 4 · P5.C (creación estricta): el condominio es
   * el del actor; el super-admin debe indicar `organizationId` (400 sin él;
   * 403 si lo envía otro actor o si el actor no tiene condominio).
   */
  async create(createFamilyDto: CreateFamilyDto): Promise<Family> {
    const organizationId =
      await this.tenantContext.resolveCreationOrganizationId(
        createFamilyDto.organizationId,
      );

    // Si se proporciona un unitId, verificar que la unidad existe y está disponible
    // (UnitsService.findOne ya está scopeado por tenant — tarea #19 — así que
    // esto además impide asignar una unidad de OTRO condominio). P5.C: y debe
    // ser del condominio de la familia (el super-admin ve todas las unidades).
    if (createFamilyDto.unitId) {
      const unit = await this.unitsService.findOne(createFamilyDto.unitId);
      if (unit.organizationId !== organizationId) {
        throw new BadRequestException(
          'La unidad no pertenece al condominio de la familia',
        );
      }

      // Verificar que no haya otra familia ACTIVA en esa unidad
      const activeFamily = await this.familyRepository.findOne({
        where: {
          unit: { id: createFamilyDto.unitId },
          active: true,
        },
      });

      if (activeFamily) {
        throw new ConflictException(
          `La unidad ${unit.identifier} ya tiene asignada la familia activa "${activeFamily.name}". ` +
            `Desactiva la familia actual antes de asignar una nueva.`,
        );
      }
    }

    const family = this.familyRepository.create({
      name: createFamilyDto.name,
      description: createFamilyDto.description,
      active: createFamilyDto.active ?? true,
      unit: createFamilyDto.unitId ? { id: createFamilyDto.unitId } : null,
    });
    family.organizationId = organizationId;

    return await this.familyRepository.save(family);
  }

  /**
   * Familias del condominio del actor (super-admin: todas). Fase 4 · P5.C:
   * con `scope` (actor sin `condominium.view-all`), solo la suya; sin
   * familia, ninguna.
   */
  async findAll(scope: FamilyScope | null = null): Promise<Family[]> {
    const ctx = await this.tenantContext.getContext();
    if (scope && !scope.familyId) {
      return [];
    }
    return await this.familyRepository.find({
      where: scopeWhere(scope?.familyId ? { id: scope.familyId } : {}, ctx),
      relations: ['members'],
    });
  }

  /**
   * Familia por id del condominio del actor. Fase 4 · P5.C: con `scope`, solo
   * la suya (otra → 404). Los callers internos (`findByDepartment`) no pasan
   * `scope`.
   */
  async findOne(id: string, scope: FamilyScope | null = null): Promise<Family> {
    const notFound = new NotFoundException(
      `Familia con ID ${id} no encontrada`,
    );
    if (scope && scope.familyId !== id) {
      throw notFound;
    }
    const ctx = await this.tenantContext.getContext();
    const family = await this.familyRepository.findOne({
      where: scopeWhere({ id }, ctx),
      relations: ['members'],
    });

    if (!family) {
      throw notFound;
    }

    return family;
  }

  async update(
    id: string,
    updateFamilyDto: UpdateFamilyDto,
    scope: FamilyScope | null = null,
  ): Promise<Family> {
    const family = await this.findOne(id, scope);

    // Si se actualiza el unitId, verificar disponibilidad
    if (updateFamilyDto.unitId !== undefined) {
      if (updateFamilyDto.unitId) {
        const unit = await this.unitsService.findOne(updateFamilyDto.unitId);
        // P5.C: la unidad debe ser del condominio de la familia (el
        // super-admin ve las unidades de todos).
        if (unit.organizationId !== family.organizationId) {
          throw new BadRequestException(
            'La unidad no pertenece al condominio de la familia',
          );
        }

        // Verificar que no haya otra familia ACTIVA en esa unidad (excepto esta si está activa)
        const activeFamily = await this.familyRepository.findOne({
          where: {
            unit: { id: updateFamilyDto.unitId },
            active: true,
          },
        });

        if (activeFamily && activeFamily.id !== id) {
          throw new ConflictException(
            `La unidad ${unit.identifier} ya tiene asignada la familia activa "${activeFamily.name}". ` +
              `Desactiva la familia actual antes de asignar esta unidad.`,
          );
        }

        family.unit = unit;
      } else {
        // Si se pasa null, remover la asignación
        family.unit = null;
      }
    }

    if (updateFamilyDto.name !== undefined) {
      family.name = updateFamilyDto.name;
    }

    if (updateFamilyDto.description !== undefined) {
      family.description = updateFamilyDto.description || null;
    }

    if (updateFamilyDto.active !== undefined) {
      family.active = updateFamilyDto.active;
    }

    // Corrección P5 (QA A3): el Conserje Digital de la familia (lo lee el hub
    // en `GET /units/ai-enabled`).
    if (updateFamilyDto.digitalConciergeEnabled !== undefined) {
      family.digitalConciergeEnabled = updateFamilyDto.digitalConciergeEnabled;
    }

    return await this.familyRepository.save(family);
  }

  async remove(id: string, scope: FamilyScope | null = null): Promise<void> {
    const family = await this.findOne(id, scope);
    await this.familyRepository.remove(family);
  }

  /**
   * Fase 4 · P5.B: solo un miembro ACTIVO del condominio de la familia (tabla
   * `member` + cuenta no deshabilitada) puede entrar a ella. Si no, 403
   * (también si el usuario no existe: no enumera usuarios de otros
   * condominios). Una familia sin condominio (hasta P5.C) no admite miembros.
   */
  private async assertUserIsMemberOfFamilyOrganization(
    family: Family,
    userId: string,
  ): Promise<void> {
    const isMember =
      family.organizationId !== null &&
      (await isActiveMemberOfOrganization(
        userId,
        family.organizationId,
        this.dataSource,
      ));
    if (!isMember) {
      throw new ForbiddenException(
        'El usuario debe ser un miembro activo del condominio de la familia',
      );
    }
  }

  // Agregar un miembro a la familia
  async addMember(
    familyId: string,
    userId: string,
    scope: FamilyScope | null = null,
  ): Promise<Family> {
    const family = await this.findOne(familyId, scope);
    await this.assertUserIsMemberOfFamilyOrganization(family, userId);

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['family'],
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${userId} no encontrado`);
    }

    // Verificar si el usuario ya pertenece a otra familia
    if (user.family && user.family.id !== familyId) {
      throw new BadRequestException(
        `El usuario ya pertenece a la familia "${user.family.name}". Debe ser removido primero.`,
      );
    }

    // Si ya pertenece a esta familia, no hacer nada
    if (user.family && user.family.id === familyId) {
      return family;
    }

    user.family = family;
    await this.userRepository.save(user);

    // Fase 4 · P7.L: ids, no nombres (el de la familia suele ser un apellido).
    this.logger.log(`Usuario ${user.id} agregado a la familia ${family.id}`);

    // Enviar notificación al usuario agregado
    await this.notificationsService.create({
      recipientId: userId,
      type: NotificationType.FAMILY_UPDATE,
      title: 'Agregado a Familia',
      message: `Has sido agregado a la familia "${family.name}"`,
      priority: NotificationPriority.NORMAL,
      data: {
        familyId: family.id,
        familyName: family.name,
        unitIdentifier: family.unit?.identifier || null,
      },
    });

    // Notificar a todos los demás miembros de la familia
    const updatedFamily = await this.findOne(familyId);
    const otherMembers = updatedFamily.members.filter((m) => m.id !== userId);

    for (const member of otherMembers) {
      await this.notificationsService.create({
        recipientId: member.id,
        type: NotificationType.FAMILY_UPDATE,
        title: 'Nuevo Miembro en la Familia',
        message: `${user.name} ha sido agregado a tu familia`,
        priority: NotificationPriority.NORMAL,
        data: {
          familyId: family.id,
          familyName: family.name,
          newMemberId: userId,
          newMemberName: user.name,
        },
      });
    }

    return updatedFamily;
  }

  // Remover un miembro de la familia
  async removeMember(
    familyId: string,
    userId: string,
    scope: FamilyScope | null = null,
  ): Promise<Family> {
    const family = await this.findOne(familyId, scope);

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['family'],
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${userId} no encontrado`);
    }

    if (!user.family || user.family.id !== familyId) {
      throw new BadRequestException(`El usuario no pertenece a esta familia`);
    }

    const userName = user.name;
    user.family = null;
    await this.userRepository.save(user);

    this.logger.log(`Usuario ${user.id} removido de la familia ${family.id}`);

    // Enviar notificación al usuario removido
    await this.notificationsService.create({
      recipientId: userId,
      type: NotificationType.FAMILY_UPDATE,
      title: 'Removido de Familia',
      message: `Has sido removido de la familia "${family.name}"`,
      priority: NotificationPriority.NORMAL,
      data: {
        familyId: family.id,
        familyName: family.name,
      },
    });

    // Notificar a los miembros restantes de la familia
    const updatedFamily = await this.findOne(familyId);

    for (const member of updatedFamily.members) {
      await this.notificationsService.create({
        recipientId: member.id,
        type: NotificationType.FAMILY_UPDATE,
        title: 'Miembro Removido de la Familia',
        message: `${userName} ha sido removido de tu familia`,
        priority: NotificationPriority.NORMAL,
        data: {
          familyId: family.id,
          familyName: family.name,
          removedMemberId: userId,
          removedMemberName: userName,
        },
      });
    }

    return updatedFamily;
  }

  // Agregar múltiples miembros a la familia
  async addMembers(
    familyId: string,
    userIds: string[],
    scope: FamilyScope | null = null,
  ): Promise<Family> {
    const family = await this.findOne(familyId, scope);

    // P5.B: se validan TODOS antes de agregar a nadie (un usuario ajeno no
    // deja la familia a medio actualizar).
    for (const userId of userIds) {
      await this.assertUserIsMemberOfFamilyOrganization(family, userId);
    }

    for (const userId of userIds) {
      await this.addMember(familyId, userId, scope);
    }

    return await this.findOne(familyId);
  }

  /**
   * Usuarios disponibles (sin familia asignada) del condominio del actor.
   *
   * Fase 4 · P5.B: antes devolvía id, nombre, email y RUT de TODOS los
   * usuarios sin familia de la plataforma. Ahora solo los que tienen
   * membresía (`member`) en el condominio del actor; el super-admin ve todos
   * y un actor sin condominio, ninguno.
   *
   * Fase 4 · P5.C: un actor acotado a su familia (`scope`, sin
   * `condominium.view-all`) no ve a nadie: son usuarios de otras familias
   * (con email y RUT).
   */
  async getAvailableUsers(scope: FamilyScope | null = null): Promise<User[]> {
    if (scope) {
      return [];
    }
    const ctx = await this.tenantContext.getContext();
    const query = this.userRepository
      .createQueryBuilder('u')
      .where('u.familyId IS NULL')
      .select(['u.id', 'u.name', 'u.email', 'u.rut']);

    if (!ctx.isSuperAdmin) {
      if (!ctx.organizationId) {
        return [];
      }
      query.andWhere(
        'EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id AND m."organizationId" = :memberOrgId)',
        { memberOrgId: ctx.organizationId },
      );
    }

    return await query.getMany();
  }

  /**
   * Casa que marcó o dijo el visitante, acotada al condominio del contexto
   * (Fase 4 · P6.R, ver house-resolution.ts): (a) calce exacto de
   * `Unit.identifier`; (b) si no hay, calce exacto del número de la unidad
   * si es ÚNICO en el condominio; (c) si hay varias, `ambiguous` con sus
   * identificadores (sin nombres ni datos de familias).
   *
   * Antes, sin calce exacto caía a `LIKE %x%`: marcar "10" entregaba la
   * familia de la "101" y se podía notificar a la familia equivocada. Los
   * términos van como parámetro de una igualdad: `%` y `_` son literales.
   */
  async resolveHouse(searchTerm: string): Promise<HouseResolution> {
    const term = normalizeHouseTerm(searchTerm);
    if (!term) {
      return { status: 'not-found' };
    }
    const ctx = await this.tenantContext.getContext();
    let match = matchUnitByIdentifier(
      await this.findUnitsMatching('identifier', term, ctx),
      searchTerm,
    );
    if (match.kind === 'none') {
      match = matchUnitByNumber(
        await this.findUnitsMatching('number', term, ctx),
        searchTerm,
      );
    }
    if (match.kind === 'ambiguous') {
      return { status: 'ambiguous', options: match.options };
    }
    if (match.kind === 'none') {
      return { status: 'not-found' };
    }
    const active = activeFamilyOf(match.unit);
    if (!active) {
      return { status: 'not-found' };
    }
    try {
      return { status: 'found', family: await this.findOne(active.id) };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { status: 'not-found' };
      }
      throw error;
    }
  }

  /**
   * Familia activa de la casa (`resolveHouse`), o `null` si no existe o es
   * ambigua. La usan el contexto de la casa del citófono, `consultar_visitas`
   * y `abrir_acceso`: ante una casa ambigua no hay familia (fail-closed;
   * `abrir_acceso` escala). `buscar_residente` usa `resolveHouse` para
   * poder preguntar al visitante.
   */
  async findByDepartment(searchTerm: string): Promise<Family | null> {
    const resolution = await this.resolveHouse(searchTerm);
    return resolution.status === 'found' ? resolution.family : null;
  }

  /**
   * Unidades del condominio del contexto cuyo `identifier` o `number` es
   * EXACTAMENTE `term` (trim, sin distinguir mayúsculas), con sus familias
   * activas. `column` es una unión cerrada (no viene del usuario).
   */
  private async findUnitsMatching(
    column: 'identifier' | 'number',
    term: string,
    ctx: TenantContext,
  ): Promise<Unit[]> {
    const query = this.dataSource
      .getRepository(Unit)
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.families', 'family', 'family.active = :active', {
        active: true,
      })
      .where(`UPPER(TRIM(unit.${column})) = UPPER(:term)`, { term })
      .orderBy('unit.identifier', 'ASC')
      .addOrderBy('family.createdAt', 'ASC');
    applyTenantFilter(query, 'unit', ctx);
    return await query.getMany();
  }
}
