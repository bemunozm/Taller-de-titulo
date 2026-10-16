import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { LogsService } from './logs.service';
import type { SystemLog } from './entities/system-log.entity';

/**
 * Fase 4 · P5: los logs del sistema son de plataforma. Solo el super-admin
 * los lee (chequeo explícito, además del permiso `logs.read`).
 */
describe('LogsService — lectura solo super-admin (Fase 4 · P5)', () => {
  let createQueryBuilder: jest.Mock;
  let service: LogsService;

  beforeEach(() => {
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getCount: jest.fn().mockResolvedValue(0),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue({ avg: null }),
    };
    createQueryBuilder = jest.fn(() => queryBuilder);
    service = new LogsService({
      createQueryBuilder,
    } as unknown as Repository<SystemLog>);
  });

  it('getLogs y getStats -> 403 para quien no es super-admin, sin consultar', async () => {
    await expect(service.getLogs({}, { isSuperAdmin: false })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.getStats({ isSuperAdmin: false })).rejects.toThrow(
      ForbiddenException,
    );
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('el super-admin los lee', async () => {
    await expect(service.getLogs({}, { isSuperAdmin: true })).resolves.toEqual(
      expect.objectContaining({ total: 0 }),
    );
    expect(createQueryBuilder).toHaveBeenCalled();
  });
});
