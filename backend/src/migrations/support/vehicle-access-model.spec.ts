import {
  VEHICLE_ACCESS_DOWN_SQL,
  VEHICLE_ACCESS_UP_SQL,
  migrateVehicleAccess,
  type VehicleAccessColumns,
} from './vehicle-access-model';
import { VehicleAccessModel1791520000000 } from '../1791520000000-VehicleAccessModel';
import { vehicleAccessRuleFor } from '../../vehicles/vehicle-access';

/**
 * Fase 4 · P5.C — migración de datos "Vehículos, modelo corregido".
 * `migrateVehicleAccess` es el espejo exacto del SQL de `up`; la verificación
 * contra Postgres (correr `up` sobre filas sembradas y compararlas con esta
 * función) se hizo en una BD temporal (ver el reporte de la fase).
 */
describe('VehicleAccessModel — conversión de vehicleType/accessLevel (P5.C)', () => {
  const row = (
    vehicleType: string | null,
    accessLevel: string | null,
  ): VehicleAccessColumns => ({ vehicleType, accessLevel });

  it.each([
    // Modelo viejo: el "tipo" de acceso vivía en vehicleType.
    [row('residente', null), row(null, 'residente')],
    [row('visitante', null), row(null, 'visitante')],
    // accessLevel viejo.
    [row(null, 'permanente'), row(null, 'residente')],
    [row(null, 'temporal'), row(null, 'visitante')],
    // Lo que guardaba la UI: carrocería en vehicleType (antes nunca abría).
    [row('auto', 'permanente'), row('auto', 'residente')],
    [row('moto', null), row('moto', null)],
    // Contradictorio: gana "residente", como en el portón anterior.
    [row('visitante', 'permanente'), row(null, 'residente')],
    [row('residente', 'temporal'), row(null, 'residente')],
    // Fuera del enum -> null (la carrocería se normaliza).
    [row('Residente', 'Permanente'), row(null, null)],
    [row(' Camioneta ', 'otro-valor'), row('camioneta', null)],
    [row('bus', 'vip'), row(null, null)],
    // Ya en el modelo nuevo: se mantiene.
    [row('camion', 'servicio'), row('camion', 'servicio')],
    [row('otro', 'visitante'), row('otro', 'visitante')],
    [row(null, null), row(null, null)],
  ])('%j -> %j', (before, after) => {
    expect(migrateVehicleAccess(before)).toEqual(after);
  });

  it('es idempotente: aplicarla dos veces da lo mismo que una', () => {
    const samples = [
      row('residente', 'temporal'),
      row('auto', 'permanente'),
      row(' MOTO ', null),
      row(null, 'servicio'),
      row('bus', 'vip'),
    ];
    for (const sample of samples) {
      const once = migrateVehicleAccess(sample);
      expect(migrateVehicleAccess(once)).toEqual(once);
    }
  });

  it('conserva la decisión del portón anterior para los datos que antes abrían o exigían visita', () => {
    /** Regla del portón ANTES de P5.C (vehicleType o accessLevel). */
    function legacyRule(before: VehicleAccessColumns): string {
      if (
        before.vehicleType === 'residente' ||
        before.accessLevel === 'permanente'
      ) {
        return 'allow';
      }
      if (
        before.vehicleType === 'visitante' ||
        before.accessLevel === 'temporal'
      ) {
        return 'requires-visit';
      }
      return 'concierge';
    }
    const types = [null, 'residente', 'visitante', 'auto', 'Residente', 'x'];
    const levels = [
      null,
      'permanente',
      'temporal',
      'servicio',
      'Permanente',
      'y',
    ];
    for (const vehicleType of types) {
      for (const accessLevel of levels) {
        const before = row(vehicleType, accessLevel);
        const after = migrateVehicleAccess(before);
        expect([before, vehicleAccessRuleFor(after.accessLevel)]).toEqual([
          before,
          legacyRule(before),
        ]);
      }
    }
  });

  it('el SQL de up solo toca las filas que cambian y tiene las mismas ramas que la función', () => {
    expect(VEHICLE_ACCESS_UP_SQL).toContain('UPDATE "vehicles" AS v');
    expect(VEHICLE_ACCESS_UP_SQL).toContain(
      `"accessLevel" IN ('permanente', 'residente') THEN 'residente'`,
    );
    expect(VEHICLE_ACCESS_UP_SQL).toContain(
      `"accessLevel" IN ('temporal', 'visitante') THEN 'visitante'`,
    );
    expect(VEHICLE_ACCESS_UP_SQL).toContain(
      `WHEN "accessLevel" = 'servicio' THEN 'servicio'`,
    );
    expect(VEHICLE_ACCESS_UP_SQL).toContain(
      `lower(btrim("vehicleType")) IN ('auto', 'camioneta', 'moto', 'camion', 'otro')`,
    );
    expect(VEHICLE_ACCESS_UP_SQL).toContain('IS DISTINCT FROM');
  });

  it('la migración ejecuta el SQL de up y de down', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new VehicleAccessModel1791520000000();

    await migration.up({ query } as never);
    await migration.down({ query } as never);

    expect(query).toHaveBeenNthCalledWith(1, VEHICLE_ACCESS_UP_SQL);
    expect(query).toHaveBeenNthCalledWith(2, VEHICLE_ACCESS_DOWN_SQL);
    expect(migration.name).toBe('VehicleAccessModel1791520000000');
  });
});
