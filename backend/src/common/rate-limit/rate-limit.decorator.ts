import { applyDecorators, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  DEFAULT_THROTTLER_NAME,
  RATE_LIMIT_POLICIES,
  type RateLimitPolicyName,
} from './rate-limit.policies';
import { VigiliaThrottlerGuard } from './vigilia-throttler.guard';

/**
 * Aplica una política de `RATE_LIMIT_POLICIES` a un handler (Fase 4 · P4.B,
 * D9): `VigiliaThrottlerGuard` + el límite de la política sobre el throttler
 * `default`.
 *
 * Va a nivel de MÉTODO y, si el método tiene su propio
 * `@UseGuards(AuthGuard)`, ARRIBA de ese decorador: los decoradores se
 * evalúan de abajo hacia arriba y `UseGuards` agrega al final, así el
 * throttler queda después de la autenticación y cuenta por usuario o hub en
 * vez de por IP.
 */
export function RateLimit(
  policy: RateLimitPolicyName,
): MethodDecorator & ClassDecorator {
  const { limit, ttl } = RATE_LIMIT_POLICIES[policy];
  return applyDecorators(
    UseGuards(VigiliaThrottlerGuard),
    Throttle({ [DEFAULT_THROTTLER_NAME]: { limit, ttl } }),
  );
}
