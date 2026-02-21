import { Injectable, NotFoundException, ConflictException, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Unit } from './entities/unit.entity';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { CreateBulkUnitsDto } from './dto/create-bulk-units.dto';

@Injectable()
export class UnitsService {
  private readonly logger = new Logger(UnitsService.name);

  constructor(
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
  ) {}

  /**
   * Crear una nueva unidad
   */
  async create(dto: CreateUnitDto): Promise<Unit> {
    // Crear la entidad (el hook generateIdentifier se ejecutará antes de insertar)
    const unit = this.unitRepo.create(dto);

    // Verificar que no exista una unidad con el mismo identificador
    const existing = await this.unitRepo.findOne({
      where: { identifier: unit.identifier },
    });

    if (existing) {
      throw new ConflictException(
        `Ya existe una unidad con el identificador "${unit.identifier}"`
      );
    }

    const saved = await this.unitRepo.save(unit);
    this.logger.log(`✅ Unidad creada: ${saved.identifier}`);
    
    return saved;
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

    // Validar que el rango sea válido
    if (numberFrom > numberTo) {
      throw new BadRequestException('El número inicial debe ser menor o igual al número final');
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

      // Verificar si ya existe
      const existing = await this.unitRepo.findOne({
        where: { identifier },
      });

      if (existing) {
        skipped.push(identifier);
        this.logger.warn(`⚠️  Unidad ${identifier} ya existe, omitida`);
        continue;
      }

      // Crear y guardar la unidad (el hook @BeforeInsert generará el identificador al guardar)
      try {
        const unit = this.unitRepo.create(unitDto);
        const saved = await this.unitRepo.save(unit);
        created.push(saved);
        this.logger.log(`✅ Unidad creada: ${saved.identifier}`);
      } catch (error) {
        this.logger.error(`❌ Error al crear unidad ${identifier}:`, error);
        skipped.push(identifier);
      }
    }

    this.logger.log(
      `📦 Creación masiva completada: ${created.length} creadas, ${skipped.length} omitidas de ${rangeSize} total`
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
    const where = includeInactive ? {} : { active: true };
    
    return this.unitRepo.find({
      where,
      relations: ['families'],
      order: { identifier: 'ASC' },
    });
  }

  /**
   * Buscar unidad por ID
   */
  async findOne(id: string): Promise<Unit> {
    const unit = await this.unitRepo.findOne({
      where: { id },
      relations: ['families', 'families.members'],
    });

    if (!unit) {
      throw new NotFoundException(`Unidad con ID ${id} no encontrada`);
    }

    return unit;
  }

  /**
   * Buscar unidad por identificador (ej: "A-303", "Casa-5")
   */
  async findByIdentifier(identifier: string): Promise<Unit | null> {
    return this.unitRepo.findOne({
      where: { identifier: identifier.toUpperCase() },
      relations: ['families', 'families.members'],
    });
  }

  /**
   * Buscar unidades por bloque
   */
  async findByBlock(block: string): Promise<Unit[]> {
    return this.unitRepo.find({
      where: { 
        block: block.toUpperCase(),
        active: true,
      },
      relations: ['families'],
      order: { number: 'ASC' },
    });
  }

  /**
   * Buscar unidades por piso
   */
  async findByFloor(floor: number): Promise<Unit[]> {
    return this.unitRepo.find({
      where: { 
        floor,
        active: true,
      },
      relations: ['families'],
      order: { block: 'ASC', number: 'ASC' },
    });
  }

  /**
   * Buscar unidades por término de búsqueda (identifier, number)
   */
  async search(searchTerm: string): Promise<Unit[]> {
    const term = searchTerm.toUpperCase();
    
    return this.unitRepo.find({
      where: [
        { identifier: Like(`%${term}%`) },
        { number: Like(`%${term}%`) },
      ],
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

      // Verificar que no exista otra unidad con ese identifier
      const existing = await this.unitRepo.findOne({
        where: { identifier: updatedUnit.identifier },
      });

      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Ya existe una unidad con el identificador "${updatedUnit.identifier}"`
        );
      }
    }

    Object.assign(unit, dto);
    const saved = await this.unitRepo.save(unit);
    
    this.logger.log(`✅ Unidad actualizada: ${saved.identifier}`);
    
    return saved;
  }

  /**
   * Eliminar (soft delete) unidad
   */
  async remove(id: string): Promise<void> {
    const unit = await this.findOne(id);

    // Verificar que no tenga familias ACTIVAS asignadas
    const activeFamily = unit.families?.find(f => f.active);
    
    if (activeFamily) {
      throw new ConflictException(
        `No se puede eliminar la unidad ${unit.identifier} porque tiene la familia activa "${activeFamily.name}" asignada. ` +
        `Desactiva la familia primero.`
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
    const allUnits = await this.unitRepo.find({
      where: { active: true },
      relations: ['families'],
      order: { identifier: 'ASC' },
    });

    // Filtrar solo las que no tienen familias activas
    return allUnits.filter(unit => 
      !unit.families || unit.families.every(f => !f.active)
    );
  }

  /**
   * Obtener estadísticas de unidades
   */
  async getStats(): Promise<{
    total: number;
    occupied: number;
    available: number;
    inactive: number;
  }> {
    const [total, inactive] = await Promise.all([
      this.unitRepo.count(),
      this.unitRepo.count({ where: { active: false } }),
    ]);

    const allActiveUnits = await this.unitRepo.find({
      where: { active: true },
      relations: ['families'],
    });

    // Contar unidades con al menos una familia activa
    const occupied = allActiveUnits.filter(unit =>
      unit.families && unit.families.some(f => f.active)
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
   */
  async findWithAIEnabled(): Promise<Array<{
    houseNumber: string;
    hasAI: boolean;
    familyId: string;
  }>> {
    const units = await this.unitRepo.find({
      where: { active: true },
      relations: ['families'],
    });

    const aiEnabledUnits = units.filter(unit => 
      unit.families && unit.families.some(f => f.active && f.digitalConciergeEnabled)
    );

    return aiEnabledUnits.map(unit => {
      const activeAIFamily = unit.families.find(f => f.active && f.digitalConciergeEnabled);
      
      return {
        houseNumber: unit.identifier,
        hasAI: true,
        familyId: activeAIFamily?.id || '',
      };
    });
  }
}
