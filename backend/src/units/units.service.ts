import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Unit } from './entities/unit.entity';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { CreateBulkUnitsDto } from './dto/create-bulk-units.dto';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import {
  scopeWhere,
  tenantWhereCondition,
} from '../common/tenant/tenant-context.util';
import { isUniqueViolation } from '../common/utils/unique-violation.util';

/** Qué cargar de una unidad (corrección P5, cyber M2). */
export interface UnitLoadOptions {
  /** Cargar `families.members` (usuarios): solo con `condominium.view-all` en HTTP. */
  includeMembers: boolean;
}

function unitRelations(options: UnitLoadOptions): string[] {
  return options.includeMembers
    ? ['families', 'families.members']
    : ['families'];
}

@Injectable()
export class UnitsService {
  private readonly logger = new Logger(UnitsService.name);

  constructor(
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
    // Tarea #19 (docs/modulos/auth-multitenant.md §7): scoping por tenant.
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Crear una nueva unidad
   */
  async create(dto: CreateUnitDto): Promise<Unit> {
    // Fase 4 · P5.C (creación estricta): el condominio es el del actor; el
    // super-admin debe indicar `organizationId` (400 sin él; 403 si lo envía
    // otro actor o si el actor no tiene condominio).
    const { organizationId: requestedOrganizationId, ...unitData } = dto;
    const organizationId =
      await this.tenantContext.resolveCreationOrganizationId(
        requestedOrganizationId,
      );

    // Crear la entidad. P5.B: el identificador se calcula YA (el hook
    // @BeforeInsert recién corre al guardar): sin esto el chequeo de abajo
    // buscaba `identifier: undefined`, que TypeORM descarta del `where`, y
    // cualquier unidad del condominio contaba como duplicado.
    const unit = this.unitRepo.create(unitData);
    unit.generateIdentifier();
    unit.organizationId = organizationId;

    // Verificar que no exista una unidad con el mismo identificador
    // (dentro del mismo condominio: dos condominios distintos pueden tener,
    // en teoría, unidades con el mismo identifier "A-101").
    const existing = await this.unitRepo.findOne({
      where: { identifier: unit.identifier, organizationId },
    });

    if (existing) {
      throw new ConflictException(
        `Ya existe una unidad con el identificador "${unit.identifier}"`,
      );
    }

    const saved = await this.saveOrConflict(unit);
    this.logger.log(`✅ Unidad creada: ${saved.identifier}`);

    return saved;
  }

  /**
   * Guarda la unidad; si la BD rechaza el identificador por duplicado (índice
   * UNIQUE `(organizationId, identifier)`, P5.B) responde 409, no 500. Cubre
   * la carrera entre el chequeo previo y el INSERT/UPDATE.
   */
  private async saveOrConflict(unit: Unit): Promise<Unit> {
    try {
      return await this.unitRepo.save(unit);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Ya existe una unidad con el identificador "${unit.identifier}"`,
        );
      }
      throw error;
    }
  }

  /**
   * Crear múltiples unidades en rango
   */
  async createBulk(dto: CreateBulkUnitsDto): Promise<{
    created: Unit[];
    skipped: string[];
    total: number;
  }> {
    const { block, numberFrom, numberTo, floor, type, active = true } = dto;
    // Fase 4 · P5.C (creación estricta), igual que `create`.
    const organizationId =
      await this.tenantContext.resolveCreationOrganizationId(
        dto.organizationId,
      );

    // Validar que el rango sea válido
    if (numberFrom > numberTo) {
      throw new BadRequestException(
        'El número inicial debe ser menor o igual al número final',
      );
    }

    // Validar que el rango no sea demasiado grande
    const rangeSize = numberTo - numberFrom + 1;
    if (rangeSize > 1000) {
      throw new BadRequestException('El rango no puede exceder 1000 unidades');
    }

    const created: Unit[] = [];
    const skipped: string[] = [];

    // Generar y crear cada unidad en el rango
    for (let num = numberFrom; num <= numberTo; num++) {
      const unitDto: CreateUnitDto = {
        block: block || undefined,
        number: num.toString(),
        floor: floor ?? undefined,
        type: type || undefined,
        active,
      };

      // Generar el identificador manualmente (misma lógica que @BeforeInsert)
      const identifier = block
        ? `${block.toUpperCase()}-${num.toString()}`
        : num.toString();

      // Verificar si ya existe (dentro del mismo condominio)
      const existing = await this.unitRepo.findOne({
        where: { identifier, organizationId },
      });

      if (existing) {
        skipped.push(identifier);
        this.logger.warn(`⚠️  Unidad ${identifier} ya existe, omitida`);
        continue;
      }

      // Crear y guardar la unidad (el hook @BeforeInsert generará el identificador al guardar)
      try {
        const unit = this.unitRepo.create(unitDto);
        unit.organizationId = organizationId;
        const saved = await this.unitRepo.save(unit);
        created.push(saved);
        this.logger.log(`✅ Unidad creada: ${saved.identifier}`);
      } catch (error) {
        // Un duplicado que llegó entre el chequeo y el INSERT (índice UNIQUE
        // por condominio) se omite igual que uno detectado antes: la masiva
        // reporta `skipped`, nunca un 500.
        if (isUniqueViolation(error)) {
          this.logger.warn(`⚠️  Unidad ${identifier} ya existe, omitida`);
        } else {
          this.logger.error(`❌ Error al crear unidad ${identifier}:`, error);
        }
        skipped.push(identifier);
      }
    }

    this.logger.log(
      `📦 Creación masiva completada: ${created.length} creadas, ${skipped.length} omitidas de ${rangeSize} total`,
    );

    return {
      created,
      skipped,
      total: rangeSize,
    };
  }

  /**
   * Obtener todas las unidades con paginación opcional
   */
  async findAll(includeInactive = false): Promise<Unit[]> {
    const ctx = await this.tenantContext.getContext();
    const where = includeInactive ? {} : { active: true };

    return this.unitRepo.find({
      where: scopeWhere(where, ctx),
      relations: ['families'],
      order: { identifier: 'ASC' },
    });
  }

  /**
   * Buscar unidad por ID.
   *
   * Corrección P5 (cyber M2 / QA A2): `includeMembers` decide si se cargan
   * los miembros de las familias de la unidad. Las rutas HTTP lo pasan en
   * `false` para quien no tiene `condominium.view-all` (un residente leía
   * así los datos de sus vecinos). Los callers internos (familias, agente)
   * lo dejan en `true`.
   */
  async findOne(
    id: string,
    options: UnitLoadOptions = { includeMembers: true },
  ): Promise<Unit> {
    const ctx = await this.tenantContext.getContext();
    const unit = await this.unitRepo.findOne({
      where: scopeWhere({ id }, ctx),
      relations: unitRelations(options),
    });

    if (!unit) {
      throw new NotFoundException(`Unidad con ID ${id} no encontrada`);
    }

    return unit;
  }

  /**
   * Buscar unidad por identificador (ej: "A-303", "Casa-5"). Ver
   * `includeMembers` en `findOne`.
   */
  async findByIdentifier(
    identifier: string,
    options: UnitLoadOptions = { includeMembers: true },
  ): Promise<Unit | null> {
    const ctx = await this.tenantContext.getContext();
    return this.unitRepo.findOne({
      where: scopeWhere({ identifier: identifier.toUpperCase() }, ctx),
      relations: unitRelations(options),
    });
  }

  /**
   * Buscar unidades por bloque
   */
  async findByBlock(block: string): Promise<Unit[]> {
    const ctx = await this.tenantContext.getContext();
    return this.unitRepo.find({
      where: scopeWhere(
        {
          block: block.toUpperCase(),
          active: true,
        },
        ctx,
      ),
      relations: ['families'],
      order: { number: 'ASC' },
    });
  }

  /**
   * Buscar unidades por piso
   */
  async findByFloor(floor: number): Promise<Unit[]> {
    const ctx = await this.tenantContext.getContext();
    return this.unitRepo.find({
      where: scopeWhere(
        {
          floor,
          active: true,
        },
        ctx,
      ),
      relations: ['families'],
      order: { block: 'ASC', number: 'ASC' },
    });
  }

  /**
   * Buscar unidades por término de búsqueda (identifier, number)
   */
  async search(searchTerm: string): Promise<Unit[]> {
    const term = searchTerm.toUpperCase();
    const ctx = await this.tenantContext.getContext();

    return this.unitRepo.find({
      where: scopeWhere(
        [{ identifier: Like(`%${term}%`) }, { number: Like(`%${term}%`) }],
        ctx,
      ),
      relations: ['families'],
      order: { identifier: 'ASC' },
    });
  }

  /**
   * Actualizar unidad
   */
  async update(id: string, dto: UpdateUnitDto): Promise<Unit> {
    const unit = await this.findOne(id);

    // Si se actualiza block o number, verificar que el nuevo identifier no exista
    if (dto.block !== undefined || dto.number !== undefined) {
      const updatedUnit = this.unitRepo.create({
        ...unit,
        ...dto,
      });

      // El hook generará el nuevo identifier
      updatedUnit.generateIdentifier();

      // Verificar que no exista otra unidad con ese identifier en el
      // condominio DE LA UNIDAD (P5.C: con el contexto del super-admin, sin
      // filtro, chocaba con unidades de otros condominios).
      const existing = await this.unitRepo.findOne({
        where: {
          identifier: updatedUnit.identifier,
          ...tenantWhereCondition(unit.organizationId),
        },
      });

      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Ya existe una unidad con el identificador "${updatedUnit.identifier}"`,
        );
      }
    }

