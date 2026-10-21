import { Test, TestingModule } from '@nestjs/testing';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ParseUUIDPipe } from '@nestjs/common';
import { classMetadata, handlerMetadata } from '../test-utils/handler-metadata';
import { UpdateGuardianZonesDto } from './dto/update-guardian-zones.dto';

const CAMERA_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('CamerasController', () => {
  let controller: CamerasController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CamerasController],
      providers: [{ provide: CamerasService, useValue: {} }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AuthorizationGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CamerasController>(CamerasController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  /**
   * Fase 4 · P5.B: la URL de origen es una credencial (RTSP con usuario y
   * contraseña): exige `cameras.update`, no `cameras.read` (que tiene, por
   * ejemplo, el rol Seguridad).
   */
  it('GET /cameras/:id/source exige cameras.update', () => {
    expect(
      handlerMetadata(CamerasController, 'getSource', PERMISSIONS_KEY),
    ).toEqual(['cameras.update']);
  });

  it('GET /cameras/:id/has-source sigue con cameras.read (no expone la URL)', () => {
    expect(
      handlerMetadata(CamerasController, 'hasSource', PERMISSIONS_KEY),
    ).toEqual(['cameras.read']);
  });

  it.each(['findOne', 'update', 'remove'] as const)(
    'P5.C: %s valida el id con ParseUUIDPipe (un id no UUID -> 400, antes 500)',
    (method) => {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        CamerasController,
        method,
      ) as Record<string, { data?: string; pipes?: unknown[] }>;
      const idArg = Object.values(args).find((arg) => arg.data === 'id');
      expect(idArg?.pipes).toEqual([ParseUUIDPipe]);
    },
  );

  /**
   * Fase 4 · P9 (QA MEDIO): `PATCH /cameras/:id/zones` valida el body con
   * `UpdateGuardianZonesDto` (antes `zones: any[]`) y el id con ParseUUIDPipe.
   */
  describe('PATCH /cameras/:id/zones', () => {
    function routeArgs(): Array<{
      index: number;
      data?: string;
      pipes?: unknown[];
    }> {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        CamerasController,
        'updateZones',
      ) as Record<string, { index: number; data?: string; pipes?: unknown[] }>;
      return Object.values(args);
    }

    it('valida el id con ParseUUIDPipe', () => {
      const idArg = routeArgs().find((arg) => arg.data === 'id');
      expect(idArg?.pipes).toEqual([ParseUUIDPipe]);
    });

    it('recibe el body completo tipado con UpdateGuardianZonesDto (lo valida la ValidationPipe global)', () => {
      const bodyArg = routeArgs().find(
        (arg) => arg.data === undefined && arg.index === 1,
      );
      expect(bodyArg).toBeDefined();
      const paramTypes = Reflect.getMetadata(
        'design:paramtypes',
        CamerasController.prototype,
        'updateZones',
      ) as unknown[];
      expect(paramTypes[1]).toBe(UpdateGuardianZonesDto);
    });

    it('exige cameras.update', () => {
      expect(
        handlerMetadata(CamerasController, 'updateZones', PERMISSIONS_KEY),
      ).toEqual(['cameras.update']);
    });

    it('pasa las zonas validadas al servicio', async () => {
      const updateGuardianZones = jest
        .fn()
        .mockResolvedValue({ id: 'c', name: 'n', guardianZones: [] });
      const zonesController = new CamerasController({
        updateGuardianZones,
      } as unknown as CamerasService);
      const dto = Object.assign(new UpdateGuardianZonesDto(), {
        zones: [
          [
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.1 },
            { x: 0.5, y: 0.9 },
          ],
        ],
      });

      await zonesController.updateZones(CAMERA_ID, dto);

      expect(updateGuardianZones).toHaveBeenCalledWith(CAMERA_ID, dto.zones);
    });
  });

  it('el controller corre AuthorizationGuard (los permisos se evalúan)', () => {
    expect(classMetadata(CamerasController, GUARDS_METADATA)).toEqual([
      AuthGuard,
      AuthorizationGuard,
    ]);
  });
});
