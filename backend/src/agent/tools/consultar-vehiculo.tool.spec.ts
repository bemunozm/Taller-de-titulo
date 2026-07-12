import { ConsultarVehiculoTool } from './consultar-vehiculo.tool';
import { VehiclesService } from '../../vehicles/vehicles.service';
import type { Vehicle } from '../../vehicles/entities/vehicle.entity';
import type { User } from '../../users/entities/user.entity';
import type { AuthorizedContext } from '../types/authorized-context.type';

/**
 * Fase 2, Bloque F2.1 — cobertura de `ConsultarVehiculoTool`
 * (docs/modulos/agente-cerebro.md §12). NO llama a la BD: `VehiclesService`
 * mockeado.
 *
 * Incluye la regresión cross-tenant que exige §6 del diseño: `findByPlate`
 * de `VehiclesService` es DELIBERADAMENTE no tenant-aware (lo usa el worker
 * LPR sin sesión de usuario), así que la tool debe re-validar
 * `vehicle.organizationId` contra `ctx.tenantId` ANTES de devolver
 * cualquier dato del vehículo encontrado.
 */
describe('ConsultarVehiculoTool', () => {
  let tool: ConsultarVehiculoTool;
  let vehiclesService: jest.Mocked<Pick<VehiclesService, 'findByPlate'>>;

  function makeCtx(
    overrides: Partial<AuthorizedContext> = {},
  ): AuthorizedContext {
    return {
      tenantId: 'condo-A',
      isSuperAdmin: false,
      userId: undefined,
      role: 'hub',
      scopes: ['digital-concierge.access'],
      requestId: 'req-1',
      ...overrides,
    };
  }

  function makeVehicle(
    organizationId: string | null,
    overrides: Partial<Vehicle> = {},
  ): Vehicle {
    return {
      id: 'vehicle-1',
      organizationId,
      plate: 'ABCD12',
      brand: 'Toyota',
      model: 'Yaris',
      color: 'Rojo',
      year: 2020,
      vehicleType: 'residente',
      accessLevel: 'permanente',
      active: true,
      owner: { id: 'user-1', name: 'Juan Pérez' } as unknown as User,
      ownerId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Vehicle;
  }

  beforeEach(() => {
    vehiclesService = { findByPlate: jest.fn() };
    tool = new ConsultarVehiculoTool(
      vehiclesService as unknown as VehiclesService,
    );
  });

  it('devuelve encontrado:false cuando no existe ningún vehículo con esa patente', async () => {
    vehiclesService.findByPlate.mockResolvedValue(null);

    const result = await tool.execute(makeCtx(), { patente: 'ZZZZ99' });

    expect(result.encontrado).toBe(false);
    expect(vehiclesService.findByPlate).toHaveBeenCalledWith('ZZZZ99');
  });

  it('devuelve los datos del vehículo cuando pertenece al condominio del ctx', async () => {
    vehiclesService.findByPlate.mockResolvedValue(makeVehicle('condo-A'));

    const result = await tool.execute(makeCtx(), { patente: 'ABCD12' });

    expect(result).toEqual({
      encontrado: true,
      patente: 'ABCD12',
      marca: 'Toyota',
      modelo: 'Yaris',
      color: 'Rojo',
      tipo: 'residente',
      nivelAcceso: 'permanente',
      activo: true,
      propietario: 'Juan Pérez',
    });
  });

  describe('regresión cross-tenant (§6 del diseño)', () => {
    it('NO revela un vehículo de otro condominio — responde "no encontrado", no "prohibido"', async () => {
      vehiclesService.findByPlate.mockResolvedValue(makeVehicle('condo-B'));

      const result = await tool.execute(makeCtx({ tenantId: 'condo-A' }), {
        patente: 'ABCD12',
      });

      expect(result.encontrado).toBe(false);
      expect(result).not.toHaveProperty('marca');
    });

    it('un super-admin SÍ puede consultar un vehículo de cualquier condominio (bypass intencional)', async () => {
      vehiclesService.findByPlate.mockResolvedValue(makeVehicle('condo-B'));

      const result = await tool.execute(
        makeCtx({ tenantId: 'condo-A', isSuperAdmin: true }),
        { patente: 'ABCD12' },
      );

      expect(result.encontrado).toBe(true);
    });
  });
});
