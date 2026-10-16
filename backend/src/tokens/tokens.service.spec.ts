import { InternalServerErrorException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import { TokensService } from './tokens.service';
import { TokensModule } from './tokens.module';
import { Token } from './entities/token.entity';
import {
  createMockRepository,
  type MockRepository,
} from '../test-utils/mock-repository';

describe('TokensService', () => {
  let service: TokensService;
  let repository: MockRepository<Token>;

  beforeEach(async () => {
    repository = createMockRepository<Token>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        {
          provide: getRepositoryToken(Token),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<TokensService>(TokensService);
  });

  it('borra los tokens vencidos (expiresAt < ahora) y devuelve cuántos', async () => {
    const expired = [{ id: 't1' }, { id: 't2' }] as Token[];
    repository.find.mockResolvedValue(expired);
    repository.remove.mockResolvedValue(expired);

    await expect(service.cleanupExpiredTokens()).resolves.toBe(2);

    const [options] = repository.find.mock.calls[0] as [
      { where: { expiresAt: FindOperator<Date> } },
    ];
    expect(options.where.expiresAt.type).toBe('lessThan');
    expect(repository.remove).toHaveBeenCalledWith(expired);
  });

  it('sin tokens vencidos no borra nada', async () => {
    repository.find.mockResolvedValue([]);

    await expect(service.cleanupExpiredTokens()).resolves.toBe(0);
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('un error de la BD sale como 500 genérico', async () => {
    repository.find.mockRejectedValue(new Error('db down'));

    await expect(service.cleanupExpiredTokens()).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});

/**
 * Fase 4 · P9 (cyber INFO): `TokensController` exponía un CRUD de la tabla
 * `Token` sin alcance por condominio; la tabla ya no autentica nada. El
 * módulo queda sin rutas HTTP.
 */
describe('TokensModule', () => {
  it('no registra controllers (sin rutas /tokens)', () => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      TokensModule,
    );
    expect(controllers ?? []).toEqual([]);
  });

  it('sigue exportando TokensService (lo usa ExpirationService)', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, TokensModule)).toEqual([
      TokensService,
    ]);
  });
});
