import type { ConfigService } from '@nestjs/config';
import type { DataSource, FindOperator } from 'typeorm';
import { AccessAttempt } from './entities/access-attempt.entity';
import { PlateDetection } from './entities/plate-detection.entity';
import { VehiclePassage } from './entities/vehicle-passage.entity';
import type { DirectionReading } from './vehicle-passage-direction';
import {
  MAX_SIGHTINGS_PER_PASSAGE,
  VehiclePassagesService,
  type PassageClaim,
} from './vehicle-passages.service';

/**
 * `VehiclePassagesService` con un `DataSource`/`EntityManager` simulados: la
 * lógica de decisión (compatibilidad, promoción, huérfana, upsert del intento,
 * compensaciones). El lock real y la concurrencia se prueban contra Postgres en
 * `vehicle-passages.integration.spec.ts`.
 */
describe('VehiclePassagesService', () => {
  const ORG = 'org-1';
  const PLATE = 'ABCD12';
  const NOW = new Date('2026-10-21T12:00:00.000Z').getTime();
  const noConfig = { get: () => undefined } as unknown as ConfigService;

  interface ManagerMock {
    query: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    exists: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  }

  let manager: ManagerMock;
  let dataSource: {
    transaction: jest.Mock;
    query: jest.Mock;
    getRepository: jest.Mock;
  };
  let passageRepo: { find: jest.Mock };
  let service: VehiclePassagesService;

  const reading = (
    direction: DirectionReading['direction'],
    source: DirectionReading['source'],
  ): DirectionReading => ({ direction, source });

  /** Pasada abierta de prueba; edades en segundos respecto de NOW. */
  function passage(overrides: Partial<VehiclePassage> = {}): VehiclePassage {
    return {
      id: 'passage-1',
      organizationId: ORG,
      plate: PLATE,
      direction: 'entry',
      directionSource: 'line',
      firstSeenAt: new Date(NOW - 5_000),
      lastSeenAt: new Date(NOW - 2_000),
      leaderClaimedAt: new Date(NOW - 5_000),
      sightingCount: 1,
      decidesAccess: true,
      leaderToken: 'token-actual',
      methodFollowsDirection: true,
      ...overrides,
    } as VehiclePassage;
  }

  function detection(): PlateDetection {
    return Object.assign(new PlateDetection(), {
      id: 'det-new',
      organizationId: ORG,
      plate: PLATE,
      cameraId: 'cam-1',
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    manager = {
      query: jest.fn().mockResolvedValue([]),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      exists: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn((_target: unknown, value: object) =>
        Promise.resolve(value),
      ),
      create: jest.fn((_target: unknown, value: object) => ({
        id: 'passage-new',
        ...value,
      })),
    };
    passageRepo = { find: jest.fn().mockResolvedValue([]) };
    dataSource = {
      transaction: jest.fn((work: (m: ManagerMock) => Promise<unknown>) =>
        work(manager),
      ),
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn(() => passageRepo),
    };
    service = new VehiclePassagesService(
      dataSource as unknown as DataSource,
      noConfig,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const claim = (
    r: DirectionReading,
    decidesAccess = true,
  ): Promise<PassageClaim> => service.claim(detection(), r, { decidesAccess });

  describe('claim: sin pasada abierta', () => {
    it('toma el advisory lock ANTES de buscar y crea una pasada líder con el rol de la cámara', async () => {
      const result = await claim(reading('exit', 'line'), false);

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [`vigilia.lpr.passage:${ORG}`, PLATE],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        manager.find.mock.invocationCallOrder[0],
      );
      expect(manager.create).toHaveBeenCalledWith(
        VehiclePassage,
        expect.objectContaining({
          organizationId: ORG,
          plate: PLATE,
          direction: 'exit',
          directionSource: 'line',
          sightingCount: 1,
          decidesAccess: false,
        }),
      );
      expect(result).toMatchObject({ kind: 'leader', promoted: false });
      expect(result.detection.passageId).toBe('passage-new');
    });

    it('busca solo dentro de la ventana deslizante (60 s por defecto)', async () => {
      await claim(reading('entry', 'line'));

      const [, options] = manager.find.mock.calls[0] as [
        unknown,
        { where: { lastSeenAt: FindOperator<Date> }; order: object },
      ];
      expect(options.where.lastSeenAt.value).toEqual(new Date(NOW - 60_000));
      expect(options.order).toEqual({ lastSeenAt: 'DESC' });
    });

    it('rechaza una detección sin condominio (no agrupa en el cajón nulo)', async () => {
      const orphan = detection();
      orphan.organizationId = null;

      await expect(
        service.claim(orphan, reading('entry', 'line'), {
          decidesAccess: true,
        }),
      ).rejects.toThrow(/condominio/);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('claim: compatibilidad con la pasada abierta', () => {
    it('salta una pasada contradicha por línea (tras la brecha de reversa) y usa la siguiente compatible', async () => {
      manager.find.mockResolvedValue([
        passage({
          id: 'contradicha',
          direction: 'entry',
          directionSource: 'line',
          firstSeenAt: new Date(NOW - 20_000),
        }),
        passage({
          id: 'compatible',
          direction: 'exit',
          directionSource: 'line',
          firstSeenAt: new Date(NOW - 30_000),
        }),
      ]);

      const result = await claim(reading('exit', 'line'));

      expect(result.kind).toBe('sighting');
      expect(result.passage.id).toBe('compatible');
    });

    it('si todas las abiertas la contradicen, abre una pasada nueva', async () => {
      manager.find.mockResolvedValue([
        passage({ firstSeenAt: new Date(NOW - 20_000) }),
      ]);

      const result = await claim(reading('exit', 'line'));

      expect(result).toMatchObject({ kind: 'leader', promoted: false });
      expect(manager.create).toHaveBeenCalled();
    });

    it('antes de la brecha mínima de reversa (15 s) la dirección contraria es evidencia', async () => {
      manager.find.mockResolvedValue([
        passage({ firstSeenAt: new Date(NOW - 14_000) }),
      ]);

      const result = await claim(reading('exit', 'line'));

      expect(result.kind).toBe('sighting');
    });

    it('camera nunca parte una pasada, ni en la abierta ni en la entrante', async () => {
      manager.find.mockResolvedValue([
        passage({
          direction: 'entry',
          directionSource: 'camera',
          firstSeenAt: new Date(NOW - 60_000),
        }),
      ]);

      const result = await claim(reading('exit', 'camera'));

      expect(result.kind).toBe('sighting');
    });
  });

  describe('claim: evidencia (addSighting)', () => {
    it('renueva la ventana, cuenta la lectura y devuelve el intento de la pasada', async () => {
      manager.find.mockResolvedValue([passage({ sightingCount: 3 })]);
      const attempt = { id: 'att-1' } as AccessAttempt;
      manager.findOne.mockResolvedValue(attempt);

      const result = await claim(reading('entry', 'line'));

      expect(result).toMatchObject({ kind: 'sighting', attempt });
      expect(result.passage.sightingCount).toBe(4);
      const [target, where, patch] = manager.update.mock.calls[0] as [
        unknown,
        object,
        { lastSeenAt: Date; sightingCount: () => string; direction?: string },
      ];
      expect(target).toBe(VehiclePassage);
      expect(where).toEqual({ id: 'passage-1' });
      expect(patch.lastSeenAt).toEqual(new Date(NOW));
      expect(patch.sightingCount()).toBe('"sightingCount" + 1');
      expect(patch.direction).toBeUndefined();
      expect(result.detection.passageId).toBe('passage-1');
    });

    it('una fuente de mayor prioridad mejora la dirección y el método del intento si lo sigue', async () => {
      manager.find.mockResolvedValue([
        passage({
          direction: 'entry',
          directionSource: 'width',
          methodFollowsDirection: true,
        }),
      ]);

      const result = await claim(reading('exit', 'line'));

      expect(result.passage).toMatchObject({
        direction: 'exit',
        directionSource: 'line',
      });
      expect(manager.update).toHaveBeenCalledWith(
        AccessAttempt,
        { passageId: 'passage-1' },
        { method: 'Patente - Salida' },
      );
    });

    it('no toca el método del intento si este NO sigue la dirección (visita, pendiente)', async () => {
      manager.find.mockResolvedValue([
        passage({
          direction: 'entry',
          directionSource: 'width',
          methodFollowsDirection: false,
        }),
      ]);

      await claim(reading('exit', 'line'));

      expect(manager.update).not.toHaveBeenCalledWith(
        AccessAttempt,
        expect.anything(),
        expect.anything(),
      );
    });

    it('una cámara de acceso sobre una pasada de acceso es evidencia (sin promoción)', async () => {
      manager.find.mockResolvedValue([passage({ decidesAccess: true })]);

      const result = await claim(reading('entry', 'line'), true);

      expect(result.kind).toBe('sighting');
      expect(manager.update).toHaveBeenCalledTimes(1);
    });

    it('una cámara de solo registro sobre una pasada de acceso es evidencia', async () => {
      manager.find.mockResolvedValue([passage({ decidesAccess: true })]);

      const result = await claim(reading('entry', 'line'), false);

      expect(result.kind).toBe('sighting');
    });

    it('una cámara de solo registro sobre otra de solo registro es evidencia (no promueve)', async () => {
      manager.find.mockResolvedValue([passage({ decidesAccess: false })]);

      const result = await claim(reading('entry', 'line'), false);

      expect(result.kind).toBe('sighting');
      expect(manager.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('claim: promoción', () => {
    beforeEach(() => {
      manager.find.mockResolvedValue([passage({ decidesAccess: false })]);
    });

    it('una cámara de acceso sobre una pasada de solo registro la PROMUEVE con un UPDATE condicional', async () => {
      const result = await claim(reading('entry', 'line'), true);

      expect(result).toMatchObject({ kind: 'leader', promoted: true });
      expect(result.passage.decidesAccess).toBe(true);
      expect(manager.update).toHaveBeenCalledWith(
        VehiclePassage,
        { id: 'passage-1', decidesAccess: false },
        expect.objectContaining({ decidesAccess: true }),
      );
      expect(result.detection.passageId).toBe('passage-1');
    });

    it('si el UPDATE condicional no afecta filas (otra petición promovió antes), es evidencia', async () => {
      manager.update.mockImplementation(
        (_target: unknown, where: { decidesAccess?: boolean }) =>
          Promise.resolve({ affected: where.decidesAccess === false ? 0 : 1 }),
      );

      const result = await claim(reading('entry', 'line'), true);

      expect(result.kind).toBe('sighting');
    });
  });

  describe('claim: pasada huérfana', () => {
    it('sin intento y con el líder tomado hace más de 30 s, la lectura toma el liderazgo', async () => {
      manager.find.mockResolvedValue([
        passage({ leaderClaimedAt: new Date(NOW - 31_000) }),
      ]);
      manager.exists.mockResolvedValue(false);

      const result = await claim(reading('entry', 'line'), true);

      expect(result).toMatchObject({ kind: 'leader', promoted: false });
      expect(result.passage.leaderClaimedAt).toEqual(new Date(NOW));
      expect(manager.update).toHaveBeenCalledWith(
        VehiclePassage,
        { id: 'passage-1' },
        {
          leaderClaimedAt: new Date(NOW),
          decidesAccess: true,
          leaderToken: result.passage.leaderToken,
        },
      );
    });

    it('con intento existente NO es huérfana', async () => {
      manager.find.mockResolvedValue([
        passage({ leaderClaimedAt: new Date(NOW - 31_000) }),
      ]);
      manager.exists.mockResolvedValue(true);

      const result = await claim(reading('entry', 'line'), true);

      expect(result.kind).toBe('sighting');
    });

    it('con el líder reciente ni siquiera consulta si hay intento', async () => {
      manager.find.mockResolvedValue([
        passage({ leaderClaimedAt: new Date(NOW - 10_000) }),
      ]);

      const result = await claim(reading('entry', 'line'), true);

      expect(result.kind).toBe('sighting');
      expect(manager.exists).not.toHaveBeenCalled();
    });

    it('una cámara de solo registro que toma una pasada huérfana la deja sin decidir el acceso', async () => {
      manager.find.mockResolvedValue([
        passage({ leaderClaimedAt: new Date(NOW - 31_000) }),
      ]);
      manager.exists.mockResolvedValue(false);

      const result = await claim(reading('entry', 'line'), false);

      expect(result.passage.decidesAccess).toBe(false);
      expect(manager.update).toHaveBeenCalledWith(
        VehiclePassage,
        { id: 'passage-1' },
        expect.objectContaining({ decidesAccess: false }),
      );
    });
  });

  describe('claim: token de liderazgo', () => {
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    it('una pasada nueva recibe un token uuid', async () => {
      const result = await claim(reading('entry', 'line'));

      expect(result.passage.leaderToken).toMatch(UUID);
      expect(manager.create).toHaveBeenCalledWith(
        VehiclePassage,
        expect.objectContaining({ leaderToken: result.passage.leaderToken }),
      );
    });

    it('la promoción y la huérfana renuevan el token (el líder anterior lo pierde)', async () => {
      manager.find.mockResolvedValue([passage({ decidesAccess: false })]);
      const promoted = await claim(reading('entry', 'line'), true);
      expect(promoted.passage.leaderToken).toMatch(UUID);
      expect(promoted.passage.leaderToken).not.toBe('token-actual');
      expect(manager.update).toHaveBeenCalledWith(
        VehiclePassage,
        { id: 'passage-1', decidesAccess: false },
        expect.objectContaining({ leaderToken: promoted.passage.leaderToken }),
      );

      manager.update.mockClear();
      manager.find.mockResolvedValue([
        passage({ leaderClaimedAt: new Date(NOW - 31_000) }),
      ]);
      manager.exists.mockResolvedValue(false);
      const orphan = await claim(reading('entry', 'line'), true);
      expect(orphan.passage.leaderToken).not.toBe('token-actual');
      expect(manager.update).toHaveBeenCalledWith(
        VehiclePassage,
        { id: 'passage-1' },
        expect.objectContaining({ leaderToken: orphan.passage.leaderToken }),
      );
    });

    it('una lectura que solo es evidencia no cambia el token', async () => {
      manager.find.mockResolvedValue([passage()]);

      const result = await claim(reading('entry', 'line'));

      expect(result.kind).toBe('sighting');
      expect(result.passage.leaderToken).toBe('token-actual');
    });
  });

  describe('saveAttempt (solo el líder vigente; upsert solo como promoción)', () => {
    const options = {
      decidesAccess: true,
      followsDirection: true,
      unknownMethod: 'Patente - Entrada',
    };

    function attempt(overrides: Partial<AccessAttempt> = {}): AccessAttempt {
      return Object.assign(new AccessAttempt(), {
        decision: 'Permitido',
        reason: 'Residente',
        method: 'Patente - Entrada',
        residente: null,
        responseTimeMs: 120,
        expiresAt: null,
        ...overrides,
      });
    }

    /** La pasada en la BD y el intento que ya tiene (si tiene). */
    function givenDb(
      current: VehiclePassage | null,
      existing: AccessAttempt | null,
    ): void {
      manager.findOne.mockImplementation((target: unknown) =>
        Promise.resolve(target === VehiclePassage ? current : existing),
      );
    }

    function existingAttempt(decision: string): AccessAttempt {
      return Object.assign(attempt({ decision }), { id: 'att-previo' });
    }

    beforeEach(() => {
      givenDb(
        passage({ direction: 'exit', methodFollowsDirection: false }),
        null,
      );
    });

    it('sin intento previo y con el token vigente lo inserta, con el método de la dirección VIGENTE', async () => {
      const toSave = attempt();

      const result = await service.saveAttempt(toSave, passage(), options);

      expect(result.written).toBe(true);
      expect(result.attempt?.passageId).toBe('passage-1');
      expect(result.attempt?.method).toBe('Patente - Salida');
      expect(manager.save).toHaveBeenCalledWith(AccessAttempt, toSave);
      expect(manager.update).toHaveBeenCalledWith(
        VehiclePassage,
        { id: 'passage-1' },
        { methodFollowsDirection: true },
      );
    });

    it('toma el lock de la pasada antes de guardar', async () => {
      await service.saveAttempt(attempt(), passage(), options);

      const [firstQuery] = manager.query.mock.calls[0] as [string];
      expect(firstQuery).toContain('pg_advisory_xact_lock');
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        manager.save.mock.invocationCallOrder[0],
      );
    });

    it('un líder que PERDIÓ la pasada (token distinto) no escribe y devuelve el intento vigente', async () => {
      const vigente = existingAttempt('Permitido');
      givenDb(passage({ leaderToken: 'token-del-nuevo-lider' }), vigente);

      const result = await service.saveAttempt(
        attempt(),
        passage({ leaderToken: 'token-del-lider-lento' }),
        options,
      );

      expect(result).toEqual({ written: false, attempt: vigente });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('un líder que perdió la pasada y aún no hay intento devuelve attempt null sin escribir', async () => {
      givenDb(passage({ leaderToken: 'token-del-nuevo-lider' }), null);

      const result = await service.saveAttempt(
        attempt(),
        passage({ leaderToken: 'token-del-lider-lento' }),
        options,
      );

      expect(result).toEqual({ written: false, attempt: null });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('promoción: un intento Registrado con el token vigente se ACTUALIZA a la decisión de acceso', async () => {
      const registrado = existingAttempt('Registrado');
      registrado.reason = 'Solo registro';
      registrado.responseTimeMs = null;
      givenDb(passage({ direction: 'entry' }), registrado);

      const result = await service.saveAttempt(
        attempt({ decision: 'Pendiente', reason: 'Requiere aprobación' }),
        passage(),
        { ...options, followsDirection: false },
      );

      expect(result.written).toBe(true);
      expect(result.attempt).toBe(registrado);
      expect(registrado).toMatchObject({
        id: 'att-previo',
        decision: 'Pendiente',
        reason: 'Requiere aprobación',
        responseTimeMs: 120,
        respondedBy: null,
        respondedAt: null,
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it.each(['Permitido', 'Denegado', 'Pendiente', 'Duplicado'])(
      'un intento ya %s (decisión de acceso) NO se sobrescribe, aunque el llamador sea el líder vigente',
      async (decision) => {
        const previo = existingAttempt(decision);
        givenDb(passage(), previo);

        const result = await service.saveAttempt(
          attempt({ decision: 'Permitido' }),
          passage(),
          options,
        );

        expect(result).toEqual({ written: false, attempt: previo });
        expect(previo.decision).toBe(decision);
        expect(manager.save).not.toHaveBeenCalled();
      },
    );

    it('un intento de solo registro nunca pisa uno existente', async () => {
      const previo = existingAttempt('Registrado');
      givenDb(passage(), previo);

      const result = await service.saveAttempt(
        attempt({ decision: 'Registrado' }),
        passage(),
        { ...options, decidesAccess: false },
      );

      expect(result).toEqual({ written: false, attempt: previo });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('falla si la pasada ya no existe', async () => {
      givenDb(null, null);

      await expect(
        service.saveAttempt(attempt(), passage(), options),
      ).rejects.toThrow(/ya no existe/);
    });
  });

  describe('release / demote (compensaciones)', () => {
    it('release borra la pasada SOLO si no tiene intento, bajo el lock', async () => {
      await service.release(passage());

      const [lock, remove] = manager.query.mock.calls as Array<
        [string, unknown[]]
      >;
      expect(lock[0]).toContain('pg_advisory_xact_lock');
      expect(remove[0]).toContain('DELETE FROM "vehicle_passages"');
      expect(remove[0]).toContain('NOT EXISTS');
      expect(remove[0]).toContain('"leaderToken" = $2');
      expect(remove[1]).toEqual(['passage-1', 'token-actual']);
    });

    it('release nunca lanza, aunque la BD falle', async () => {
      dataSource.transaction.mockRejectedValue(new Error('BD caída'));

      await expect(service.release(passage())).resolves.toBeUndefined();
    });

    it('demote vuelve la pasada a solo registro (condicional)', async () => {
      await service.demote(passage({ decidesAccess: true }));

      expect(manager.update).toHaveBeenCalledWith(
        VehiclePassage,
        {
          id: 'passage-1',
          decidesAccess: true,
          leaderToken: 'token-actual',
        },
        { decidesAccess: false },
      );
    });

    it('demote nunca lanza, aunque la BD falle', async () => {
      dataSource.transaction.mockRejectedValue(new Error('BD caída'));

      await expect(service.demote(passage())).resolves.toBeUndefined();
    });
  });

  describe('attachPassages', () => {
    const attemptOf = (id: string, passageId: string | null): AccessAttempt =>
      Object.assign(new AccessAttempt(), { id, passageId });

    it('sin intentos con pasada no consulta nada y deja passage en null', async () => {
      const result = await service.attachPassages([attemptOf('a', null)]);

      expect(result).toEqual([
        expect.objectContaining({ id: 'a', passage: null }),
      ]);
      expect(passageRepo.find).not.toHaveBeenCalled();
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('arma la vista con las últimas N lecturas, sin recorte duplicado, y el sightingCount real', async () => {
      passageRepo.find.mockResolvedValue([passage({ sightingCount: 25 })]);
      dataSource.query.mockResolvedValue([
        {
          id: 'd1',
          passageId: 'passage-1',
          cameraId: 'cam-a',
          createdAt: new Date(NOW - 3_000),
          full_frame_path: 'https://cdn.example.invalid/f.jpg',
          direction: 'entry',
          source: 'line',
          snapshot: null,
        },
        {
          id: 'd2',
          passageId: 'passage-1',
          cameraId: 'cam-b',
          createdAt: new Date(NOW - 1_000),
          full_frame_path: null,
          direction: null,
          source: null,
          snapshot: 'data:image/jpeg;base64,AAAA',
        },
      ]);

      const [view, none] = await service.attachPassages([
        attemptOf('a', 'passage-1'),
        attemptOf('b', 'otra-que-no-existe'),
      ]);

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params).toEqual([
        ['passage-1', 'otra-que-no-existe'],
        MAX_SIGHTINGS_PER_PASSAGE,
      ]);
      expect(MAX_SIGHTINGS_PER_PASSAGE).toBe(10);
      expect(sql).toContain('row_number() OVER (PARTITION BY d."passageId"');
      expect(sql).toContain(`'^https://'`);
      expect(view.passage).toMatchObject({
        id: 'passage-1',
        sightingCount: 25,
      });
      expect(view.passage?.sightings).toEqual([
        {
          detectionId: 'd1',
          cameraId: 'cam-a',
          at: new Date(NOW - 3_000).toISOString(),
          direction: 'entry',
          directionSource: 'line',
          full_frame_path: 'https://cdn.example.invalid/f.jpg',
          snapshot_jpeg_b64: null,
        },
        {
          detectionId: 'd2',
          cameraId: 'cam-b',
          at: new Date(NOW - 1_000).toISOString(),
          direction: 'unknown',
          directionSource: 'none',
          full_frame_path: null,
          snapshot_jpeg_b64: 'data:image/jpeg;base64,AAAA',
        },
      ]);
      expect(none.passage).toBeNull();
    });
  });

  describe('summarize', () => {
    it('expone solo el resumen con fechas ISO', () => {
      expect(service.summarize(passage({ sightingCount: 4 }))).toEqual({
        id: 'passage-1',
        direction: 'entry',
        directionSource: 'line',
        firstSeenAt: new Date(NOW - 5_000).toISOString(),
        lastSeenAt: new Date(NOW - 2_000).toISOString(),
        sightingCount: 4,
      });
    });
  });

  describe('claim: variantes de OCR (LPR_PASSAGE_FUZZY_SECONDS)', () => {
    const VARIANT = 'ABCD1Z';
    let sameCamera: boolean;
    /** Lo que devuelve la relectura de la pasada elegida (null = ya no existe). */
    let fresh: VehiclePassage | null | 'candidate';

    beforeEach(() => {
      sameCamera = false;
      fresh = 'candidate';
      manager.exists.mockImplementation((entity: unknown) =>
        Promise.resolve(entity === PlateDetection ? sameCamera : true),
      );
    });

    /** Sin pasada exacta; las candidatas difusas salen de la 2.ª consulta. */
    function withCandidates(candidates: VehiclePassage[]): void {
      manager.find.mockResolvedValueOnce([]).mockResolvedValueOnce(candidates);
      manager.findOne.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === VehiclePassage
            ? fresh === 'candidate'
              ? (candidates[0] ?? null)
              : fresh
            : null,
        ),
      );
    }

    function variantRead(
      r: DirectionReading,
      decidesAccess: boolean,
    ): Promise<PassageClaim> {
      const read = detection();
      read.plate = VARIANT;
      return service.claim(read, r, { decidesAccess });
    }

    const lockCall = (key: string) => [
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [`vigilia.lpr.passage:${ORG}`, key],
    ];

    it('toma primero el lock del condominio (difuso) y después el de la patente', async () => {
      await claim(reading('entry', 'line'));

      expect(manager.query.mock.calls.slice(0, 2)).toEqual([
        lockCall('~fuzzy'),
        lockCall(PLATE),
      ]);
    });

    it('con candidata toma, en orden, condominio -> patente entrante -> patente destino', async () => {
      withCandidates([passage({ decidesAccess: false })]);

      await variantRead(reading('entry', 'line'), false);

      expect(manager.query.mock.calls.slice(0, 3)).toEqual([
        lockCall('~fuzzy'),
        lockCall(VARIANT),
        lockCall(PLATE),
      ]);
    });

    it('con la función desactivada no toma el lock difuso ni consulta candidatas', async () => {
      service = new VehiclePassagesService(
        dataSource as unknown as DataSource,
        {
          get: (key: string) =>
            key === 'LPR_PASSAGE_FUZZY_SECONDS' ? '0' : undefined,
        } as unknown as ConfigService,
      );

      const result = await claim(reading('entry', 'line'));

      expect(result.kind).toBe('leader');
      expect(manager.query).toHaveBeenCalledTimes(1);
      expect(manager.find).toHaveBeenCalledTimes(1);
    });

    it('acota la búsqueda: ventana de 30 s sobre lastSeenAt, mismo condominio y pocas filas', async () => {
      withCandidates([]);

      await variantRead(reading('exit', 'line'), false);

      const [, options] = manager.find.mock.calls[1] as [
        unknown,
        {
          where: {
            organizationId: string;
            lastSeenAt: FindOperator<Date>;
          };
          order: object;
          take: number;
        },
      ];
      expect(options.where.organizationId).toBe(ORG);
      expect(options.where.lastSeenAt.value).toEqual(new Date(NOW - 30_000));
      expect(options.order).toEqual({ lastSeenAt: 'DESC' });
      expect(options.take).toBe(20);
    });

    it('cámara de solo registro: suma la variante como evidencia, sin liderazgo ni intento', async () => {
      withCandidates([passage({ decidesAccess: false })]);

      const result = await variantRead(reading('entry', 'line'), false);

      expect(result.kind).toBe('sighting');
      expect(result.passage.id).toBe('passage-1');
      expect(result.detection.passageId).toBe('passage-1');
      expect(result.detection.meta).toEqual({
        plate_variant_of_passage: 'passage-1',
      });
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('B1: la variante solo cuenta y enlaza; no cambia dirección, fuente ni el method del intento', async () => {
      withCandidates([
        passage({
          direction: 'unknown',
          directionSource: 'none',
          methodFollowsDirection: true,
          decidesAccess: false,
        }),
      ]);

      const result = await variantRead(reading('entry', 'line'), false);

      expect(result.kind).toBe('sighting');
      expect(result.passage.direction).toBe('unknown');
      expect(result.passage.directionSource).toBe('none');
      expect(manager.update).toHaveBeenCalledTimes(1);
      const [target, , patch] = manager.update.mock.calls[0] as [
        unknown,
        unknown,
        Record<string, unknown>,
      ];
      expect(target).toBe(VehiclePassage);
      expect(Object.keys(patch).sort()).toEqual([
        'lastSeenAt',
        'sightingCount',
      ]);
    });

    it('CRÍTICO: una cámara de acceso nunca se suma como variante, ni con la pasada Permitido -> pasada y decisión propias', async () => {
      withCandidates([passage()]);

      const result = await variantRead(reading('entry', 'line'), true);

      expect(result).toMatchObject({ kind: 'leader', promoted: false });
      expect(manager.create).toHaveBeenCalled();
      // Ni siquiera busca candidatas.
      expect(manager.find).toHaveBeenCalledTimes(1);
    });

    it('CRÍTICO: la misma cámara que ya leyó la pasada no la agrupa (otro auto) -> pasada nueva', async () => {
      withCandidates([passage({ decidesAccess: false })]);
      sameCamera = true;

      const result = await variantRead(reading('entry', 'line'), false);

      expect(result.kind).toBe('leader');
      expect(manager.exists).toHaveBeenCalledWith(PlateDetection, {
        where: { passageId: 'passage-1', cameraId: 'cam-1' },
      });
    });

    it('una cámara distinta de las que ya leyeron la pasada sí la agrupa', async () => {
      withCandidates([passage({ decidesAccess: false })]);

      const result = await variantRead(reading('entry', 'line'), false);

      expect(result.kind).toBe('sighting');
    });

    it.each([
      ['largo distinto', 'ABCD1Z9'],
      ['dos sustituciones', 'ABCDZZ'],
      ['una inserción', 'ABCD12X'],
    ])('%s -> no es variante', async (_name, other) => {
      withCandidates([passage({ decidesAccess: false })]);
      const read = detection();
      read.plate = other;

      const result = await service.claim(read, reading('entry', 'line'), {
        decidesAccess: false,
      });

      expect(result.kind).toBe('leader');
    });

    it('direcciones opuestas conocidas -> no es variante; unknown es compatible', async () => {
      withCandidates([passage({ direction: 'exit', decidesAccess: false })]);
      const opposite = await variantRead(reading('entry', 'line'), false);
      expect(opposite.kind).toBe('leader');

      withCandidates([passage({ direction: 'exit', decidesAccess: false })]);
      const unknown = await variantRead(reading('unknown', 'none'), false);
      expect(unknown.kind).toBe('sighting');
    });

    it('dos candidatas con patentes distintas -> ambiguo, pasada nueva (aunque difieran en recencia)', async () => {
      withCandidates([
        passage({
          id: 'a',
          plate: 'ABCD1X',
          lastSeenAt: new Date(NOW - 1_000),
          decidesAccess: false,
        }),
        passage({
          id: 'b',
          plate: 'ABCD1Y',
          lastSeenAt: new Date(NOW - 9_000),
          decidesAccess: false,
        }),
      ]);

      const result = await variantRead(reading('entry', 'line'), false);

      expect(result.kind).toBe('leader');
    });

    it('dos pasadas de la MISMA patente candidata: no es ambiguo, gana la más reciente', async () => {
      withCandidates([
        passage({
          id: 'reciente',
          plate: 'ABCD1X',
          lastSeenAt: new Date(NOW - 1_000),
          decidesAccess: false,
        }),
        passage({
          id: 'vieja',
          plate: 'ABCD1X',
          lastSeenAt: new Date(NOW - 9_000),
          decidesAccess: false,
        }),
      ]);

      const result = await variantRead(reading('entry', 'line'), false);

      expect(result.passage.id).toBe('reciente');
    });

    it.each([
      ['la pasada ya no existe', null],
      [
        'la pasada se anonimizó mientras se esperaba el lock',
        passage({ anonymizedAt: new Date(NOW), decidesAccess: false }),
      ],
      [
        'la pasada venció mientras se esperaba el lock',
        passage({ lastSeenAt: new Date(NOW - 40_000), decidesAccess: false }),
      ],
      [
        'su dirección pasó a contradecir',
        passage({ direction: 'exit', decidesAccess: false }),
      ],
    ])('relectura bajo el lock: %s -> camino normal', async (_name, reread) => {
      withCandidates([passage({ decidesAccess: false })]);
      fresh = reread;

      const result = await variantRead(reading('entry', 'line'), false);

      expect(result.kind).toBe('leader');
    });

    it('una pasada exacta compatible tiene prioridad: no se busca variante', async () => {
      manager.find.mockResolvedValueOnce([passage()]);

      const result = await claim(reading('entry', 'line'));

      expect(result.kind).toBe('sighting');
      expect(manager.find).toHaveBeenCalledTimes(1);
      expect(result.detection.meta).toBeUndefined();
    });
  });
});
