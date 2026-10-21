import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { ListMyNotificationsDto } from './dto/list-my-notifications.dto';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { UsersService } from '../users/users.service';
import { Notification, NotificationType } from './entities/notification.entity';

/**
 * Fase 4 · P4 (D5): la notificación de "visitante en portería" lleva
 * `sessionId` Y `visitId`. El residente responde `POST
 * /concierge/session/:sessionId/respond` con ese `visitId` en el body.
 */
describe('NotificationsService.notifyVisitorArrival', () => {
  let service: NotificationsService;
  let repository: { create: jest.Mock; save: jest.Mock };
  let gateway: { sendToUser: jest.Mock };

  beforeEach(() => {
    repository = {
      create: jest.fn((input: Partial<Notification>) => ({ ...input })),
      save: jest.fn((input: Partial<Notification>) =>
        Promise.resolve({
          ...input,
          id: 'notif-1',
          createdAt: new Date('2026-10-08T12:00:00Z'),
        }),
      ),
    };
    gateway = { sendToUser: jest.fn() };
    const dataSource = {
      query: jest.fn().mockResolvedValue([{ organizationId: 'condo-A' }]),
    };

    service = new NotificationsService(
      repository as unknown as Repository<Notification>,
      gateway as unknown as NotificationsGateway,
      {} as UsersService,
      dataSource as unknown as DataSource,
    );
  });

  it('persiste y emite data.sessionId y data.visitId', async () => {
    await service.notifyVisitorArrival(
      'resident-1',
      { sessionId: 'session-1', visitId: 'visit-1' },
      { name: 'Juan Pérez', plate: 'BBCD12' },
    );

    const [persisted] = repository.create.mock.calls[0] as [
      { type: NotificationType; data: Record<string, unknown> },
    ];
    expect(persisted.type).toBe(NotificationType.VISITOR_ARRIVAL);
    expect(persisted.data).toEqual(
      expect.objectContaining({ sessionId: 'session-1', visitId: 'visit-1' }),
    );

    // Lo que recibe el frontend en tiempo real: `notification.payload.data`.
    const [recipientId, event, payload] = gateway.sendToUser.mock.calls[0] as [
      string,
      string,
      { data: Record<string, unknown> },
    ];
    expect(recipientId).toBe('resident-1');
    expect(event).toBe('notification');
    expect(payload.data).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        visitId: 'visit-1',
        notificationId: 'notif-1',
      }),
    );
  });
});

/**
 * Fase 4 · P5.B (IDOR): `GET /notifications?recipientId=<uuid>` leía las
 * notificaciones de CUALQUIER usuario (`dto.recipientId` tenía prioridad
 * sobre el usuario de la sesión).
 */
describe('Notificaciones — IDOR de recipientId (P5.B)', () => {
  const OTHER_USER = '33333333-3333-4333-8333-333333333333';

  it('GET /notifications ya no acepta recipientId (400)', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    await expect(
      pipe.transform(
        { recipientId: OTHER_USER },
        { type: 'query', metatype: ListMyNotificationsDto },
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform(
        { read: 'false', page: '1' },
        { type: 'query', metatype: ListMyNotificationsDto },
      ),
    ).resolves.toEqual(expect.objectContaining({ read: false, page: 1 }));
  });

  it('findAll filtra SIEMPRE por el usuario de la sesión (P5.C: el dto ya no tiene recipientId)', async () => {
    const recipientParams: unknown[] = [];
    const queryBuilder = (): Record<string, jest.Mock> => {
      const qb: Record<string, jest.Mock> = {};
      for (const method of ['orderBy', 'skip', 'take', 'andWhere']) {
        qb[method] = jest.fn(() => qb);
      }
      qb.where = jest.fn((_sql: string, params: { recipientId: unknown }) => {
        recipientParams.push(params.recipientId);
        return qb;
      });
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      qb.getCount = jest.fn().mockResolvedValue(0);
      return qb;
    };
    const service = new NotificationsService(
      {
        createQueryBuilder: jest.fn(queryBuilder),
      } as unknown as Repository<Notification>,
      {} as NotificationsGateway,
      {} as UsersService,
      {} as DataSource,
    );

    await service.findAll({ read: false }, 'session-user');

    expect(recipientParams).toEqual(['session-user', 'session-user']);
    expect(recipientParams).not.toContain(OTHER_USER);
  });

  it('P5.C: notifyByRoleForOrganization sin condominio no notifica a nadie (antes, a los usuarios sin condominio)', async () => {
    const findByRole = jest.fn();
    const service = new NotificationsService(
      {} as unknown as Repository<Notification>,
      {} as NotificationsGateway,
      { findByRole } as unknown as UsersService,
      {} as DataSource,
    );

    await expect(
      service.notifyByRoleForOrganization(
        'Conserje',
        null,
        NotificationType.UNKNOWN_VEHICLE,
        'Título',
        'Mensaje',
      ),
    ).resolves.toEqual([]);
    expect(findByRole).not.toHaveBeenCalled();
  });
});
