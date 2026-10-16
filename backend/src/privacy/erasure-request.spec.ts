import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import {
  EXACTLY_ONE_CRITERION_MESSAGE,
  resolveErasureRequest,
} from './erasure-request';
import { plateKey, rutKey } from './privacy-identifiers';

const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const ORG_B = '1c6e7e46-3a7b-4a64-8e27-6c9a4f4d1b02';
const USER_ID = '2d7f8f57-4b8c-4b75-9f38-7dab5a5e2c03';

const ADMIN_A: TenantContext = { organizationId: ORG_A, isSuperAdmin: false };
const SUPER_ADMIN: TenantContext = { organizationId: null, isSuperAdmin: true };
const NO_ORG: TenantContext = { organizationId: null, isSuperAdmin: false };

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('no lanzó');
}

describe('Normalización de identificadores (Fase 4 · P7.R)', () => {
  it.each([
    ['12.345.678-5', '123456785'],
    ['12345678-5', '123456785'],
    ['  12345678 5 ', '123456785'],
    ['08.123.456-k', '8123456K'],
    ['8123456K', '8123456K'],
    ['p-1234567', 'P1234567'],
  ])('rutKey(%p) = %p', (raw, key) => {
    expect(rutKey(raw)).toBe(key);
  });

  it.each([
    ['bbcd12', 'BBCD12'],
    ['BB-CD 12', 'BBCD12'],
    ['ab.1234', 'AB1234'],
  ])('plateKey(%p) = %p', (raw, key) => {
    expect(plateKey(raw)).toBe(key);
  });
});

describe('resolveErasureRequest (Fase 4 · P7.R)', () => {
  it.each([
    [{}],
    [{ rut: '12.345.678-5', plate: 'BBCD12' }],
    [{ rut: '12.345.678-5', userId: USER_ID }],
    [{ plate: 'BBCD12', userId: USER_ID }],
    [{ rut: '   ', plate: '' }],
  ])('400 si no viene exactamente uno de rut/plate/userId: %p', (dto) => {
    const error = thrown(() => resolveErasureRequest(dto, ADMIN_A));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(EXACTLY_ONE_CRITERION_MESSAGE);
  });

  it('rut: normaliza y acota al condominio del actor', () => {
    expect(resolveErasureRequest({ rut: '12.345.678-5' }, ADMIN_A)).toEqual({
      kind: 'rut',
      key: '123456785',
      organizationId: ORG_A,
    });
  });

  it('plate: normaliza y acota al condominio del actor', () => {
    expect(resolveErasureRequest({ plate: 'bb-cd 12' }, ADMIN_A)).toEqual({
      kind: 'plate',
      key: 'BBCD12',
      organizationId: ORG_A,
    });
  });

  it('userId: sin condominio en el pedido (lo define el usuario)', () => {
    expect(resolveErasureRequest({ userId: USER_ID }, ADMIN_A)).toEqual({
      kind: 'userId',
      userId: USER_ID,
    });
    expect(() =>
      resolveErasureRequest(
        { userId: USER_ID, organizationId: ORG_A },
        SUPER_ADMIN,
      ),
    ).toThrow(BadRequestException);
  });

  describe('condominio', () => {
    it('el super-admin DEBE indicar organizationId con rut o plate', () => {
      expect(() =>
        resolveErasureRequest({ rut: '12.345.678-5' }, SUPER_ADMIN),
      ).toThrow(BadRequestException);
      expect(
        resolveErasureRequest(
          { plate: 'BBCD12', organizationId: ORG_B },
          SUPER_ADMIN,
        ),
      ).toEqual({ kind: 'plate', key: 'BBCD12', organizationId: ORG_B });
    });

    it('quien no es super-admin no puede indicar otro condominio (403)', () => {
      expect(() =>
        resolveErasureRequest(
          { rut: '12.345.678-5', organizationId: ORG_B },
          ADMIN_A,
        ),
      ).toThrow(ForbiddenException);
    });

    it('sin condominio: 403 (fail-closed)', () => {
      expect(() => resolveErasureRequest({ plate: 'BBCD12' }, NO_ORG)).toThrow(
        ForbiddenException,
      );
    });
  });

  it.each([
    [{ rut: '1-9' }],
    [{ rut: '....----' }],
    [{ rut: '123456789012345678901' }],
    [{ plate: 'AB1' }],
    [{ plate: '--..' }],
    [{ plate: 'ABCDEFGHIJK' }],
  ])(
    '400 con un identificador inválido, sin repetirlo en el mensaje: %p',
    (dto) => {
      const error = thrown(() => resolveErasureRequest(dto, ADMIN_A));
      expect(error).toBeInstanceOf(BadRequestException);
      const { rut, plate } = dto as { rut?: string; plate?: string };
      expect(error.message).not.toContain(rut ?? plate ?? '');
    },
  );
});
