import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Notification } from '../notifications/entities/notification.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Visit } from '../visits/entities/visit.entity';
import { requiredString, rowsOf } from './sql-rows';

/** Versión del formato del archivo (cambia si cambia la forma). */
export const DATA_EXPORT_FORMAT_VERSION = 1;

/**
 * Archivo que entrega `GET /auth/me/data-export` (Fase 4 · P7.R, Ley 21.719
 * arts. 5 y 9: acceso y portabilidad). SOLO datos del titular: de los
 * visitantes (terceros) va el nombre, nunca su RUT, teléfono ni patente.
 * Las fechas van en ISO 8601 (UTC).
 */
export interface PersonalDataExport {
  formatVersion: number;
  generatedAt: string;
  user: ExportedProfile;
  family: ExportedFamily | null;
  vehicles: ExportedVehicle[];
  visitsHosted: ExportedVisit[];
  notifications: ExportedNotification[];
}

export interface ExportedProfile {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  rut: string | null;
  phone: string | null;
  age: number | null;
  profilePicture: string | null;
  roles: string[];
  condominium: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportedFamily {
  id: string;
  name: string;
  description: string | null;
  unit: {
    identifier: string;
    block: string | null;
    number: string;
    floor: number | null;
    type: string | null;
  } | null;
}

export interface ExportedVehicle {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  vehicleType: string | null;
  accessLevel: string | null;
  active: boolean;
  createdAt: string;
}

export interface ExportedVisit {
  id: string;
  type: string;
  status: string;
  /** Nombre del visitante ("[anonimizado]" si ya se anonimizó). */
  visitorName: string;
  reason: string | null;
  validFrom: string;
  validUntil: string;
  entryTime: string | null;
  exitTime: string | null;
  maxUses: number | null;
  usedCount: number;
  createdAt: string;
  anonymized: boolean;
}

/**
 * Notificación recibida. Sin `message` ni `data`: copian datos del visitante
 * (nombre, patente, RUT y teléfono).
 */
export interface ExportedNotification {
  id: string;
  type: string;
  title: string;
  priority: string;
  read: boolean;
  readAt: string | null;
  createdAt: string;
  /** Borrada por el usuario (sigue guardada hasta la retención). */
  deletedAt: string | null;
}

/** `vigilia-mis-datos-<YYYY-MM-DD>.json` (fecha UTC de generación). */
export function dataExportFileName(generatedAt: string): string {
  return `vigilia-mis-datos-${generatedAt.slice(0, 10)}.json`;
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function isoRequired(value: Date): string {
  return new Date(value).toISOString();
}

/**
 * Fase 4 · P7.R (docs/modulos/privacidad-ley-21719.md §4): arma la
 * exportación de los datos de un usuario. Cada campo se copia a mano (lista
 * blanca): un campo nuevo en una entidad no se filtra solo al archivo.
 */
@Injectable()
export class DataExportService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async exportForUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<PersonalDataExport> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: ['roles', 'family', 'family.unit'],
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    const [condominium, vehicles, visits, notifications] = await Promise.all([
      this.findCondominium(userId),
      this.findVehicles(userId),
      this.findVisitsHosted(userId),
      this.findNotifications(userId),
    ]);
    return {
      formatVersion: DATA_EXPORT_FORMAT_VERSION,
      generatedAt: now.toISOString(),
      user: toProfile(user, condominium),
      family: toFamily(user),
      vehicles,
      visitsHosted: visits,
      notifications,
    };
  }

  private async findCondominium(
    userId: string,
  ): Promise<{ id: string; name: string } | null> {
    const [row] = rowsOf(
      await this.dataSource.query(
        `SELECT o."id", o."name" FROM "member" m JOIN "organization" o ON o."id" = m."organizationId"
         WHERE m."userId" = $1 ORDER BY m."createdAt" ASC LIMIT 1`,
        [userId],
      ),
    );
    if (!row) {
      return null;
    }
    return {
      id: requiredString(row.id, 'id'),
      name: requiredString(row.name, 'name'),
    };
  }

  private async findVehicles(userId: string): Promise<ExportedVehicle[]> {
    const vehicles = await this.vehicles.find({
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
      loadEagerRelations: false,
    });
    return vehicles.map((vehicle) => ({
      id: vehicle.id,
      plate: vehicle.plate,
      brand: vehicle.brand,
      model: vehicle.model,
      color: vehicle.color,
      year: vehicle.year,
      vehicleType: vehicle.vehicleType,
      accessLevel: vehicle.accessLevel,
      active: vehicle.active !== false,
      createdAt: isoRequired(vehicle.createdAt),
    }));
  }

  private async findVisitsHosted(userId: string): Promise<ExportedVisit[]> {
    const visits = await this.visits.find({
      where: { host: { id: userId } },
      order: { createdAt: 'DESC' },
      loadEagerRelations: false,
    });
    return visits.map((visit) => ({
      id: visit.id,
      type: visit.type,
      status: visit.status,
      visitorName: visit.visitorName,
      reason: visit.reason,
      validFrom: isoRequired(visit.validFrom),
      validUntil: isoRequired(visit.validUntil),
      entryTime: iso(visit.entryTime),
      exitTime: iso(visit.exitTime),
      maxUses: visit.maxUses,
      usedCount: visit.usedCount,
      createdAt: isoRequired(visit.createdAt),
      anonymized: visit.anonymizedAt !== null,
    }));
  }

  private async findNotifications(
    userId: string,
  ): Promise<ExportedNotification[]> {
    const notifications = await this.notifications.find({
      where: { recipientId: userId },
      order: { createdAt: 'DESC' },
      withDeleted: true,
      loadEagerRelations: false,
    });
    return notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      priority: notification.priority,
      read: notification.read,
      readAt: iso(notification.readAt),
      createdAt: isoRequired(notification.createdAt),
      deletedAt: iso(notification.deletedAt),
    }));
  }
}

function toProfile(
  user: User,
  condominium: { id: string; name: string } | null,
): ExportedProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    rut: user.rut,
    phone: user.phone,
    age: user.age ?? null,
    profilePicture: user.profilePicture,
    roles: (user.roles ?? []).map((role) => role.name).sort(),
    condominium,
    createdAt: isoRequired(user.createdAt),
    updatedAt: isoRequired(user.updatedAt),
  };
}

function toFamily(user: User): ExportedFamily | null {
  const family = user.family;
  if (!family) {
    return null;
  }
  const unit = family.unit;
  return {
    id: family.id,
    name: family.name,
    description: family.description,
    unit: unit
      ? {
          identifier: unit.identifier,
          block: unit.block,
          number: unit.number,
          floor: unit.floor,
          type: unit.type,
        }
      : null,
  };
}
