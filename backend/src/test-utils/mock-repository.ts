import { ObjectLiteral, Repository } from 'typeorm';

/**
 * Métodos de `Repository<T>` que los specs suelen necesitar. Cada uno es un
 * `jest.fn()` sin implementación: el spec decide qué devuelve.
 */
const REPOSITORY_METHODS = [
  'create',
  'save',
  'find',
  'findOne',
  'findOneBy',
  'findBy',
  'findAndCount',
  'count',
  'update',
  'delete',
  'remove',
  'softDelete',
  'insert',
  'upsert',
  'exists',
  'createQueryBuilder',
] as const;

export type MockRepository<T extends ObjectLiteral> = Record<
  (typeof REPOSITORY_METHODS)[number],
  jest.Mock
> &
  Partial<Record<keyof Repository<T>, jest.Mock>>;

/**
 * Crea un doble de `Repository<T>` con los métodos más usados como
 * `jest.fn()`. Se pasa a `providers` con `getRepositoryToken(Entity)`; si hace
 * falta asignarlo a un tipo `Repository<T>`, castear vía `unknown`.
 */
export function createMockRepository<
  T extends ObjectLiteral,
>(): MockRepository<T> {
  const repository: Record<string, jest.Mock> = {};
  for (const method of REPOSITORY_METHODS) {
    repository[method] = jest.fn();
  }
  return repository as unknown as MockRepository<T>;
}

/**
 * Doble mínimo y tipado de los métodos de `Repository<T>` que los servicios
 * usan para persistir. Existe porque `jest.Mocked<Pick<Repository<T>, 'save'>>`
 * hereda las sobrecargas de `save`/`create` y `tsc` rechaza mocks simples.
 */
export interface PersistenceRepositoryMock<T extends ObjectLiteral> {
  create: jest.Mock<T, [Partial<T>]>;
  save: jest.Mock<Promise<T>, [Partial<T>]>;
  findOne: jest.Mock<Promise<T | null>, [unknown]>;
}
