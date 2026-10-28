import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuditService } from '../../audit/audit.service';
import {
  AuditAction,
  AuditModule,
} from '../../audit/entities/audit-log.entity';
import type { HubGateway } from '../../hub/hub.gateway';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { UsersService } from '../../users/users.service';
import {
  Visit,
  VisitStatus,
  VisitType,
} from '../../visits/entities/visit.entity';
import { VisitEntryAlreadyRegisteredException } from '../../visits/visit-entry-already-registered.exception';
import type {
  VisitAccessValidation,
  VisitsService,
} from '../../visits/visits.service';
import { KioskQrService, type KioskRedeemer } from './kiosk-qr.service';

describe('KioskQrService', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
  const VISIT_ID = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607';
  const HOST_ID = 'host-1';
  const QR = 'SECRETQRCODE1234';
  const KIOSK: KioskRedeemer = { hubId: 'kiosk-1', organizationId: ORG };

  let visitsService: { validateAccess: jest.Mock; checkIn: jest.Mock };
  let usersService: { isActiveMemberOfOrganization: jest.Mock };
  let hubGateway: { sendDoorOpen: jest.Mock };
  let notificationsService: { notifyByRoleForOrganization: jest.Mock };
  let auditService: {
    log: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
  };
  let service: KioskQrService;

  function makeVisit(overrides: Partial<Visit> = {}): Visit {
    return {
      id: VISIT_ID,
      organizationId: ORG,
      type: VisitType.PEDESTRIAN,
      status: VisitStatus.PENDING,
      visitorName: 'Juan Pérez',
      qrCode: QR,
      usedCount: 0,
      maxUses: 1,
      host: { id: HOST_ID },
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 3_600_000),
      ...overrides,
    } as Visit;
  }

  function containing(shape: Record<string, unknown>): Record<string, unknown> {
    return expect.objectContaining(shape) as Record<string, unknown>;
  }

  function valid(visit: Visit): VisitAccessValidation {
    return { valid: true, visit, message: 'Acceso autorizado' };
  }

  function invalid(visit?: Visit): VisitAccessValidation {
    return { valid: false, visit, message: 'no' };
  }

  beforeEach(() => {
    visitsService = {
      validateAccess: jest.fn().mockResolvedValue(valid(makeVisit())),
      checkIn: jest.fn().mockResolvedValue(makeVisit()),
    };
    usersService = {
      isActiveMemberOfOrganization: jest.fn().mockResolvedValue(true),
    };
    hubGateway = { sendDoorOpen: jest.fn().mockReturnValue(1) };
    notificationsService = {
      notifyByRoleForOrganization: jest.fn().mockResolvedValue([]),
    };
    auditService = {
      log: jest
        .fn<Promise<unknown>, [Record<string, unknown>]>()
        .mockResolvedValue({}),
    };
    service = new KioskQrService(
      visitsService as unknown as VisitsService,
      usersService as unknown as UsersService,
      hubGateway as unknown as HubGateway,
      notificationsService as unknown as NotificationsService,
      auditService as unknown as AuditService,
    );
  });

  function expectNoWrites(): void {
    expect(visitsService.checkIn).not.toHaveBeenCalled();
    expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
  }

  describe('concedido', () => {
    it('peatonal: check-in con scope del condominio, apertura a hubs físicos y respuesta sin PII', async () => {
      const result = await service.redeem(KIOSK, QR);

      expect(result).toEqual({
        status: 'granted',
        access: 'pedestrian',
        doorOpened: true,
      });
      expect(visitsService.validateAccess).toHaveBeenCalledWith(QR, 'qr');
      expect(usersService.isActiveMemberOfOrganization).toHaveBeenCalledWith(
        HOST_ID,
        ORG,
      );
      expect(visitsService.checkIn).toHaveBeenCalledWith(
        VISIT_ID,
        { organizationId: ORG },
        { channel: 'kiosk', onlyFromStatus: VisitStatus.PENDING },
      );
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: ORG },
        { type: 'pedestrian', visitId: VISIT_ID },
      );
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('Juan');
    });

    it('vehicular -> access vehicular y type vehicular en la orden', async () => {
      visitsService.validateAccess.mockResolvedValue(
        valid(makeVisit({ type: VisitType.VEHICULAR })),
      );

      const result = await service.redeem(KIOSK, QR);

      expect(result).toEqual({
        status: 'granted',
        access: 'vehicular',
        doorOpened: true,
      });
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: ORG },
        { type: 'vehicular', visitId: VISIT_ID },
      );
    });

    it.each<[string, Partial<Visit>]>([
      ['READY_FOR_REENTRY', { status: VisitStatus.READY_FOR_REENTRY }],
      [
        'READY_FOR_REENTRY con usos',
        { status: VisitStatus.READY_FOR_REENTRY, usedCount: 1, maxUses: 3 },
      ],
      ['PENDING con usedCount > 0', { usedCount: 1, maxUses: 3 }],
    ])(
      'reingreso (%s) -> no_uses_left sin check-in ni apertura',
      async (_label, overrides) => {
        visitsService.validateAccess.mockResolvedValue(
          valid(makeVisit(overrides)),
        );

        await expect(service.redeem(KIOSK, QR)).resolves.toEqual({
          status: 'denied',
          reason: 'no_uses_left',
        });
        expectNoWrites();
      },
    );

    it('el check-in ocurre ANTES de la orden de apertura', async () => {
      const order: string[] = [];
      visitsService.checkIn.mockImplementation(() => {
        order.push('checkIn');
        return Promise.resolve(makeVisit());
      });
      hubGateway.sendDoorOpen.mockImplementation(() => {
        order.push('door');
        return 1;
      });

      await service.redeem(KIOSK, QR);

      expect(order).toEqual(['checkIn', 'door']);
    });
  });

  describe('0 hubs físicos entregados', () => {
    it('doorOpened false, ingreso registrado y alerta a conserjería del condominio', async () => {
      hubGateway.sendDoorOpen.mockReturnValue(0);

      const result = await service.redeem(KIOSK, QR);

      expect(result).toEqual({
        status: 'granted',
        access: 'pedestrian',
        doorOpened: false,
      });
      expect(visitsService.checkIn).toHaveBeenCalledTimes(1);
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).toHaveBeenCalledWith(
        'Conserje',
        ORG,
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          data: { visitId: VISIT_ID, hubId: 'kiosk-1' },
        }),
      );
    });

    it('si el gateway lanza, tampoco se declara abierta y se alerta', async () => {
      hubGateway.sendDoorOpen.mockImplementation(() => {
        throw new Error('socket caído');
      });

      const result = await service.redeem(KIOSK, QR);

      expect(result).toMatchObject({ status: 'granted', doorOpened: false });
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).toHaveBeenCalled();
    });

    it('si la alerta falla, el canje igual responde concedido', async () => {
      hubGateway.sendDoorOpen.mockReturnValue(0);
      notificationsService.notifyByRoleForOrganization.mockRejectedValue(
        new Error('boom'),
      );

      await expect(service.redeem(KIOSK, QR)).resolves.toMatchObject({
        status: 'granted',
        doorOpened: false,
      });
    });
  });

  describe('denegado (sin check-in ni apertura)', () => {
    const past = new Date(Date.now() - 3_600_000);
    const future = new Date(Date.now() + 3_600_000);

    it.each<[string, VisitAccessValidation, string]>([
      ['código inexistente', invalid(undefined), 'invalid'],
      [
        'visita cancelada',
        invalid(makeVisit({ status: VisitStatus.CANCELLED })),
        'invalid',
      ],
      [
        'pendiente de aprobación',
        invalid(makeVisit({ status: VisitStatus.AWAITING_APPROVAL })),
        'invalid',
      ],
      [
        'rechazada',
        invalid(makeVisit({ status: VisitStatus.DENIED })),
        'invalid',
      ],
      [
        'aún no vigente',
        invalid(makeVisit({ validFrom: future, validUntil: future })),
        'not_yet_valid',
      ],
      [
        'ventana vencida',
        invalid(makeVisit({ validFrom: past, validUntil: past })),
        'expired',
      ],
      [
        'estado expirada',
        invalid(makeVisit({ status: VisitStatus.EXPIRED })),
        'expired',
      ],
      [
        'completada',
        invalid(makeVisit({ status: VisitStatus.COMPLETED })),
        'no_uses_left',
      ],
      [
        'reingreso sin usos',
        invalid(
          makeVisit({
            status: VisitStatus.READY_FOR_REENTRY,
            usedCount: 1,
            maxUses: 1,
          }),
        ),
        'no_uses_left',
      ],
    ])('%s -> %s', async (_label, validation, reason) => {
      visitsService.validateAccess.mockResolvedValue(validation);

      await expect(service.redeem(KIOSK, QR)).resolves.toEqual({
        status: 'denied',
        reason,
      });
      expectNoWrites();
    });

    it('anfitrión ya no miembro activo -> host_inactive', async () => {
      usersService.isActiveMemberOfOrganization.mockResolvedValue(false);

      await expect(service.redeem(KIOSK, QR)).resolves.toEqual({
        status: 'denied',
        reason: 'host_inactive',
      });
      expectNoWrites();
    });

    it('anfitrión deshabilitado (join nulo) -> host_inactive sin consultar membresía', async () => {
      visitsService.validateAccess.mockResolvedValue(
        valid(makeVisit({ host: null as never })),
      );

      await expect(service.redeem(KIOSK, QR)).resolves.toEqual({
        status: 'denied',
        reason: 'host_inactive',
      });
      expect(usersService.isActiveMemberOfOrganization).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it('carrera: check-in con otro Conflict o BadRequest -> invalid, sin abrir', async () => {
      for (const error of [
        new ConflictException('estado'),
        new BadRequestException('ventana'),
      ]) {
        visitsService.checkIn.mockRejectedValueOnce(error);
        await expect(service.redeem(KIOSK, QR)).resolves.toEqual({
          status: 'denied',
          reason: 'invalid',
        });
      }
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('un error inesperado del check-in se propaga y no abre', async () => {
      visitsService.checkIn.mockRejectedValue(new Error('BD caída'));

      await expect(service.redeem(KIOSK, QR)).rejects.toThrow('BD caída');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });
  });

  describe('aislamiento entre condominios', () => {
    it('una visita de OTRO condominio se trata como inexistente (invalid) y no se escribe nada', async () => {
      visitsService.validateAccess.mockResolvedValue(
        valid(makeVisit({ organizationId: OTHER_ORG })),
      );

      await expect(service.redeem(KIOSK, QR)).resolves.toEqual({
        status: 'denied',
        reason: 'invalid',
      });
      expectNoWrites();
      expect(usersService.isActiveMemberOfOrganization).not.toHaveBeenCalled();
    });

    it('la orden de apertura y el check-in van siempre con el condominio del kiosko', async () => {
      const otherKiosk: KioskRedeemer = {
        hubId: 'kiosk-9',
        organizationId: OTHER_ORG,
      };
      visitsService.validateAccess.mockResolvedValue(
        valid(makeVisit({ organizationId: OTHER_ORG })),
      );

      await service.redeem(otherKiosk, QR);

      expect(visitsService.checkIn).toHaveBeenCalledWith(
        VISIT_ID,
        { organizationId: OTHER_ORG },
        expect.anything(),
      );
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: OTHER_ORG },
        expect.anything(),
      );
    });
  });

  describe('doble canje (replay de un QR estático)', () => {
    it('el primero concede y el segundo (check-in ya registrado) -> already_inside, con UNA sola apertura', async () => {
      visitsService.checkIn
        .mockResolvedValueOnce(makeVisit())
        .mockRejectedValueOnce(new VisitEntryAlreadyRegisteredException());

      const first = await service.redeem(KIOSK, QR);
      const second = await service.redeem(KIOSK, QR);

      expect(first).toMatchObject({ status: 'granted' });
      expect(second).toEqual({ status: 'denied', reason: 'already_inside' });
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('auditoría y registro', () => {
    it('audita con actor de máquina (sin userId) y sin el qrCode', async () => {
      await service.redeem(KIOSK, QR);

      expect(auditService.log).toHaveBeenCalledTimes(1);
      const entry = auditService.log.mock.calls[0][0];
      expect(entry).toMatchObject({
        module: AuditModule.DIGITAL_CONCIERGE,
        action: AuditAction.VISIT_QR_VALIDATE,
        organizationId: ORG,
        entityId: VISIT_ID,
        newValue: containing({
          source: 'kiosk',
          hubId: 'kiosk-1',
          result: 'granted',
        }),
      });
      expect(entry).not.toHaveProperty('userId');
      expect(JSON.stringify(entry)).not.toContain(QR);
    });

    it('audita también el rechazo con su motivo', async () => {
      visitsService.validateAccess.mockResolvedValue(invalid(undefined));

      await service.redeem(KIOSK, QR);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: containing({
            result: 'denied',
            reason: 'invalid',
          }),
        }),
      );
    });

    it('un fallo de auditoría no altera el resultado', async () => {
      auditService.log.mockRejectedValue(new Error('BD'));

      await expect(service.redeem(KIOSK, QR)).resolves.toMatchObject({
        status: 'granted',
      });
    });

    it('el qrCode nunca aparece en los logs', async () => {
      const logger = (service as unknown as { logger: Record<string, unknown> })
        .logger;
      const calls: unknown[][] = [];
      for (const level of ['log', 'warn', 'error']) {
        logger[level] = (...args: unknown[]) => {
          calls.push(args);
        };
      }
      hubGateway.sendDoorOpen.mockReturnValue(0);
      await service.redeem(KIOSK, QR);
      visitsService.validateAccess.mockResolvedValue(invalid(undefined));
      await service.redeem(KIOSK, QR);

      const logged = JSON.stringify(calls);
      expect(logged).not.toContain(QR);
      expect(logged).toContain('kiosk-1');
    });
  });
});
