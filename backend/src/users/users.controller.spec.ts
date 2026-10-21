import {
  type CallHandler,
  type ExecutionContext,
  type INestApplication,
  type NestInterceptor,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Observable } from 'rxjs';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import type { TenantActor } from '../common/tenant/tenant-actor';

const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const USER_ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

/** Lo que dejaría `AuthGuard`: el usuario con sus roles y permisos. */
const ADMIN_USER = {
  id: 'admin-a',
  roles: [
    {
      name: 'Administrador',
      permissions: [{ name: 'users.read' }, { name: 'condominium.view-all' }],
    },
  ],
};

/** Réplica de `TenantInterceptor` (global en la app). */
class FakeTenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<{ tenantContext?: TenantContext }>();
    req.tenantContext = { organizationId: ORG_A, isSuperAdmin: false };
    return next.handle();
  }
}

/**
 * Fase 4 · P5.A (D12): el controller arma el actor (`@CurrentActor()`) con el
 * usuario y el `tenantContext` de la request y llama a las variantes
 * `*ForActor`. `POST /users` ya no existe.
 */
describe('UsersController (HTTP)', () => {
  let app: INestApplication<App> | undefined;
  let usersService: {
    findAllForActor: jest.Mock;
    findOneForActor: jest.Mock;
    updateForActor: jest.Mock;
    removeForActor: jest.Mock;
    disableForActor: jest.Mock;
    enableForActor: jest.Mock;
    createAccountByAdmin: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      findAllForActor: jest.fn().mockResolvedValue([]),
      findOneForActor: jest.fn().mockResolvedValue({ id: USER_ID }),
      updateForActor: jest.fn().mockResolvedValue({ id: USER_ID }),
      removeForActor: jest.fn().mockResolvedValue({ affected: 1 }),
      disableForActor: jest.fn().mockResolvedValue({ affected: 1 }),
      enableForActor: jest.fn().mockResolvedValue({ affected: 1 }),
      createAccountByAdmin: jest.fn().mockResolvedValue({ id: USER_ID }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ user?: unknown }>().user =
            ADMIN_USER;
          return true;
        },
      })
      .overrideGuard(AuthorizationGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new FakeTenantInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  function server(): App {
    if (!app) {
      throw new Error('app no inicializada');
    }
    return app.getHttpServer();
  }

  it('POST /users se retiró -> 404', async () => {
    await request(server())
      .post('/api/v1/users')
      .send({ rut: '1-9', name: 'X', email: 'x@x.cl', password: 'x' })
      .expect(404);
  });

  it('GET /users pasa el actor (usuario + tenantContext) a findAllForActor', async () => {
    await request(server()).get('/api/v1/users').expect(200);

    const [[actor]] = usersService.findAllForActor.mock.calls as Array<
      [TenantActor]
    >;
    expect(actor).toEqual({
      userId: 'admin-a',
      organizationId: ORG_A,
      isSuperAdmin: false,
      permissionNames: new Set(['users.read', 'condominium.view-all']),
      familyId: null,
    });
  });

  it('PATCH, DELETE, disable y enable usan las variantes *ForActor', async () => {
    await request(server())
      .patch(`/api/v1/users/${USER_ID}`)
      .send({ name: 'Nuevo' })
      .expect(200);
    await request(server()).delete(`/api/v1/users/${USER_ID}`).expect(200);
    await request(server())
      .patch(`/api/v1/users/${USER_ID}/disable`)
      .expect(200);
    await request(server())
      .patch(`/api/v1/users/${USER_ID}/enable`)
      .expect(200);
    await request(server()).get(`/api/v1/users/${USER_ID}`).expect(200);

    const actor = expect.objectContaining({
      userId: 'admin-a',
      organizationId: ORG_A,
    }) as TenantActor;
    expect(usersService.updateForActor).toHaveBeenCalledWith(
      USER_ID,
      { name: 'Nuevo' },
      actor,
    );
    for (const method of [
      usersService.removeForActor,
      usersService.disableForActor,
      usersService.enableForActor,
      usersService.findOneForActor,
    ]) {
      expect(method).toHaveBeenCalledWith(USER_ID, actor);
    }
  });

  it('un :id que no es UUID -> 400 sin llegar al servicio', async () => {
    await request(server()).get('/api/v1/users/no-es-uuid').expect(400);
    expect(usersService.findOneForActor).not.toHaveBeenCalled();
  });

  it('create-by-admin acepta organizationId (UUID) y lo pasa con el actor; uno inválido -> 400', async () => {
    const body = {
      rut: '11222333-4',
      name: 'Pedro',
      email: 'pedro@correo.cl',
      organizationId: ORG_A,
    };
    await request(server())
      .post('/api/v1/users/create-by-admin')
      .send(body)
      .expect(201);
    expect(usersService.createAccountByAdmin).toHaveBeenCalledWith(
      body,
      expect.objectContaining({ userId: 'admin-a' }),
    );

    await request(server())
      .post('/api/v1/users/create-by-admin')
      .send({ ...body, organizationId: 'org-1' })
      .expect(400);
  });
});
