import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AgentController } from '../../agent/agent.controller';
import { PendingActionsController } from '../../agent/pending-actions.controller';
import { AuthController } from '../../auth/auth.controller';
import { AuthGuard } from '../../auth/auth.guard';
import { ConciergeDeviceController } from '../../digital-concierge/concierge-device.controller';
import { ConciergeResponseController } from '../../digital-concierge/concierge-response.controller';
import { DigitalConciergeController } from '../../digital-concierge/digital-concierge.controller';
import { MediamtxAuthController } from '../../mediamtx/auth/mediamtx-auth.controller';
import { PrivacyController } from '../../privacy/privacy.controller';
import {
  DEFAULT_THROTTLER_NAME,
  RATE_LIMIT_POLICIES,
  THROTTLER_MODULE_OPTIONS,
  type RateLimitPolicyName,
} from './rate-limit.policies';
import {
  rateLimitTracker,
  VigiliaThrottlerGuard,
} from './vigilia-throttler.guard';

// `AgentController` arrastra el AI SDK (ESM-only): no se usa acá, solo se
// leen los metadatos de sus rutas.
jest.mock('ai', () => ({ tool: jest.fn(), ToolLoopAgent: jest.fn() }));
jest.mock('@ai-sdk/openai', () => ({ createOpenAI: jest.fn() }));

/** Metadatos que `@Throttle` deja en el handler (claves de @nestjs/throttler). */
const THROTTLER_LIMIT_KEY = `THROTTLER:LIMIT${DEFAULT_THROTTLER_NAME}`;
const THROTTLER_TTL_KEY = `THROTTLER:TTL${DEFAULT_THROTTLER_NAME}`;

type Handler = (...args: never[]) => unknown;

function handlerOf(controller: { prototype: object }, method: string): Handler {
  const handler = (controller.prototype as Record<string, unknown>)[method];
  if (typeof handler !== 'function') {
    throw new Error(`${method} no es un handler`);
  }
  return handler as Handler;
}

function methodGuards(handler: Handler): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? [];
}

/**
 * Fase 4 · P4.B (D9): cada ruta sensible tiene su política, el throttler es
 * el ÚLTIMO guard del método (corre después de la autenticación) y el
 * contador es por hub, usuario o IP.
 */
