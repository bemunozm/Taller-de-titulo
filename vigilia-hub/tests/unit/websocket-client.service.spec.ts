import {
  HEARTBEAT_INTERVAL_MS,
  HUB_CONNECTED_EVENT,
  HUB_DOOR_OPEN_EVENT,
  HUB_HEARTBEAT_EVENT,
  HUB_KEYPAD_EVENT,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_STABLE_AFTER_MS,
  SERVER_DISCONNECT_REASON,
  WebSocketClientService,
  computeReconnectDelay,
  parseDoorOpenType,
} from '../../src/services/websocket-client.service';
import type { ConnectivityService } from '../../src/services/connectivity.service';
import { testHubConfig } from './support/hub-config.fixture';

type Handler = (data?: unknown) => void;

/** Socket de socket.io-client simulado (lo devuelve `io()`). */
const mockSocket = {
  connected: true,
  /** `false` cuando el backend rechazó en el middleware: no reintenta solo. */
  active: true,
  id: 'sock-1',
  connect: jest.fn(),
  handlers: new Map<string, Handler>(),
  on: jest.fn((event: string, handler: Handler) => {
    mockSocket.handlers.set(event, handler);
  }),
  off: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => mockSocket),
}));

jest.mock('../../src/utils/logger', () => ({
  Logger: class {
    log(): void {}
    warn(): void {}
    error(): void {}
    debug(): void {}
  },
}));

/**
 * Fase 4 · P4: el hub emite los eventos con los nombres que escucha el
 * gateway (`hub:keypad`, `hub:heartbeat`) e ignora órdenes de apertura con un
 * payload inesperado.
 */
