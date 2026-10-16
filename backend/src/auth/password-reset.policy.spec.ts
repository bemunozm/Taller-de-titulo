import { PASSWORD_RESET_SESSION_POLICY } from './password-reset.policy';

describe('PASSWORD_RESET_SESSION_POLICY', () => {
  it('el reset de contraseña cierra todas las sesiones del usuario', () => {
    expect(PASSWORD_RESET_SESSION_POLICY.revokeSessionsOnPasswordReset).toBe(
      true,
    );
  });
});
