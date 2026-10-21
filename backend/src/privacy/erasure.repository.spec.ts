import { createErasureTransaction } from './erasure.repository';
import type { SubjectErasureRequest } from './erasure-request';
import { ANONYMIZED_MARKER, MASKED_PLATE } from './privacy-identifiers';
import {
  TERMINAL_SESSION_STATUSES,
  TERMINAL_VISIT_STATUSES,
} from './retention-sql';

const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const BY_RUT: SubjectErasureRequest = {
  kind: 'rut',
  key: '123456785',
  organizationId: ORG_A,
};
const BY_PLATE: SubjectErasureRequest = {
  kind: 'plate',
  key: 'BBCD12',
  organizationId: ORG_A,
};

/** Ejecutor que registra el SQL y devuelve las filas indicadas. */
function recorder(rows: unknown[] = [{ affected: 0 }]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const execute = jest.fn((sql: string, params: unknown[]) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return Promise.resolve(rows);
  });
  return { calls, tx: createErasureTransaction(execute), execute };
}

/**
 * Fase 4 · P7.R: SQL de la supresión. Todo acotado al condominio ($1), con el
 * identificador ya normalizado como parámetro (nunca interpolado) y un
 * `LIMIT` por consulta (corrección P7, cyber B7). La ejecución real se
 * verificó con la sonda contra Postgres.
 */
