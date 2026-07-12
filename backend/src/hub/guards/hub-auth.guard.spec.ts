import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HubAuthGuard } from './hub-auth.guard';
import { Hub } from '../entities/hub.entity';
import { hashPassword } from '../../auth/utils/auth.util';

/**
 * Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — hallazgo H1):
 * antes `HubAuthGuard` validaba contra un `HUB_SECRET` global compartido —
 * cualquier hub con el secret correcto podía anunciar el `X-Hub-Id` de OTRO
 * condominio y suplantarlo. Ahora valida el secret contra el `secretHash`
 * PROPIO del hub identificado por `hubId`.
 */
describe('HubAuthGuard', () => {
  let guard: HubAuthGuard;
  let hubRepository: jest.Mocked<Repository<Hub>>;
  let secretHashA: string;

  function makeContext(headers: Record<string, string>): ExecutionContext {
    const request: any = { headers };
    return {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    } as unknown as ExecutionContext;
  }

  beforeAll(async () => {
    secretHashA = await hashPassword('secret-hub-A');
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HubAuthGuard,
        {
          provide: getRepositoryToken(Hub),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get(HubAuthGuard);
    hubRepository = module.get(getRepositoryToken(Hub));
  });

  const mockHub = (overrides: Partial<Hub> = {}): Hub =>
    ({
      id: 'irrelevant',
      hubId: 'hub-A',
      organizationId: '11111111-1111-4111-8111-111111111111',
      secretHash: secretHashA,
      active: true,
      ...overrides,
    }) as Hub;

  it('permite el acceso con el secret propio correcto', async () => {
    hubRepository.findOne.mockResolvedValue(mockHub());

    const ctx = makeContext({ 'x-hub-id': 'hub-A', 'x-hub-secret': 'secret-hub-A' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rechaza cuando el hubId anunciado no coincide con el dueño del secret (impersonación)', async () => {
    // hub-A existe, pero el secret pertenece a otro hub (hash distinto) —
    // simula el ataque central de H1: reclamar X-Hub-Id ajeno.
    hubRepository.findOne.mockResolvedValue(mockHub({ hubId: 'hub-A' }));

    const ctx = makeContext({ 'x-hub-id': 'hub-A', 'x-hub-secret': 'secret-de-otro-hub' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza un hubId desconocido', async () => {
    hubRepository.findOne.mockResolvedValue(null);

    const ctx = makeContext({ 'x-hub-id': 'hub-fantasma', 'x-hub-secret': 'lo-que-sea' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza si falta el header X-Hub-Secret', async () => {
    const ctx = makeContext({ 'x-hub-id': 'hub-A' });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Falta el header X-Hub-Secret');
  });

  it('rechaza si falta el header X-Hub-Id', async () => {
    const ctx = makeContext({ 'x-hub-secret': 'secret-hub-A' });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Falta el header X-Hub-Id');
  });

  it('rechaza un hub sin secretHash provisionado', async () => {
    hubRepository.findOne.mockResolvedValue(mockHub({ secretHash: null }));

    const ctx = makeContext({ 'x-hub-id': 'hub-A', 'x-hub-secret': 'secret-hub-A' });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Hub sin secret configurado');
  });

  it('puebla request.hub y request.tenantContext con el organizationId del hub autenticado', async () => {
    hubRepository.findOne.mockResolvedValue(mockHub());
    const request: any = { headers: { 'x-hub-id': 'hub-A', 'x-hub-secret': 'secret-hub-A' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    } as unknown as ExecutionContext;

    await guard.canActivate(ctx);

    expect(request.hub).toEqual({ hubId: 'hub-A', organizationId: '11111111-1111-4111-8111-111111111111' });
    expect(request.tenantContext).toEqual({
      organizationId: '11111111-1111-4111-8111-111111111111',
      isSuperAdmin: false,
    });
  });
});
