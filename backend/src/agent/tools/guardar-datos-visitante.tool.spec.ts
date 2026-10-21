import { BadRequestException } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import {
  GuardarDatosVisitanteTool,
  VISITOR_DATA_MAX_LENGTHS,
} from './guardar-datos-visitante.tool';
import { DigitalConciergeService } from '../../digital-concierge/services/digital-concierge.service';
import { ConciergeSession } from '../../digital-concierge/entities/concierge-session.entity';
import type { AuthorizedContext } from '../types/authorized-context.type';

/**
 * Cierre de brecha Fase 1 → Fase 2: la tool delega TAL CUAL a
 * `DigitalConciergeService.saveVisitorData` (ver su spec para la cobertura
 * de la validación de dominio en sí). Acá solo se verifica el "cableado":
 * exige `ctx.sessionId`, resuelve la sesión tenant-scoped, y devuelve el
 * resultado de `saveVisitorData` sin transformarlo — incluido el caso
 * `ok: false` que le indica a Sofía que debe pedir el dato de nuevo.
 */
describe('GuardarDatosVisitanteTool', () => {
  let tool: GuardarDatosVisitanteTool;
  let conciergeService: jest.Mocked<
    Pick<DigitalConciergeService, 'findSessionForTenant' | 'saveVisitorData'>
  >;

  function makeCtx(
    overrides: Partial<AuthorizedContext> = {},
  ): AuthorizedContext {
    return {
      tenantId: 'condo-A',
      isSuperAdmin: false,
      userId: undefined,
      role: 'hub',
      channel: 'physical-hub',
      scopes: ['digital-concierge.access'],
      requestId: 'req-1',
      sessionId: 'session-1',
      ...overrides,
    };
  }

  function makeSession(
    overrides: Partial<ConciergeSession> = {},
  ): ConciergeSession {
    return {
      id: 'session-row-1',
      sessionId: 'session-1',
      organizationId: 'condo-A',
      ...overrides,
    } as ConciergeSession;
  }

  beforeEach(() => {
    conciergeService = {
      findSessionForTenant: jest.fn(),
      saveVisitorData: jest.fn(),
    };

    tool = new GuardarDatosVisitanteTool(
      conciergeService as unknown as DigitalConciergeService,
    );
  });

  it('exige ctx.sessionId — lanza BadRequestException sin tocar el servicio', async () => {
    await expect(
      tool.execute(makeCtx({ sessionId: undefined }), { rut: '12345678-5' }),
    ).rejects.toThrow(BadRequestException);

    expect(conciergeService.findSessionForTenant).not.toHaveBeenCalled();
    expect(conciergeService.saveVisitorData).not.toHaveBeenCalled();
  });

  it('resuelve la sesión tenant-scoped y delega en saveVisitorData', async () => {
    const session = makeSession();
    conciergeService.findSessionForTenant.mockResolvedValue(session);
    conciergeService.saveVisitorData.mockResolvedValue({
      ok: true,
      message: 'Datos guardados correctamente',
      saved: {
        nombre: 'Juan',
        rut: null,
        telefono: null,
        patente: null,
        motivo: null,
        casa: null,
      },
    });

    const result = await tool.execute(makeCtx(), { nombre: 'Juan' });

    expect(conciergeService.findSessionForTenant).toHaveBeenCalledWith(
      'session-1',
      makeCtx(),
    );
    expect(conciergeService.saveVisitorData).toHaveBeenCalledWith(session, {
      nombre: 'Juan',
    });
    expect(result.ok).toBe(true);
  });

  it('propaga sin transformar un resultado ok:false (dato inválido) para que Sofía pida corrección', async () => {
    conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
    conciergeService.saveVisitorData.mockResolvedValue({
      ok: false,
      campo: 'rut',
      mensaje: 'El RUT "12345678-9" no tiene un dígito verificador válido.',
      message:
        'Uno de los datos entregados no es válido, no se guardó ese campo',
      saved: {
        nombre: null,
        rut: null,
        telefono: null,
        patente: null,
        motivo: null,
        casa: null,
      },
    });

    const result = await tool.execute(makeCtx(), { rut: '12345678-9' });

    expect(result.ok).toBe(false);
    expect(result.campo).toBe('rut');
    expect(result.mensaje).toContain('dígito verificador');
  });

  /**
   * Fase 4 · P6.M (corrección QA): topes acordes a las columnas de
   * `concierge_sessions`. Antes un nombre de 200 caracteres llegaba a la BD
   * (varchar(128)) y respondía 500.
   */
  describe('topes de la entrada', () => {
    /** Largo de una columna varchar de ConciergeSession según TypeORM. */
    function columnLength(property: keyof ConciergeSession): number {
      const column = getMetadataArgsStorage().columns.find(
        (c) => c.target === ConciergeSession && c.propertyName === property,
      );
      return Number(column?.options.length);
    }

    it.each(Object.entries(VISITOR_DATA_MAX_LENGTHS))(
      '%s: acepta el tope (%i) y rechaza uno más',
      (field, max) => {
        expect(
          tool.inputSchema.safeParse({ [field]: 'a'.repeat(max) }).success,
        ).toBe(true);
        expect(
          tool.inputSchema.safeParse({ [field]: 'a'.repeat(max + 1) }).success,
        ).toBe(false);
      },
    );

    it('los campos que se guardan tal cual caben en su columna', () => {
      expect(VISITOR_DATA_MAX_LENGTHS.nombre).toBe(columnLength('visitorName'));
      expect(VISITOR_DATA_MAX_LENGTHS.motivo).toBe(columnLength('visitReason'));
      expect(VISITOR_DATA_MAX_LENGTHS.casa).toBe(
        columnLength('destinationHouse'),
      );
      expect(VISITOR_DATA_MAX_LENGTHS.rut).toBe(columnLength('visitorRut'));
    });
  });
});