describe('ErasureRepository — SQL (Fase 4 · P7.R)', () => {
  it('visitas por RUT: condominio, sin anonimizar, RUT normalizado, terminales y con LIMIT', async () => {
    const { calls, tx } = recorder([{ id: 'v1' }, { id: 'v2' }]);

    await expect(tx.findVisits(BY_RUT, 'erasable', 501)).resolves.toEqual([
      { id: 'v1' },
      { id: 'v2' },
    ]);
    const [{ sql, params }] = calls;
    expect(sql).toContain('v."organizationId" = $1');
    expect(sql).toContain('v."anonymizedAt" IS NULL');
    expect(sql).toContain(
      `ltrim(regexp_replace(upper(coalesce(v."visitorRut", '')), '[^0-9A-Z]', '', 'g'), '0') = $2`,
    );
    expect(sql).toContain('v."status"::text = ANY($3::text[])');
    expect(sql).toContain('LIMIT $4');
    expect(params).toEqual([
      ORG_A,
      '123456785',
      [...TERMINAL_VISIT_STATUSES],
      501,
    ]);
    expect(sql).not.toContain('123456785');
  });

  it('visitas vigentes (kept): los mismos filtros con <> ALL', async () => {
    const { calls, tx } = recorder([]);

    await tx.findVisits(BY_RUT, 'kept', 500);

    expect(calls[0].sql).toContain('v."status"::text <> ALL($3::text[])');
  });

  it('visitas por patente: la solicitada o la del vehículo asociado', async () => {
    const { calls, tx } = recorder([]);

    await tx.findVisits(BY_PLATE, 'erasable', 10);

    const [{ sql, params }] = calls;
    expect(sql).toContain('LEFT JOIN "vehicles" ve ON ve."id" = v."vehicleId"');
    expect(sql).toContain(
      `regexp_replace(upper(coalesce(v."requestedPlate", '')), '[^0-9A-Z]', '', 'g') = $2`,
    );
    expect(sql).toContain(
      `regexp_replace(upper(coalesce(ve."plate", '')), '[^0-9A-Z]', '', 'g') = $2`,
    );
    expect(params[1]).toBe('BBCD12');
  });

  it('anonimizar visitas: solo terminales (se revalida) y sueltan el vehículo', async () => {
    const { calls, tx } = recorder([{ affected: 1 }]);

    await expect(tx.anonymizeVisits(['v1'])).resolves.toBe(1);
    const [{ sql, params }] = calls;
    expect(sql).toContain('t."status"::text = ANY($2::text[])');
    expect(sql).toContain('"visitorName" = $3');
    expect(sql).toContain('"vehicleId" = NULL');
    expect(params).toEqual([
      ['v1'],
      [...TERMINAL_VISIT_STATUSES],
      ANONYMIZED_MARKER,
    ]);
  });

  it('sesiones: por identificador o por la visita creada; solo terminales al anonimizar', async () => {
    const { calls, tx } = recorder([{ id: 's1', sessionId: 'sess-1' }]);

    await expect(
      tx.findSessions(BY_PLATE, ['v1'], 'erasable', 501),
    ).resolves.toEqual([{ id: 's1', sessionKey: 'sess-1' }]);
    expect(calls[0].sql).toContain('s."organizationId" = $1');
    expect(calls[0].sql).toContain('s."createdVisitId" = ANY($3::uuid[])');
    expect(calls[0].sql).toContain('s."status"::text = ANY($4::text[])');
    expect(calls[0].params).toEqual([
      ORG_A,
      'BBCD12',
      ['v1'],
      [...TERMINAL_SESSION_STATUSES],
      501,
    ]);

    const update = recorder([{ affected: 1 }]);
    await update.tx.anonymizeSessions(['s1']);
    expect(update.calls[0].sql).toContain('t."status"::text = ANY($2::text[])');
    expect(update.calls[0].params).toEqual([
      ['s1'],
      [...TERMINAL_SESSION_STATUSES],
    ]);
  });

  it('detecciones: solo por patente; erasable = sin intento pendiente, kept = con intento pendiente', async () => {
    const erasable = recorder([{ id: 'd1', fullFramePath: '/f.jpg' }]);
    await expect(
      erasable.tx.findDetections(BY_PLATE, 'erasable', 501),
    ).resolves.toEqual([{ id: 'd1', fullFramePath: '/f.jpg' }]);
    expect(erasable.calls[0].sql).toContain(
      `AND NOT (EXISTS (SELECT 1 FROM "access_attempts" a WHERE a."detectionId" = d."id" AND a."decision" = 'Pendiente')`,
    );
    // Las lecturas de otras cámaras de una pasada pendiente tampoco se suprimen.
    expect(erasable.calls[0].sql).toContain(
      `ap."passageId" = d."passageId" AND ap."decision" = 'Pendiente'`,
    );
    expect(erasable.calls[0].params).toEqual([ORG_A, 'BBCD12', 501]);

    const kept = recorder([]);
    await kept.tx.findDetections(BY_PLATE, 'kept', 500);
    expect(kept.calls[0].sql).toContain(
      `AND (EXISTS (SELECT 1 FROM "access_attempts" a`,
    );

    const byRut = recorder([]);
    await expect(
      byRut.tx.findDetections(BY_RUT, 'erasable', 500),
    ).resolves.toEqual([]);
    expect(byRut.execute).not.toHaveBeenCalled();
  });

  it('anonimizar detecciones: patente enmascarada, sin intentos pendientes, y sus intentos sin residente ni motivo', async () => {
    const { calls, tx } = recorder([{ detections: 2, accessAttempts: 3 }]);

    await expect(tx.anonymizeDetections(['d1', 'd2'], ['d1'])).resolves.toEqual(
      { detections: 2, accessAttempts: 3 },
    );
    const [{ sql, params }] = calls;
    expect(sql).toContain('"plate" = $3');
    expect(sql).toContain('"plate_raw" = NULL');
    expect(sql).toContain(`"meta" - 'snapshot_jpeg_b64'`);
    expect(sql).toContain('SET "reason" = NULL, "residente_id" = NULL');
    // La patente de la pasada (vehicle_passages) también se enmascara.
    expect(sql).toContain('UPDATE "vehicle_passages" p SET "plate" = $3');
    expect(sql).toContain('ap."passageId" = d."passageId"');
    // 0 = sin excepción de ventana: la supresión enmascara la pasada siempre.
    expect(params).toEqual([['d1', 'd2'], ['d1'], MASKED_PLATE, 0]);
    expect(sql).toContain('$4::int = 0 OR');
    // Una pasada dentro de su ventana deslizante no se enmascara.
    expect(sql).toContain(
      'p."lastSeenAt" < now() - make_interval(secs => $4::int)',
    );
  });

  it('pasadas: enmascara las de esa patente en el condominio, sin ventana, salvo las pendientes', async () => {
    const { calls, tx } = recorder([{ affected: 2 }]);

    await expect(tx.anonymizePassages(BY_PLATE)).resolves.toBe(2);

    const [{ sql, params }] = calls;
    expect(sql).toContain('UPDATE "vehicle_passages" p SET "plate" = $3');
    expect(sql).toContain('p."organizationId" = $1');
    expect(sql).toContain('= $2');
    expect(sql).not.toContain('lastSeenAt');
    expect(sql).toContain(`a."decision" = 'Pendiente'`);
    expect(params).toEqual([ORG_A, 'BBCD12', MASKED_PLATE]);
  });

  it('pasadas: una solicitud por RUT no toca nada', async () => {
    const { calls, tx } = recorder([]);

    await expect(tx.anonymizePassages(BY_RUT)).resolves.toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('vehículos de visita: huérfanos (borrables) o en uso (omitidos), por patente y condominio', async () => {
    const orphan = recorder([{ id: 'veh1' }]);
    await expect(
      orphan.tx.findVisitorVehicles(BY_PLATE, 'erasable', 501),
    ).resolves.toEqual([{ id: 'veh1' }]);
    expect(orphan.calls[0].sql).toContain('ve."organizationId" = $1');
    expect(orphan.calls[0].sql).toContain(
      `regexp_replace(upper(coalesce(ve."plate", '')), '[^0-9A-Z]', '', 'g') = $2`,
    );
    expect(orphan.calls[0].sql).toContain(
      'NOT EXISTS (SELECT 1 FROM "visits" vv WHERE vv."vehicleId" = ve."id")',
    );
    expect(orphan.calls[0].params).toEqual([ORG_A, 'BBCD12', 'visitante', 501]);

    const inUse = recorder([]);
    await inUse.tx.findVisitorVehicles(BY_PLATE, 'kept', 500);
    expect(inUse.calls[0].sql).toContain(
      'AND EXISTS (SELECT 1 FROM "visits" vv WHERE vv."vehicleId" = ve."id")',
    );

    const byRut = recorder([]);
    await expect(
      byRut.tx.findVisitorVehicles(BY_RUT, 'erasable', 500),
    ).resolves.toEqual([]);
    expect(byRut.execute).not.toHaveBeenCalled();
  });

  it('borrar vehículos de visita: revalida que sigan huérfanos (sin dueño ni visitas)', async () => {
    const { calls, tx } = recorder([{ affected: 1 }]);

    await expect(tx.deleteVisitorVehicles(['veh1'])).resolves.toBe(1);
    expect(calls[0].sql).toContain('DELETE FROM "vehicles" ve');
    expect(calls[0].sql).toContain(`ve."accessLevel" = 'visitante'`);
    expect(calls[0].sql).toContain('ve."ownerId" IS NULL');
    expect(calls[0].sql).toContain(
      'NOT EXISTS (SELECT 1 FROM "visits" vv WHERE vv."vehicleId" = ve."id")',
    );
    expect(calls[0].params).toEqual([['veh1']]);
  });

  it('notificaciones: las de lo anonimizado o con el identificador, nunca las de un registro vigente; con LIMIT', async () => {
    const { calls, tx } = recorder([{ affected: 4 }]);

    await expect(
      tx.deleteNotifications(
        BY_RUT,
        { visitIds: ['v1'], sessionKeys: ['s1', 'sess-1'], detectionIds: [] },
        { visitIds: ['v2'], sessionKeys: ['s2', 'sess-2'], detectionIds: [] },
        500,
      ),
    ).resolves.toBe(4);
    const [{ sql, params }] = calls;
    expect(sql).toContain('n."organizationId" = $1');
    expect(sql).toContain(
      `ltrim(regexp_replace(upper(coalesce(n."data" -> 'visitor' ->> 'rut', '')), '[^0-9A-Z]', '', 'g'), '0') = $5`,
    );
    expect(sql).toContain(
      `AND NOT ( coalesce(n."data" ->> 'visitId', '') = ANY($6::text[])`,
    );
    expect(sql).toContain('LIMIT $9');
    expect(params).toEqual([
      ORG_A,
      ['v1'],
      ['s1', 'sess-1'],
      [],
      '123456785',
      ['v2'],
      ['s2', 'sess-2'],
      [],
      500,
    ]);
  });

  it('acciones del agente: todas las de las sesiones anonimizadas, del condominio; con LIMIT', async () => {
    const { calls, tx } = recorder([{ affected: 1 }]);

    await tx.deletePendingActions(ORG_A, ['s1', 'sess-1'], 500);
    const [{ sql, params }] = calls;
    expect(sql).toContain('p."tenantId" = $1');
    expect(sql).not.toContain('"status"');
    expect(params).toEqual([ORG_A, ['s1', 'sess-1'], 500]);
  });

  it('listas vacías no tocan la BD', async () => {
    const { execute, tx } = recorder();

    await expect(tx.anonymizeVisits([])).resolves.toBe(0);
    await expect(tx.anonymizeSessions([])).resolves.toBe(0);
    await expect(tx.anonymizeDetections([], [])).resolves.toEqual({
      detections: 0,
      accessAttempts: 0,
    });
    await expect(tx.deleteVisitorVehicles([])).resolves.toBe(0);
    await expect(tx.deletePendingActions(ORG_A, [], 500)).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
