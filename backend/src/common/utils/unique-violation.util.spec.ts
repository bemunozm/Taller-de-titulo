import { QueryFailedError } from 'typeorm';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  postgresErrorCode,
} from './unique-violation.util';

function queryFailed(code: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO "x"',
    [],
    Object.assign(new Error('pg'), { code }),
  );
}

/**
 * Fase 4 · P5.C: única definición del código SQLSTATE (antes `UsersService`,
 * `RolesService` y `PermissionsService` tenían su propio helper local).
 */
describe('unique-violation.util (P5.C)', () => {
  it('lee el código del QueryFailedError de TypeORM y del error del driver sin envolver', () => {
    expect(postgresErrorCode(queryFailed('23505'))).toBe('23505');
    expect(
      postgresErrorCode(Object.assign(new Error('pg'), { code: '23503' })),
    ).toBe('23503');
    expect(postgresErrorCode(new Error('sin código'))).toBeNull();
    expect(postgresErrorCode({ code: 23505 })).toBeNull();
    expect(postgresErrorCode(null)).toBeNull();
    expect(postgresErrorCode('23505')).toBeNull();
  });

  it('isUniqueViolation: 23505; isForeignKeyViolation: 23503', () => {
    expect(isUniqueViolation(queryFailed('23505'))).toBe(true);
    expect(isUniqueViolation(queryFailed('23503'))).toBe(false);
    expect(isForeignKeyViolation(queryFailed('23503'))).toBe(true);
    expect(isForeignKeyViolation(queryFailed('23505'))).toBe(false);
    expect(isUniqueViolation(new Error('connection lost'))).toBe(false);
  });
});
