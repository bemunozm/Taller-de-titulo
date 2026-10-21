import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { TenantActor } from '../common/tenant/tenant-actor';
import type { UsersService } from '../users/users.service';
import type { DisabledUserAnonymizer } from './disabled-user-anonymizer.service';
import type {
  ErasureRepository,
  ErasureTransaction,
  MatchedDetection,
  MatchedRecord,
  MatchedSession,
  MatchScope,
} from './erasure.repository';
import type { SubjectErasureRequest } from './erasure-request';
import {
  ERASURE_MAX_ROWS_PER_CATEGORY,
  PrivacyErasureService,
} from './privacy-erasure.service';

const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const ORG_B = '1c6e7e46-3a7b-4a64-8e27-6c9a4f4d1b02';
const USER_ID = '2d7f8f57-4b8c-4b75-9f38-7dab5a5e2c03';
const RUT = '12.345.678-5';
const PLATE = 'BB-CD 12';

function actor(overrides: Partial<TenantActor> = {}): TenantActor {
  return {
    userId: 'admin-1',
    organizationId: ORG_A,
    isSuperAdmin: false,
    permissionNames: new Set(['privacy.manage']),
    familyId: null,
    ...overrides,
  };
}

/** Coincidencias por alcance (`erasable` / `kept`) que devuelve el doble. */
interface Matches {
  visits: Record<MatchScope, MatchedRecord[]>;
  sessions: Record<MatchScope, MatchedSession[]>;
  detections: Record<MatchScope, MatchedDetection[]>;
  vehicles: Record<MatchScope, MatchedRecord[]>;
}

function noMatches(): Matches {
  return {
    visits: { erasable: [], kept: [] },
    sessions: { erasable: [], kept: [] },
    detections: { erasable: [], kept: [] },
    vehicles: { erasable: [], kept: [] },
  };
}

