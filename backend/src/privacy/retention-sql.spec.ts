import { PendingActionStatus } from '../agent/entities/pending-action.entity';
import { SessionStatus } from '../digital-concierge/entities/concierge-session.entity';
import { VisitStatus } from '../visits/entities/visit.entity';
import { ANONYMIZED_MARKER } from './privacy-identifiers';
import {
  batchStatement,
  countStatement,
  DELETABLE_PENDING_ACTION_STATUSES,
  VISIT_CLOSED_AT_SQL,
  RATE_LIMIT_MAX_AGE_MS,
  SET_BASED_SWEEPS,
  type SetBasedCategory,
  type SetBasedSweep,
  TERMINAL_SESSION_STATUSES,
  TERMINAL_VISIT_STATUSES,
} from './retention-sql';

function sweep(category: SetBasedCategory): SetBasedSweep {
  const found = SET_BASED_SWEEPS.find((entry) => entry.category === category);
  if (!found) {
    throw new Error(category);
  }
  return found;
}

/**
 * Fase 4 · P7.R: el SQL de las categorías set-based de la retención. La
 * ejecución real contra Postgres se verificó con la sonda de la P7.R; acá se
 * fijan las reglas que no se pueden romper (estados, plazos, lotes).
 */
describe('retention-sql (Fase 4 · P7.R)', () => {
  it('cada categoría tiene su plazo de la tabla del §3 (o vencimiento propio)', () => {
    expect(
      Object.fromEntries(SET_BASED_SWEEPS.map((s) => [s.category, s.period])),
    ).toEqual({
      anomalyImages: 'RETENTION_IMAGES_DAYS',
      visits: 'RETENTION_VISITS_DAYS',
      conciergeSessions: 'RETENTION_VISITS_DAYS',
      visitorVehicles: 'RETENTION_VISITS_DAYS',
      anomalies: 'RETENTION_ANOMALIES_DAYS',
      notifications: 'RETENTION_NOTIFICATIONS_DAYS',
      pendingActions: 'RETENTION_PENDING_ACTIONS_DAYS',
      auditLogs: 'RETENTION_AUDIT_DAYS',
      systemLogs: 'RETENTION_SYSTEM_LOGS_DAYS',
      authSessions: null,
      authVerifications: null,
      authRateLimits: null,
    });
  });

  it('acciones: imágenes se purgan, visitas y sesiones se anonimizan, el resto se borra', () => {
    expect(
      Object.fromEntries(SET_BASED_SWEEPS.map((s) => [s.category, s.action])),
    ).toEqual({
      anomalyImages: 'purge-images',
      visits: 'anonymize',
      conciergeSessions: 'anonymize',
      visitorVehicles: 'delete',
      anomalies: 'delete',
      notifications: 'delete',
      pendingActions: 'delete',
      auditLogs: 'delete',
      systemLogs: 'delete',
      authSessions: 'delete',
      authVerifications: 'delete',
      authRateLimits: 'delete',
    });
  });

  it('RETENTION_ENABLED solo gobierna los datos personales: la limpieza técnica es system_logs y better-auth', () => {
    expect(
      SET_BASED_SWEEPS.filter((s) => s.kind === 'technical').map(
        (s) => s.category,
      ),
    ).toEqual([
      'systemLogs',
      'authSessions',
      'authVerifications',
      'authRateLimits',
    ]);
    expect(
      SET_BASED_SWEEPS.filter((s) => s.kind === 'personal').map(
        (s) => s.category,
      ),
    ).toEqual([
      'anomalyImages',
      'visits',
      'conciergeSessions',
      'visitorVehicles',
      'anomalies',
      'notifications',
      'pendingActions',
      'auditLogs',
    ]);
  });

  describe('visitas: solo terminales, nunca las vigentes', () => {
    it('los estados terminales son exactamente COMPLETED/CANCELLED/EXPIRED/DENIED', () => {
      expect([...TERMINAL_VISIT_STATUSES].sort()).toEqual(
        [
          VisitStatus.CANCELLED,
          VisitStatus.COMPLETED,
          VisitStatus.DENIED,
          VisitStatus.EXPIRED,
        ].sort(),
      );
      for (const vigente of [
        VisitStatus.AWAITING_APPROVAL,
        VisitStatus.PENDING,
        VisitStatus.ACTIVE,
        VisitStatus.READY_FOR_REENTRY,
      ]) {
        expect(TERMINAL_VISIT_STATUSES).not.toContain(vigente);
      }
    });

    it('cierre = COALESCE(exitTime, LEAST(validUntil, updatedAt)) (una cancelada cierra al cancelarse); excluye lo ya anonimizado', () => {
      expect(VISIT_CLOSED_AT_SQL).toBe(
        'COALESCE("exitTime", LEAST("validUntil", "updatedAt"))',
      );
      const { sql, params } = countStatement(sweep('visits'), 90);
      expect(sql).toContain('"anonymizedAt" IS NULL');
      expect(sql).toContain('"status"::text = ANY($2::text[])');
      expect(sql).toContain(
        'COALESCE("exitTime", LEAST("validUntil", "updatedAt")) < now() - make_interval(days => $1::int)',
      );
      expect(params).toEqual([90, [...TERMINAL_VISIT_STATUSES]]);
    });

    it('el lote anonimiza con el marcador y fija anonymizedAt', () => {
      const { sql, params } = batchStatement(sweep('visits'), 90, 500);
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toContain('LIMIT $3');
      expect(sql).toContain('"visitorName" = $4');
      for (const column of [
        '"visitorRut" = NULL',
        '"visitorPhone" = NULL',
        '"requestedPlate" = NULL',
        '"reason" = NULL',
        '"qrCode" = NULL',
        // La patente vive en `vehicles`: la visita suelta su vehículo.
        '"vehicleId" = NULL',
        '"anonymizedAt" = COALESCE(t."anonymizedAt", now())',
      ]) {
        expect(sql).toContain(column);
      }
      expect(params).toEqual([
        90,
        [...TERMINAL_VISIT_STATUSES],
        500,
        ANONYMIZED_MARKER,
      ]);
    });
  });

  describe('sesiones del conserje: nunca una ACTIVE', () => {
    it('terminales = COMPLETED/CANCELLED/TIMEOUT', () => {
      expect([...TERMINAL_SESSION_STATUSES].sort()).toEqual(
        [
          SessionStatus.CANCELLED,
          SessionStatus.COMPLETED,
          SessionStatus.TIMEOUT,
        ].sort(),
      );
      expect(TERMINAL_SESSION_STATUSES).not.toContain(SessionStatus.ACTIVE);
    });

    it('anonimiza datos, nombres de residentsNotified (conserva ids) y transcript/functionCalls', () => {
      const { sql, params } = batchStatement(
        sweep('conciergeSessions'),
        90,
        500,
      );
      expect(sql).toContain('"anonymizedAt" IS NULL');
      expect(sql).toContain('COALESCE("endTime", "updatedAt") < now()');
      for (const column of [
        '"visitorName" = NULL',
        '"visitorRut" = NULL',
        '"visitorPhone" = NULL',
        '"vehiclePlate" = NULL',
        '"visitReason" = NULL',
        `"transcript" = '[]'::jsonb`,
        `"functionCalls" = '[]'::jsonb`,
      ]) {
        expect(sql).toContain(column);
      }
      expect(sql).toContain(
        `jsonb_build_object('id', e.value -> 'id', 'name', NULL)`,
      );
      expect(params).toEqual([90, [...TERMINAL_SESSION_STATUSES], 500]);
    });
  });

  it('acciones pendientes: se borran TODAS al cumplir el plazo, también PENDING (no son ejecutables pasados 15 min)', () => {
    expect(DELETABLE_PENDING_ACTION_STATUSES).toContain(
      PendingActionStatus.PENDING,
    );
    expect([...DELETABLE_PENDING_ACTION_STATUSES].sort()).toEqual(
      Object.values(PendingActionStatus).sort(),
    );
    const { sql, params } = batchStatement(sweep('pendingActions'), 90, 500);
    expect(sql).toBe(
      `WITH candidates AS (SELECT "id" FROM "pending_actions" WHERE "createdAt" < now() - make_interval(days => $1::int) ORDER BY "createdAt" LIMIT $2 FOR UPDATE SKIP LOCKED), affected AS (DELETE FROM "pending_actions" t USING candidates c WHERE t."id" = c."id" RETURNING 1) SELECT count(*)::int AS "affected" FROM affected`,
    );
    expect(params).toEqual([90, 500]);
  });

  it('vehículos de visita: solo huérfanos (visitante, sin dueño, sin visitas) y viejos', () => {
    const { sql, params } = batchStatement(sweep('visitorVehicles'), 90, 500);
    expect(sql).toContain(
      'FROM "vehicles" WHERE "updatedAt" < now() - make_interval(days => $1::int)',
    );
    expect(sql).toContain(`"vehicles"."accessLevel" = 'visitante'`);
    expect(sql).toContain('"vehicles"."ownerId" IS NULL');
    expect(sql).toContain(
      'NOT EXISTS (SELECT 1 FROM "visits" vv WHERE vv."vehicleId" = "vehicles"."id")',
    );
    expect(sql).toContain('DELETE FROM "vehicles" t USING candidates');
    expect(params).toEqual([90, 500]);
  });

  it.each([
    ['anomalies', 'anomaly_events', '"timestamp"'],
    ['notifications', 'notifications', '"createdAt"'],
    ['auditLogs', 'audit_logs', '"createdAt"'],
    ['systemLogs', 'system_logs', '"created_at"'],
  ] as const)(
    '%s: borra de %s por %s con el plazo como parámetro',
    (category, table, column) => {
      const { sql, params } = batchStatement(sweep(category), 45, 500);
      expect(sql).toBe(
        `WITH candidates AS (SELECT "id" FROM "${table}" WHERE ${column} < now() - make_interval(days => $1::int) ORDER BY ${column} LIMIT $2 FOR UPDATE SKIP LOCKED), affected AS (DELETE FROM "${table}" t USING candidates c WHERE t."id" = c."id" RETURNING 1) SELECT count(*)::int AS "affected" FROM affected`,
      );
      expect(params).toEqual([45, 500]);
    },
  );

  it('imágenes de anomalías: vacía la foto, la fila sigue', () => {
    const { sql } = batchStatement(sweep('anomalyImages'), 30, 500);
    expect(sql).toContain(
      'UPDATE "anomaly_events" t SET "snapshotJpegB64" = NULL',
    );
    expect(sql).toContain('"snapshotJpegB64" IS NOT NULL');
  });

  it('better-auth: sesiones y verificaciones vencidas; rateLimit de más de 1 día (ms)', () => {
    expect(countStatement(sweep('authSessions'), 0).sql).toContain(
      'FROM "session" WHERE "expiresAt" < now()',
    );
    expect(countStatement(sweep('authVerifications'), 0).sql).toContain(
      'FROM "verification" WHERE "expiresAt" < now()',
    );
    const rateLimit = countStatement(sweep('authRateLimits'), 0);
    expect(rateLimit.sql).toContain(
      '"lastRequest" < (extract(epoch from now()) * 1000)::bigint - $1::bigint',
    );
    expect(rateLimit.params).toEqual([RATE_LIMIT_MAX_AGE_MS]);
    expect(RATE_LIMIT_MAX_AGE_MS).toBe(86_400_000);
  });

  it('un lote siempre devuelve "affected" (CTE) y nunca toma filas bloqueadas', () => {
    for (const entry of SET_BASED_SWEEPS) {
      const { sql } = batchStatement(entry, 10, 500);
      expect(sql).toMatch(/^WITH candidates AS \(SELECT "id" FROM /);
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toMatch(
        /SELECT count\(\*\)::int AS "affected" FROM affected$/,
      );
    }
  });
});