describe('WebSocketClientService', () => {
  let service: WebSocketClientService;
  const connectivity = {
    checkConnectivity: jest.fn().mockResolvedValue(true),
  };

  function trigger(event: string, data?: unknown): void {
    const handler = mockSocket.handlers.get(event);
    if (!handler) {
      throw new Error(`No hay handler para ${event}`);
    }
    handler(data);
  }

  function emittedEvents(): string[] {
    return mockSocket.emit.mock.calls.map((call: unknown[]) => call[0] as string);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSocket.handlers.clear();
    mockSocket.connected = true;
    mockSocket.active = true;
    service = new WebSocketClientService(
      connectivity as unknown as ConnectivityService,
      testHubConfig({ hubSecret: 'secret-test' }),
    );
    await service.connect();
  });

  afterEach(() => {
    service.cleanup();
    jest.useRealTimers();
  });

  it('se conecta a /hub con hubId y hubSecret en el handshake', () => {
    const { io } = jest.requireMock<{ io: jest.Mock }>('socket.io-client');
    expect(io).toHaveBeenCalledWith(
      // Fase 4 · P6.M: el socket usa el esquema WebSocket derivado de BACKEND_URL.
      'ws://backend.test/hub',
      expect.objectContaining({
        auth: { hubId: 'hub-test', hubSecret: 'secret-test' },
      }),
    );
  });

  describe('heartbeat', () => {
    it('emite hub:heartbeat (con uptime en ms) cada 30 s tras conectar, nunca "heartbeat"', () => {
      jest.useFakeTimers();
      trigger('connect');

      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        HUB_HEARTBEAT_EVENT,
        expect.objectContaining({
          uptime: expect.any(Number) as number,
          timestamp: expect.any(Number) as number,
        }),
      );
      expect(emittedEvents()).not.toContain('heartbeat');
    });

    it('se detiene al desconectarse', () => {
      jest.useFakeTimers();
      trigger('connect');
      trigger('disconnect', 'transport close');

      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

      expect(emittedEvents()).not.toContain(HUB_HEARTBEAT_EVENT);
    });
  });

  describe('keypad', () => {
    it('emite hub:keypad con el número marcado (sin hubId: el gateway usa el del handshake)', () => {
      service.emitKeypadEvent('504');

      expect(mockSocket.emit).toHaveBeenCalledWith(HUB_KEYPAD_EVENT, {
        houseNumber: '504',
        timestamp: expect.any(Number) as number,
      });
      expect(emittedEvents()).not.toContain('keypad');
    });

    it('sin conexión no emite', () => {
      mockSocket.connected = false;

      service.emitKeypadEvent('504');

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('hub:door_open', () => {
    it.each(['vehicular', 'pedestrian'] as const)(
      'orden válida (%s) -> acciona el callback con ese tipo',
      (type) => {
        const callback = jest.fn();
        service.onDoorOpenCommand(callback);

        trigger(HUB_DOOR_OPEN_EVENT, { type, visitId: 'visit-1' });

        expect(callback).toHaveBeenCalledWith(type);
      },
    );

    it.each([
      ['sin type', { visitId: 'visit-1' }],
      ['type desconocido', { type: 'garage' }],
      ['payload no objeto', 'vehicular'],
      ['payload nulo', null],
    ])('payload inesperado (%s) -> no acciona el relé', (_case, data) => {
      const callback = jest.fn();
      service.onDoorOpenCommand(callback);

      trigger(HUB_DOOR_OPEN_EVENT, data);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  /**
   * Fase 4 · P4: el backend rechaza credenciales en el middleware de `/hub`
   * (antes del CONNECT); ahí socket.io-client no reintenta solo
   * (`socket.active === false`). El hub reintenta a mano con backoff.
   */
  describe('reconexión manual tras un rechazo del middleware', () => {
    let randomSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // sin jitter
    });

    afterEach(() => {
      randomSpy.mockRestore();
    });

    function rejectConnection(): void {
      mockSocket.active = false;
      trigger('connect_error', new Error('unauthorized'));
    }

    it('con socket.active === false programa un reintento con backoff exponencial (5 s, 10 s, 20 s...)', () => {
      rejectConnection();
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS - 1);
      expect(mockSocket.connect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);

      rejectConnection();
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 2 - 1);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);

      rejectConnection();
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 4);
      expect(mockSocket.connect).toHaveBeenCalledTimes(3);
    });

    it('nunca espera más de 60 s entre reintentos', () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        rejectConnection();
        jest.advanceTimersByTime(RECONNECT_MAX_DELAY_MS);
      }

      expect(mockSocket.connect).toHaveBeenCalledTimes(8);
    });

    it('un solo reintento pendiente a la vez', () => {
      rejectConnection();
      rejectConnection();

      jest.advanceTimersByTime(RECONNECT_MAX_DELAY_MS);

      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
    });

    it('si socket.io sigue reintentando solo (active === true), no agrega reintentos manuales', () => {
      mockSocket.active = true;
      trigger('connect_error', new Error('timeout'));

      jest.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);

      expect(mockSocket.connect).not.toHaveBeenCalled();
    });

    it('hub:connected + 30 s de conexión estable reinicia el backoff (el siguiente rechazo vuelve a 5 s)', () => {
      rejectConnection();
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS);
      rejectConnection();
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 2);
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);

      trigger(HUB_CONNECTED_EVENT, { hubId: 'hub-test' });
      jest.advanceTimersByTime(RECONNECT_STABLE_AFTER_MS);
      rejectConnection();
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS);

      expect(mockSocket.connect).toHaveBeenCalledTimes(3);
    });

    it('hub:connected seguido de un corte antes de 30 s NO reinicia el backoff (evita el ping-pong)', () => {
      rejectConnection();
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS);
      rejectConnection();
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 2);
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);

      // Se registra, pero otro proceso con la misma credencial lo expulsa.
      trigger(HUB_CONNECTED_EVENT, { hubId: 'hub-test' });
      jest.advanceTimersByTime(RECONNECT_STABLE_AFTER_MS - 1);
      trigger('disconnect', SERVER_DISCONNECT_REASON);

      // Sigue la escalera: 20 s, no 5 s.
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 4 - 1);
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(1);
      expect(mockSocket.connect).toHaveBeenCalledTimes(3);
    });

    it('el evento connect (sin hub:connected) NO reinicia el backoff', () => {
      rejectConnection();
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS);
      trigger('connect');
      rejectConnection();

      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS);
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);
    });

    it('tras disconnect() no reintenta', () => {
      rejectConnection();
      service.disconnect();

      jest.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);

      expect(mockSocket.connect).not.toHaveBeenCalled();
    });
  });

  /**
   * Fase 4 · P4 (A1): si el backend corta el socket (`io server disconnect`:
   * last-wins, secret rotado, hub desactivado o con otro tipo/condominio),
   * socket.io-client no reintenta solo; el hub reintenta con el mismo backoff.
   */
  describe('reconexión manual tras un corte del backend (io server disconnect)', () => {
    let randomSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // sin jitter
    });

    afterEach(() => {
      randomSpy.mockRestore();
    });

    it('programa un reintento con backoff (5 s, luego 10 s...)', () => {
      trigger('connect');
      trigger('disconnect', SERVER_DISCONNECT_REASON);

      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS - 1);
      expect(mockSocket.connect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);

      // Con la credencial revocada, el reintento recibe connect_error.
      mockSocket.active = false;
      trigger('connect_error', new Error('unauthorized'));
      jest.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 2);
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);
    });

    it('otros motivos (p. ej. transport close) los reintenta socket.io solo: sin reintento manual', () => {
      trigger('disconnect', 'transport close');

      jest.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);

      expect(mockSocket.connect).not.toHaveBeenCalled();
    });

    it('desconexión voluntaria (disconnect()) no reintenta', () => {
      service.disconnect();
      trigger('disconnect', 'io client disconnect');
      // Aunque llegara un corte del servidor en el medio del cierre.
      trigger('disconnect', SERVER_DISCONNECT_REASON);

      jest.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);

      expect(mockSocket.connect).not.toHaveBeenCalled();
    });
  });

  describe('computeReconnectDelay', () => {
    it('exponencial desde 5 s con tope de 60 s', () => {
      const noJitter = (): number => 0.5;
      expect(
        [0, 1, 2, 3, 4, 10].map((attempt) =>
          computeReconnectDelay(attempt, noJitter),
        ),
      ).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    });

    it('jitter de ±20 % sin pasar el tope', () => {
      expect(computeReconnectDelay(0, () => 0)).toBe(4_000);
      expect(computeReconnectDelay(0, () => 1)).toBe(6_000);
      expect(computeReconnectDelay(10, () => 1)).toBe(RECONNECT_MAX_DELAY_MS);
    });
  });

  describe('parseDoorOpenType', () => {
    it('solo acepta vehicular o pedestrian', () => {
      expect(parseDoorOpenType({ type: 'vehicular' })).toBe('vehicular');
      expect(parseDoorOpenType({ type: 'pedestrian' })).toBe('pedestrian');
      expect(parseDoorOpenType({ type: 'VEHICULAR' })).toBeNull();
      expect(parseDoorOpenType(undefined)).toBeNull();
    });
  });
});