function ids(prefix: string, count: number): MatchedRecord[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` }));
}

function fakeTransaction(matches: Matches) {
  const take = <T>(rows: T[], limit: number) =>
    Promise.resolve(rows.slice(0, limit));
  return {
    findVisits: jest.fn(
      (_request: SubjectErasureRequest, scope: MatchScope, limit: number) =>
        take(matches.visits[scope], limit),
    ),
    anonymizeVisits: jest.fn((visitIds: readonly string[]) =>
      Promise.resolve(visitIds.length),
    ),
    findSessions: jest.fn(
      (
        _request: SubjectErasureRequest,
        _visitIds: readonly string[],
        scope: MatchScope,
        limit: number,
      ) => take(matches.sessions[scope], limit),
    ),
    anonymizeSessions: jest.fn((sessionIds: readonly string[]) =>
      Promise.resolve(sessionIds.length),
    ),
    findDetections: jest.fn(
      (_request: SubjectErasureRequest, scope: MatchScope, limit: number) =>
        take(matches.detections[scope], limit),
    ),
    anonymizeDetections: jest.fn<
      Promise<{ detections: number; accessAttempts: number }>,
      [readonly string[], readonly string[]]
    >((detectionIds) =>
      Promise.resolve({
        detections: detectionIds.length,
        accessAttempts: detectionIds.length,
      }),
    ),
    anonymizePassages: jest.fn().mockResolvedValue(0),
    findVisitorVehicles: jest.fn(
      (_request: SubjectErasureRequest, scope: MatchScope, limit: number) =>
        take(matches.vehicles[scope], limit),
    ),
    deleteVisitorVehicles: jest.fn((vehicleIds: readonly string[]) =>
      Promise.resolve(vehicleIds.length),
    ),
    deleteNotifications: jest.fn().mockResolvedValue(0),
    deletePendingActions: jest.fn().mockResolvedValue(0),
  } satisfies ErasureTransaction;
}

describe('PrivacyErasureService (Fase 4 · P7.R)', () => {
  let matches: Matches;
  let tx: ReturnType<typeof fakeTransaction>;
  let inTransaction: jest.Mock;
  let assertCanAnonymizeForActor: jest.Mock;
  let anonymize: jest.Mock;
  let service: PrivacyErasureService;

  beforeEach(() => {
    matches = noMatches();
    tx = fakeTransaction(matches);
    inTransaction = jest.fn(
      (work: (transaction: ErasureTransaction) => Promise<unknown>) => work(tx),
    );
    assertCanAnonymizeForActor = jest.fn().mockResolvedValue(undefined);
    anonymize = jest.fn().mockResolvedValue({
      alreadyAnonymized: false,
      picturesDeleted: 0,
      picturePending: false,
    });
    service = new PrivacyErasureService(
      { inTransaction } as unknown as ErasureRepository,
      { assertCanAnonymizeForActor } as unknown as UsersService,
      { anonymize } as unknown as DisabledUserAnonymizer,
    );
  });

  describe('por RUT', () => {
    it('anonimiza lo terminal, omite lo vigente y lo informa en conteos (todo en una transacción)', async () => {
      matches.visits.erasable = [{ id: 'v-done' }, { id: 'v-denied' }];
      matches.visits.kept = [{ id: 'v-active' }];
      matches.sessions.erasable = [{ id: 's-done', sessionKey: 'sess-done' }];
      matches.sessions.kept = [{ id: 's-live', sessionKey: 'sess-live' }];
      tx.deleteNotifications.mockResolvedValue(3);
      tx.deletePendingActions.mockResolvedValue(1);

      const result = await service.erase({ rut: RUT }, actor());

      expect(inTransaction).toHaveBeenCalledTimes(1);
      const request = {
        kind: 'rut',
        key: '123456785',
        organizationId: ORG_A,
      };
      expect(tx.findVisits).toHaveBeenCalledWith(
        request,
        'erasable',
        ERASURE_MAX_ROWS_PER_CATEGORY + 1,
      );
      expect(tx.anonymizeVisits).toHaveBeenCalledWith(['v-done', 'v-denied']);
      expect(tx.findSessions).toHaveBeenCalledWith(
        request,
        ['v-done', 'v-denied', 'v-active'],
        'erasable',
        ERASURE_MAX_ROWS_PER_CATEGORY + 1,
      );
      expect(tx.anonymizeSessions).toHaveBeenCalledWith(['s-done']);
      expect(tx.deleteNotifications).toHaveBeenCalledWith(
        request,
        {
          visitIds: ['v-done', 'v-denied'],
          sessionKeys: ['s-done', 'sess-done'],
          detectionIds: [],
        },
        {
          visitIds: ['v-active'],
          sessionKeys: ['s-live', 'sess-live'],
          detectionIds: [],
        },
        ERASURE_MAX_ROWS_PER_CATEGORY,
      );
      expect(tx.deletePendingActions).toHaveBeenCalledWith(
        ORG_A,
        ['s-done', 'sess-done'],
        ERASURE_MAX_ROWS_PER_CATEGORY,
      );
      expect(result).toEqual({
        criterion: 'rut',
        organizationId: ORG_A,
        anonymized: {
          visits: 2,
          conciergeSessions: 1,
          detections: 0,
          accessAttempts: 0,
          users: 0,
        },
        deleted: { notifications: 3, pendingActions: 1, visitorVehicles: 0 },
        skipped: {
          visits: 1,
          conciergeSessions: 1,
          detections: 0,
          visitorVehicles: 0,
        },
        imagesPendingDeletion: 0,
        complete: true,
      });
    });

    it('la respuesta (que guarda la auditoría) no trae el RUT', async () => {
      matches.visits.erasable = [{ id: 'v1' }];

      const result = await service.erase({ rut: RUT }, actor());

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('12.345.678');
      expect(serialized).not.toContain('123456785');
      expect(result).not.toHaveProperty('id');
    });
  });

  describe('por patente', () => {
    it('detecciones: anonimiza las que no esperan al conserje; los frames remotos quedan encolados (sin Cloudinary)', async () => {
      matches.detections.erasable = [
        {
          id: 'd-cloud',
          fullFramePath:
            'https://res.cloudinary.com/vigilia/image/upload/v1/a.jpg',
        },
        { id: 'd-local', fullFramePath: '/var/lpr/frame.jpg' },
        { id: 'd-none', fullFramePath: null },
      ];
      matches.detections.kept = [{ id: 'd-pending', fullFramePath: null }];

      const result = await service.erase({ plate: PLATE }, actor());

      // Se limpian en el acto el recorte de todas y el frame local; el de
      // Cloudinary queda para la retención.
      expect(tx.anonymizeDetections).toHaveBeenCalledWith(
        ['d-cloud', 'd-local', 'd-none'],
        ['d-local', 'd-none'],
      );
      expect(tx.deleteNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'plate', key: 'BBCD12' }),
        expect.objectContaining({
          detectionIds: ['d-cloud', 'd-local', 'd-none'],
        }),
        expect.objectContaining({ detectionIds: ['d-pending'] }),
        ERASURE_MAX_ROWS_PER_CATEGORY,
      );
      expect(result.anonymized.detections).toBe(3);
      expect(result.anonymized.accessAttempts).toBe(3);
      expect(result.skipped.detections).toBe(1);
      expect(result.imagesPendingDeletion).toBe(1);
      expect(JSON.stringify(result)).not.toContain('BBCD12');
    });

    it('vehículos de visita: borra los huérfanos DESPUÉS de soltar las visitas; los que usa una visita vigente se omiten', async () => {
      matches.visits.erasable = [{ id: 'v-done' }];
      matches.vehicles.erasable = [{ id: 'veh-orphan' }];
      matches.vehicles.kept = [{ id: 'veh-in-use' }];

      const result = await service.erase({ plate: PLATE }, actor());

      expect(tx.deleteVisitorVehicles).toHaveBeenCalledWith(['veh-orphan']);
      expect(tx.anonymizeVisits.mock.invocationCallOrder[0]).toBeLessThan(
        tx.findVisitorVehicles.mock.invocationCallOrder[0],
      );
      expect(result.deleted.visitorVehicles).toBe(1);
      expect(result.skipped.visitorVehicles).toBe(1);
    });
  });

  describe('lotes acotados por request (cyber B7)', () => {
    it('si una categoría tiene más de 500 filas procesa 500 y responde complete: false', async () => {
      matches.visits.erasable = ids('v', ERASURE_MAX_ROWS_PER_CATEGORY + 20);

      const result = await service.erase({ rut: RUT }, actor());

      expect(tx.anonymizeVisits.mock.calls[0][0]).toHaveLength(
        ERASURE_MAX_ROWS_PER_CATEGORY,
      );
      expect(result.anonymized.visits).toBe(ERASURE_MAX_ROWS_PER_CATEGORY);
      expect(result.complete).toBe(false);
    });

    it('exactamente 500: completo', async () => {
      matches.visits.erasable = ids('v', ERASURE_MAX_ROWS_PER_CATEGORY);

      await expect(service.erase({ rut: RUT }, actor())).resolves.toMatchObject(
        { complete: true },
      );
    });

    it('notificaciones en el tope: complete: false (repetir el pedido)', async () => {
      tx.deleteNotifications.mockResolvedValue(ERASURE_MAX_ROWS_PER_CATEGORY);

      await expect(service.erase({ rut: RUT }, actor())).resolves.toMatchObject(
        { complete: false },
      );
    });
  });

  describe('acotado al condominio', () => {
    it('el Administrador solo suprime en SU condominio', async () => {
      await service.erase({ plate: PLATE }, actor());

      expect(tx.findVisits).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_A }),
        'erasable',
        expect.any(Number),
      );
    });

    it('si pide otro condominio: 403 sin abrir la transacción', async () => {
      await expect(
        service.erase({ plate: PLATE, organizationId: ORG_B }, actor()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(inTransaction).not.toHaveBeenCalled();
    });

    it('el super-admin suprime en el condominio que indica', async () => {
      const result = await service.erase(
        { rut: RUT, organizationId: ORG_B },
        actor({ isSuperAdmin: true, organizationId: null }),
      );

      expect(tx.findVisits).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_B }),
        'erasable',
        expect.any(Number),
      );
      expect(result.organizationId).toBe(ORG_B);
    });
  });

  describe('por usuario', () => {
    it('valida que el actor pueda administrarlo y lo anonimiza sin esperar el plazo, sin llamar a Cloudinary', async () => {
      anonymize.mockResolvedValueOnce({
        alreadyAnonymized: false,
        picturesDeleted: 0,
        picturePending: true,
      });

      const result = await service.erase({ userId: USER_ID }, actor());

      expect(assertCanAnonymizeForActor).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ userId: 'admin-1' }),
      );
      expect(anonymize).toHaveBeenCalledWith(USER_ID, { deferPictures: true });
      expect(
        assertCanAnonymizeForActor.mock.invocationCallOrder[0],
      ).toBeLessThan(anonymize.mock.invocationCallOrder[0]);
      expect(result).toMatchObject({
        criterion: 'userId',
        id: USER_ID,
        organizationId: ORG_A,
        anonymized: { users: 1 },
        imagesPendingDeletion: 1,
        complete: true,
      });
      expect(inTransaction).not.toHaveBeenCalled();
    });

    it('fuera del alcance, sin jerarquía o cuenta de personal: no anonimiza', async () => {
      assertCanAnonymizeForActor.mockRejectedValueOnce(
        new ForbiddenException('cuenta de personal'),
      );

      await expect(
        service.erase({ userId: USER_ID }, actor()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(anonymize).not.toHaveBeenCalled();
    });

    it('si no está deshabilitado: 409 (lo decide UsersService)', async () => {
      anonymize.mockRejectedValueOnce(new ConflictException('deshabilitada'));

      await expect(
        service.erase({ userId: USER_ID }, actor()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('ya anonimizado: idempotente (users: 0)', async () => {
      anonymize.mockResolvedValueOnce({
        alreadyAnonymized: true,
        picturesDeleted: 0,
        picturePending: false,
      });

      const result = await service.erase({ userId: USER_ID }, actor());

      expect(result.anonymized.users).toBe(0);
    });
  });
});