    Object.assign(unit, dto);
    const saved = await this.saveOrConflict(unit);

    this.logger.log(`✅ Unidad actualizada: ${saved.identifier}`);

    return saved;
  }

  /**
   * Eliminar (soft delete) unidad
   */
  async remove(id: string): Promise<void> {
    const unit = await this.findOne(id);

    // Verificar que no tenga familias ACTIVAS asignadas
    const activeFamily = unit.families?.find((f) => f.active);

    if (activeFamily) {
      throw new ConflictException(
        `No se puede eliminar la unidad ${unit.identifier} porque tiene la familia activa "${activeFamily.name}" asignada. ` +
          `Desactiva la familia primero.`,
      );
    }

    unit.active = false;
    await this.unitRepo.save(unit);

    this.logger.log(`✅ Unidad desactivada: ${unit.identifier}`);
  }

  /**
   * Obtener unidades disponibles (sin familia activa asignada)
   */
  async findAvailable(): Promise<Unit[]> {
    const ctx = await this.tenantContext.getContext();
    const allUnits = await this.unitRepo.find({
      where: scopeWhere({ active: true }, ctx),
      relations: ['families'],
      order: { identifier: 'ASC' },
    });

    // Filtrar solo las que no tienen familias activas
    return allUnits.filter(
      (unit) => !unit.families || unit.families.every((f) => !f.active),
    );
  }

  /**
   * Obtener estadísticas de unidades del condominio del actor (P5.B; antes
   * contaba las de toda la plataforma). Super-admin: todas.
   */
  async getStats(): Promise<{
    total: number;
    occupied: number;
    available: number;
    inactive: number;
  }> {
    const ctx = await this.tenantContext.getContext();
    const [total, inactive] = await Promise.all([
      this.unitRepo.count({ where: scopeWhere({}, ctx) }),
      this.unitRepo.count({ where: scopeWhere({ active: false }, ctx) }),
    ]);

    const allActiveUnits = await this.unitRepo.find({
      where: scopeWhere({ active: true }, ctx),
      relations: ['families'],
    });

    // Contar unidades con al menos una familia activa
    const occupied = allActiveUnits.filter(
      (unit) => unit.families && unit.families.some((f) => f.active),
    ).length;

    const active = total - inactive;
    const available = active - occupied;

    return {
      total,
      occupied,
      available,
      inactive,
    };
  }

  /**
   * Obtener unidades con Conserje Digital habilitado
   * Usado por el Hub (Raspberry Pi) para cache local
   *
   * Fase 4 · P5.B: acotado al condominio del hub autenticado
   * (`request.hub.organizationId`, lo pasa el controller). Antes devolvía las
   * unidades de toda la plataforma. Un hub sin condominio asignado recibe una
   * lista vacía (no el "cajón nulo").
   */
  async findWithAIEnabled(organizationId: string | null): Promise<
    Array<{
      houseNumber: string;
      hasAI: boolean;
      familyId: string;
    }>
  > {
    if (!organizationId) {
      return [];
    }
    const units = await this.unitRepo.find({
      where: { active: true, organizationId },
      relations: ['families'],
    });

    const aiEnabledUnits = units.filter(
      (unit) =>
        unit.families &&
        unit.families.some((f) => f.active && f.digitalConciergeEnabled),
    );

    return aiEnabledUnits.map((unit) => {
      const activeAIFamily = unit.families.find(
        (f) => f.active && f.digitalConciergeEnabled,
      );

      return {
        houseNumber: unit.identifier,
        hasAI: true,
        familyId: activeAIFamily?.id || '',
      };
    });
  }
}
