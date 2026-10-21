import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  type ExecutionContext,
} from '@nestjs/common';
import { CameraViewGuard, type CameraViewRequest } from './camera-view.guard';
import type { CamerasService } from '../cameras.service';
import type { TenantContextService } from '../../common/tenant/tenant-context.service';
import type { TenantContext } from '../../common/tenant/tenant-context.types';
import type { Camera } from '../entities/camera.entity';
import type { Role } from '../../roles/entities/role.entity';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CAM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROLE_CONSERJE = 'role-conserje';

function httpContext(request: CameraViewRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * Fase 4 · P5.B: `CameraViewGuard` (POST /streams/whep) exige que la cámara
 * sea del condominio del actor, además de los roles. Antes comparaba solo ids
 * de rol (globales): un Conserje de A veía las cámaras de B que tuvieran el
 * rol "Conserje" asignado.
 */
describe('CameraViewGuard — condominio de la cámara (P5.B)', () => {
  let camera: Camera | null;
  let ctx: TenantContext;
  let getCameraByIdOrMount: jest.Mock;
  let guard: CameraViewGuard;

  function request(cameraMount: string = CAM_ID): CameraViewRequest {
    return {
      body: { cameraMount },
      user: { roles: [{ id: ROLE_CONSERJE }] },
    };
  }

  beforeEach(() => {
    camera = {
      id: CAM_ID,
      organizationId: ORG_B,
      mountPath: 'porton-b',
      active: true,
      registeredInMediamtx: true,
      roles: [{ id: ROLE_CONSERJE } as Role],
    } as Camera;
    ctx = { organizationId: ORG_A, isSuperAdmin: false };
    getCameraByIdOrMount = jest.fn(() => Promise.resolve(camera));
    guard = new CameraViewGuard(
      { getCameraByIdOrMount } as unknown as CamerasService,
      {
        getContext: () => Promise.resolve(ctx),
      } as unknown as TenantContextService,
    );
  });

  it('cámara de OTRO condominio con el rol asignado -> 404 (antes pasaba por el rol)', async () => {
    await expect(guard.canActivate(httpContext(request()))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('cámara de otro condominio inactiva -> 404, no 503 (no revela su estado)', async () => {
    if (camera) camera.active = false;

    await expect(guard.canActivate(httpContext(request()))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('cámara inexistente -> 404', async () => {
    camera = null;

    await expect(guard.canActivate(httpContext(request()))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('cámara del condominio del actor con su rol -> pasa y deja la cámara autorizada (mountPath de ESA cámara)', async () => {
    ctx = { organizationId: ORG_B, isSuperAdmin: false };
    const req = request(CAM_ID);

    await expect(guard.canActivate(httpContext(req))).resolves.toBe(true);
    expect(req.authorizedCamera).toEqual({ id: CAM_ID, mountPath: 'porton-b' });
  });

  it('mismo condominio sin el rol asignado -> 403', async () => {
    ctx = { organizationId: ORG_B, isSuperAdmin: false };
    if (camera) camera.roles = [{ id: 'otro-rol' } as Role];

    await expect(guard.canActivate(httpContext(request()))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('mismo condominio pero inactiva -> 503', async () => {
    ctx = { organizationId: ORG_B, isSuperAdmin: false };
    if (camera) camera.active = false;

    await expect(guard.canActivate(httpContext(request()))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('super-admin: cualquier condominio (sigue exigiendo el rol)', async () => {
    ctx = { organizationId: null, isSuperAdmin: true };

    await expect(guard.canActivate(httpContext(request()))).resolves.toBe(true);
  });

  it('P5.C: actor sin condominio + cámara sin condominio -> 404 (null === null ya no calza)', async () => {
    ctx = { organizationId: null, isSuperAdmin: false };
    if (camera) camera.organizationId = null;

    await expect(guard.canActivate(httpContext(request()))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('cámara sin mountPath: el path autorizado es su id', async () => {
    ctx = { organizationId: ORG_B, isSuperAdmin: false };
    if (camera) camera.mountPath = '';
    const req = request();

    await guard.canActivate(httpContext(req));

    expect(req.authorizedCamera).toEqual({ id: CAM_ID, mountPath: CAM_ID });
  });
});