describe('Rate limit (Fase 4 · P4.B, D9)', () => {
  const ROUTES: Array<
    [string, { name: string; prototype: object }, string, RateLimitPolicyName]
  > = [
    [
      'POST /concierge/session/start',
      DigitalConciergeController,
      'startSession',
      'concierge-session-start',
    ],
    [
      'POST /concierge/session/:id/execute-tool',
      DigitalConciergeController,
      'executeTool',
      'concierge-execute-tool',
    ],
    [
      'POST /concierge/session/:id/status',
      DigitalConciergeController,
      'getSessionStatus',
      'concierge-status',
    ],
    [
      'POST /concierge/session/:id/end',
      DigitalConciergeController,
      'endSession',
      'concierge-session',
    ],
    [
      'POST /concierge/agent-config/:houseNumber',
      DigitalConciergeController,
      'getAgentConfig',
      'concierge-session',
    ],
    [
      'POST /concierge/context/:houseNumber',
      DigitalConciergeController,
      'getHouseContext',
      'concierge-session',
    ],
    [
      'POST /concierge/session/:id/respond',
      ConciergeResponseController,
      'respond',
      'concierge-respond',
    ],
    [
      'GET /concierge/device',
      ConciergeDeviceController,
      'getDevice',
      'concierge-device',
    ],
    ['POST /concierge/agent/chat', AgentController, 'chat', 'agent-chat'],
    [
      'POST /auth/check-password',
      AuthController,
      'checkPassword',
      'auth-password',
    ],
    [
      'POST /auth/update-password',
      AuthController,
      'updateCurrentUserPassword',
      'auth-password',
    ],
    [
      'POST /auth/forgot-password',
      AuthController,
      'forgotPassword',
      'auth-public',
    ],
    [
      'POST /auth/reset-password',
      AuthController,
      'updatePasswordWithToken',
      'auth-public',
    ],
    [
      'POST /auth/request-code',
      AuthController,
      'requestConfirmationCode',
      'auth-public',
    ],
    [
      'POST /auth/confirm-account',
      AuthController,
      'confirmAccount',
      'auth-public',
    ],
    [
      'POST /auth/validate-token',
      AuthController,
      'validateToken',
      'auth-token-validate',
    ],
    [
      'POST /concierge/pending-actions/:id/approve',
      PendingActionsController,
      'approve',
      'pending-action-resolve',
    ],
    [
      'POST /concierge/pending-actions/:id/reject',
      PendingActionsController,
      'reject',
      'pending-action-resolve',
    ],
    [
      'POST /internal/mediamtx/auth',
      MediamtxAuthController,
      'authorize',
      'mediamtx-auth',
    ],
    [
      'GET /auth/me/data-export',
      AuthController,
      'exportMyData',
      'privacy-data-export',
    ],
    ['POST /privacy/erasure', PrivacyController, 'erase', 'privacy-erasure'],
  ];

  /** Controllers con rutas limitadas (y donde se buscan rutas sin declarar). */
  const CONTROLLERS: Array<{ name: string; prototype: object }> = [
    DigitalConciergeController,
    ConciergeResponseController,
    ConciergeDeviceController,
    AgentController,
    AuthController,
    PendingActionsController,
    MediamtxAuthController,
    PrivacyController,
  ];

  it('exactamente estas 21 rutas tienen @RateLimit (ninguna sin declarar en la tabla)', () => {
    const limited = CONTROLLERS.flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter((method) => method !== 'constructor')
        .filter(
          (method) =>
            Reflect.getMetadata(
              THROTTLER_LIMIT_KEY,
              handlerOf(controller, method),
            ) !== undefined,
        )
        .map((method) => `${controller.name}.${method}`),
    ).sort();

    expect(limited).toEqual(
      ROUTES.map(
        ([, controller, method]) => `${controller.name}.${method}`,
      ).sort(),
    );
    expect(limited).toHaveLength(21);
  });

  it.each(ROUTES)(
    '%s usa la política esperada y el throttler es el último guard del método',
    (_route, controller, method, policy) => {
      const handler = handlerOf(controller, method);

      expect(Reflect.getMetadata(THROTTLER_LIMIT_KEY, handler)).toBe(
        RATE_LIMIT_POLICIES[policy].limit,
      );
      expect(Reflect.getMetadata(THROTTLER_TTL_KEY, handler)).toBe(
        RATE_LIMIT_POLICIES[policy].ttl,
      );
      const guards = methodGuards(handler);
      expect(guards[guards.length - 1]).toBe(VigiliaThrottlerGuard);
    },
  );

  it.each(['checkPassword', 'updateCurrentUserPassword', 'exportMyData'])(
    'AuthController.%s: AuthGuard corre ANTES del throttler (cuenta por usuario)',
    (method) => {
      const guards = methodGuards(handlerOf(AuthController, method));

      expect(guards).toEqual([AuthGuard, VigiliaThrottlerGuard]);
    },
  );

  it('las políticas de la decisión D9', () => {
    const minute = 60_000;
    expect(RATE_LIMIT_POLICIES).toEqual({
      'concierge-session-start': { limit: 6, ttl: minute },
      'concierge-execute-tool': { limit: 60, ttl: minute },
      'concierge-status': { limit: 40, ttl: minute },
      'concierge-respond': { limit: 10, ttl: minute },
      'concierge-device': { limit: 10, ttl: minute },
      'concierge-session': { limit: 30, ttl: minute },
      'agent-chat': { limit: 20, ttl: minute },
      'pending-action-resolve': { limit: 20, ttl: minute },
      'auth-password': { limit: 5, ttl: 15 * minute },
      'auth-public': { limit: 5, ttl: 15 * minute },
      'auth-token-validate': { limit: 20, ttl: 15 * minute },
      'mediamtx-auth': { limit: 300, ttl: minute },
      'privacy-data-export': { limit: 5, ttl: 60 * minute },
      'privacy-erasure': { limit: 20, ttl: 60 * minute },
    });
  });

  it('un solo throttler registrado (default): no se apilan límites', () => {
    expect(THROTTLER_MODULE_OPTIONS).toEqual([
      expect.objectContaining({ name: DEFAULT_THROTTLER_NAME }),
    ]);
  });

  describe('rateLimitTracker', () => {
    it('hub autenticado -> hub:<hubId> (gana sobre usuario e IP)', () => {
      expect(
        rateLimitTracker({
          hub: { hubId: 'kiosk-1' },
          user: { id: 'user-1' },
          ip: '10.0.0.1',
        }),
      ).toBe('hub:kiosk-1');
    });

    it('sesión humana -> user:<id>', () => {
      expect(rateLimitTracker({ user: { id: 'user-1' }, ip: '10.0.0.1' })).toBe(
        'user:user-1',
      );
    });

    it('sin identidad -> ip:<req.ip>', () => {
      expect(rateLimitTracker({ ip: '10.0.0.1' })).toBe('ip:10.0.0.1');
    });

    it('sin identidad ni IP -> balde común ip:unknown', () => {
      expect(rateLimitTracker({})).toBe('ip:unknown');
      expect(rateLimitTracker({ user: { id: '' }, hub: {} })).toBe(
        'ip:unknown',
      );
    });
  });
});
