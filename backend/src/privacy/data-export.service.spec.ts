import { NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import {
  type Notification,
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import type { User } from '../users/entities/user.entity';
import type { Vehicle } from '../vehicles/entities/vehicle.entity';
import {
  type Visit,
  VisitStatus,
  VisitType,
} from '../visits/entities/visit.entity';
import {
  DATA_EXPORT_FORMAT_VERSION,
  dataExportFileName,
  DataExportService,
} from './data-export.service';

const USER_ID = '2d7f8f57-4b8c-4b75-9f38-7dab5a5e2c03';
const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const NOW = new Date('2026-10-09T15:30:00.000Z');
const T0 = new Date('2026-08-01T12:00:00.000Z');

/** Datos de TERCEROS que nunca deben salir en el archivo. */
const VISITOR_RUT = '11.111.111-1';
const VISITOR_PHONE = '+56987654321';
const VISITOR_PLATE = 'ZZXY99';
const QR_CODE = 'qr-secret-123';

function user(): User {
  return {
    id: USER_ID,
    name: 'Ana Residente',
    email: 'ana@example.com',
    emailVerified: true,
    image: 'https://internal.example/avatar.png',
    createdAt: T0,
    updatedAt: T0,
    rut: '12.345.678-5',
    phone: '+56911111111',
    age: 34,
    profilePicture:
      'https://res.cloudinary.com/demo/image/upload/v1/profile-pictures/ana.jpg',
    deletedAt: null as unknown as Date,
    anonymizedAt: null,
    roles: [
      { id: 'r2', name: 'Residente' },
      { id: 'r1', name: 'Conserje' },
    ],
    tokens: [],
    family: {
      id: 'f1',
      organizationId: ORG_A,
      name: 'Familia Pérez',
      description: null,
      active: true,
      digitalConciergeEnabled: true,
      createdAt: T0,
      updatedAt: T0,
      members: [],
      unit: {
        id: 'u1',
        organizationId: ORG_A,
        block: 'A',
        number: '101',
        identifier: 'A-101',
        floor: 1,
        type: 'departamento',
        active: true,
        families: [],
        createdAt: T0,
        updatedAt: T0,
      },
    },
  } as unknown as User;
}

function visit(): Visit {
  return {
    id: 'v1',
    organizationId: ORG_A,
    type: VisitType.VEHICULAR,
    status: VisitStatus.COMPLETED,
    visitorName: 'Pedro Visita',
    visitorRut: VISITOR_RUT,
    visitorPhone: VISITOR_PHONE,
    reason: 'Cumpleaños',
    requestedPlate: VISITOR_PLATE,
    qrCode: QR_CODE,
    maxUses: 1,
    usedCount: 1,
    validFrom: T0,
    validUntil: T0,
    entryTime: T0,
    exitTime: null,
    respondedById: null,
    respondedAt: null,
    anonymizedAt: null,
    createdAt: T0,
    updatedAt: T0,
    family: null,
    vehicle: { plate: VISITOR_PLATE },
  } as unknown as Visit;
}

function notification(): Notification {
  return {
    id: 'n1',
    organizationId: ORG_A,
    type: NotificationType.VISITOR_ARRIVAL,
    title: 'Visitante en Portería',
    message: `Pedro Visita está esperando en la entrada (Patente: ${VISITOR_PLATE})`,
    priority: NotificationPriority.URGENT,
    read: false,
    readAt: null,
    data: { visitor: { rut: VISITOR_RUT, phone: VISITOR_PHONE } },
    actionData: null,
    recipientId: USER_ID,
    createdAt: T0,
    deletedAt: null,
    expiresAt: null,
    requiresAction: true,
    actionTaken: false,
  } as unknown as Notification;
}

describe('DataExportService (Fase 4 · P7.R)', () => {
  let users: { findOne: jest.Mock };
  let vehicles: { find: jest.Mock };
  let visits: { find: jest.Mock };
  let notifications: { find: jest.Mock };
  let query: jest.Mock;
  let service: DataExportService;

  beforeEach(() => {
    users = { findOne: jest.fn().mockResolvedValue(user()) };
    vehicles = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'veh1',
          plate: 'AABB11',
          brand: 'Toyota',
          model: 'Yaris',
          color: 'Rojo',
          year: 2020,
          vehicleType: 'auto',
          accessLevel: 'residente',
          active: true,
          createdAt: T0,
          ownerId: USER_ID,
          owner: user(),
        },
      ]),
    };
    visits = { find: jest.fn().mockResolvedValue([visit()]) };
    notifications = { find: jest.fn().mockResolvedValue([notification()]) };
    query = jest.fn().mockResolvedValue([{ id: ORG_A, name: 'San Lorenzo' }]);
    service = new DataExportService(
      users as unknown as Repository<User>,
      vehicles as unknown as Repository<Vehicle>,
      visits as unknown as Repository<Visit>,
      notifications as unknown as Repository<Notification>,
      { query } as unknown as DataSource,
    );
  });

  it('forma exacta del archivo', async () => {
    await expect(service.exportForUser(USER_ID, NOW)).resolves.toEqual({
      formatVersion: DATA_EXPORT_FORMAT_VERSION,
      generatedAt: '2026-10-09T15:30:00.000Z',
      user: {
        id: USER_ID,
        name: 'Ana Residente',
        email: 'ana@example.com',
        emailVerified: true,
        rut: '12.345.678-5',
        phone: '+56911111111',
        age: 34,
        profilePicture:
          'https://res.cloudinary.com/demo/image/upload/v1/profile-pictures/ana.jpg',
        roles: ['Conserje', 'Residente'],
        condominium: { id: ORG_A, name: 'San Lorenzo' },
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      },
      family: {
        id: 'f1',
        name: 'Familia Pérez',
        description: null,
        unit: {
          identifier: 'A-101',
          block: 'A',
          number: '101',
          floor: 1,
          type: 'departamento',
        },
      },
      vehicles: [
        {
          id: 'veh1',
          plate: 'AABB11',
          brand: 'Toyota',
          model: 'Yaris',
          color: 'Rojo',
          year: 2020,
          vehicleType: 'auto',
          accessLevel: 'residente',
          active: true,
          createdAt: T0.toISOString(),
        },
      ],
      visitsHosted: [
        {
          id: 'v1',
          type: 'vehicular',
          status: 'completed',
          visitorName: 'Pedro Visita',
          reason: 'Cumpleaños',
          validFrom: T0.toISOString(),
          validUntil: T0.toISOString(),
          entryTime: T0.toISOString(),
          exitTime: null,
          maxUses: 1,
          usedCount: 1,
          createdAt: T0.toISOString(),
          anonymized: false,
        },
      ],
      notifications: [
        {
          id: 'n1',
          type: 'VISITOR_ARRIVAL',
          title: 'Visitante en Portería',
          priority: 'urgent',
          read: false,
          readAt: null,
          createdAt: T0.toISOString(),
          deletedAt: null,
        },
      ],
    });
  });

  it('sin datos de terceros: ni RUT, teléfono, patente ni QR del visitante', async () => {
    const serialized = JSON.stringify(
      await service.exportForUser(USER_ID, NOW),
    );

    for (const thirdParty of [
      VISITOR_RUT,
      VISITOR_PHONE,
      VISITOR_PLATE,
      QR_CODE,
    ]) {
      expect(serialized).not.toContain(thirdParty);
    }
    // Campos internos del perfil tampoco.
    expect(serialized).not.toContain('internal.example');
    expect(serialized).not.toContain('anonymizedAt');
  });

  it('solo datos propios: cada consulta va filtrada por el id del titular', async () => {
    await service.exportForUser(USER_ID, NOW);

    expect(users.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } }),
    );
    expect(vehicles.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: USER_ID } }),
    );
    expect(visits.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { host: { id: USER_ID } } }),
    );
    expect(notifications.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: USER_ID },
        withDeleted: true,
      }),
    );
    expect(query).toHaveBeenCalledWith(expect.any(String), [USER_ID]);
  });

  it('sin familia ni condominio: null', async () => {
    users.findOne.mockResolvedValueOnce({ ...user(), family: null });
    query.mockResolvedValueOnce([]);

    const exported = await service.exportForUser(USER_ID, NOW);

    expect(exported.family).toBeNull();
    expect(exported.user.condominium).toBeNull();
  });

  it('una visita ya anonimizada sale marcada', async () => {
    visits.find.mockResolvedValueOnce([
      {
        ...visit(),
        visitorName: '[anonimizado]',
        anonymizedAt: T0,
      },
    ]);

    const exported = await service.exportForUser(USER_ID, NOW);

    expect(exported.visitsHosted[0]).toMatchObject({
      visitorName: '[anonimizado]',
      anonymized: true,
    });
  });

  it('usuario inexistente: 404', async () => {
    users.findOne.mockResolvedValueOnce(null);

    await expect(service.exportForUser(USER_ID, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('nombre del archivo: vigilia-mis-datos-<YYYY-MM-DD>.json', () => {
    expect(dataExportFileName('2026-10-09T15:30:00.000Z')).toBe(
      'vigilia-mis-datos-2026-10-09.json',
    );
  });
});
