import { RelayControllerService } from '../../src/services/relay-controller.service';
import { Gpio } from '../../src/utils/gpio-wrapper';

// Helper para flush de promesas con fake timers
const flushPromises = (): Promise<void> =>
  new Promise<void>(jest.requireActual<typeof import('timers')>('timers').setImmediate);

interface MockGpioInstance {
  writeSync: jest.Mock;
  readSync: jest.Mock;
  unexport: jest.Mock;
}

// Instancias creadas por el mock de Gpio (el prefijo `mock` permite referenciarla
// desde la factory de jest.mock).
const mockGpioInstances: MockGpioInstance[] = [];

// El servicio importa Gpio desde ../utils/gpio-wrapper (pigpio o simulación
// interna), NO desde `onoff`.
jest.mock('../../src/utils/gpio-wrapper', () => ({
  Gpio: jest.fn().mockImplementation(() => {
    const instance: MockGpioInstance = {
      writeSync: jest.fn(),
      readSync: jest.fn().mockReturnValue(0),
      unexport: jest.fn(),
    };
    mockGpioInstances.push(instance);
    return instance;
  }),
}));

const GpioMock = Gpio as unknown as jest.Mock;

describe('RelayControllerService', () => {
  let service: RelayControllerService;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGpioInstances.length = 0;
    jest.useFakeTimers();

    // El servicio registra handlers de señales del proceso: no los instalamos de verdad.
    jest.spyOn(process, 'on').mockImplementation(() => process);

    // Configurar env vars para testing
    process.env = {
      ...originalEnv,
      RELAY_PIN_1: '17',
      RELAY_PIN_2: '27',
      MAX_INTERCEPT_TIME_MS: '180000',
      RELAY_SETTLING_TIME_MS: '200',
    };

    service = new RelayControllerService();
  });

  afterEach(() => {
    service.cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('Initialization', () => {
    it('debe inicializar los relés en HIGH (OFF, Active LOW)', () => {
      expect(GpioMock).toHaveBeenCalledWith(17, 'out');
      expect(GpioMock).toHaveBeenCalledWith(27, 'out');
      expect(mockGpioInstances).toHaveLength(2);
      mockGpioInstances.forEach((gpio) => {
        expect(gpio.writeSync).toHaveBeenCalledWith(1);
      });
      expect(service.isRelayAvailable()).toBe(true);
    });

    it('debe configurar handlers de seguridad', () => {
      const registered = (process.on as unknown as jest.Mock).mock.calls.map(
        (call: unknown[]) => call[0],
      );

      expect(registered).toEqual(
        expect.arrayContaining([
          'SIGINT',
          'SIGTERM',
          'exit',
          'uncaughtException',
          'unhandledRejection',
        ]),
      );
    });

    it('debe leer los pines desde variables de entorno', () => {
      process.env.RELAY_PIN_1 = '22';
      process.env.RELAY_PIN_2 = '23';

      const customService = new RelayControllerService();

      expect(GpioMock).toHaveBeenCalledWith(22, 'out');
      expect(GpioMock).toHaveBeenCalledWith(23, 'out');

      customService.cleanup();
    });
  });

  describe('enableInterception', () => {
    it('debe activar ambos relés (LOW) tras el settling time', async () => {
      const promise = service.enableInterception();

      // Avanzar timers para el settling time
      jest.advanceTimersByTime(200);

      await promise;

      expect(service.isActive()).toBe(true);
      mockGpioInstances.forEach((gpio) => {
        expect(gpio.writeSync).toHaveBeenLastCalledWith(0);
      });
    });

    it('debe esperar el settling time configurado', async () => {
      const settlingTime = 300;
      process.env.RELAY_SETTLING_TIME_MS = String(settlingTime);

      const newService = new RelayControllerService();
      let resolved = false;
      const promise = newService.enableInterception().then(() => {
        resolved = true;
      });

      // No debería completarse antes del settling time
      jest.advanceTimersByTime(settlingTime - 1);
      await flushPromises();
      expect(resolved).toBe(false);

      // Avanzar el tiempo restante
      jest.advanceTimersByTime(1);
      await promise;

      expect(resolved).toBe(true);
      expect(newService.isActive()).toBe(true);
      newService.cleanup();
    });

    it('debe ignorar si ya está interceptando', async () => {
      const firstPromise = service.enableInterception();
      jest.advanceTimersByTime(200);
      await firstPromise;

      const writesBefore = mockGpioInstances.map((gpio) => gpio.writeSync.mock.calls.length);

      // Intentar activar de nuevo
      await service.enableInterception();

      // No debería lanzar error, cambiar estado ni volver a escribir
      expect(service.isActive()).toBe(true);
      expect(mockGpioInstances.map((gpio) => gpio.writeSync.mock.calls.length)).toEqual(
        writesBefore,
      );
    });

    it('debe iniciar watchdog timer', async () => {
      const promise = service.enableInterception();
      jest.advanceTimersByTime(200);
      await promise;

      expect(service.isActive()).toBe(true);

      // Avanzar hasta el watchdog timeout (180000ms)
      jest.advanceTimersByTime(180000);
      await flushPromises();

      // Avanzar el delay interno de disableInterception (500ms)
      jest.advanceTimersByTime(500);
      await flushPromises();

      // El watchdog debería haber desactivado
      expect(service.isActive()).toBe(false);
    });
  });

  describe('disableInterception', () => {
    beforeEach(async () => {
      const promise = service.enableInterception();
      jest.advanceTimersByTime(200);
      await promise;
    });

    it('debe desactivar los relés correctamente (HIGH)', async () => {
      const promise = service.disableInterception();

      // Esperar el delay de 500ms
      jest.advanceTimersByTime(500);

      await promise;

      expect(service.isActive()).toBe(false);
      mockGpioInstances.forEach((gpio) => {
        expect(gpio.writeSync).toHaveBeenLastCalledWith(1);
      });
    });

    it('debe cancelar el watchdog timer', async () => {
      const promise = service.disableInterception();
      jest.advanceTimersByTime(500);
      await promise;

      const writesAfterDisable = mockGpioInstances.map(
        (gpio) => gpio.writeSync.mock.calls.length,
      );

      // Avanzar tiempo más allá del watchdog
      jest.advanceTimersByTime(180000);
      await flushPromises();

      // No debería hacer nada porque ya está desactivado
      expect(service.isActive()).toBe(false);
      expect(mockGpioInstances.map((gpio) => gpio.writeSync.mock.calls.length)).toEqual(
        writesAfterDisable,
      );
    });

    it('debe ignorar si ya está desactivado', async () => {
      const firstPromise = service.disableInterception();
      jest.advanceTimersByTime(500);
      await firstPromise;

      // Intentar desactivar de nuevo
      const secondPromise = service.disableInterception();
      jest.advanceTimersByTime(500);
      await secondPromise;

      // No debería lanzar error
      expect(service.isActive()).toBe(false);
    });
  });

  describe('isActive', () => {
    it('debe retornar false inicialmente', () => {
      expect(service.isActive()).toBe(false);
    });

    it('debe retornar true cuando está interceptando', async () => {
      const promise = service.enableInterception();
      jest.advanceTimersByTime(200);
      await promise;

      expect(service.isActive()).toBe(true);
    });

    it('debe retornar false después de desactivar', async () => {
      const enablePromise = service.enableInterception();
      jest.advanceTimersByTime(200);
      await enablePromise;

      const disablePromise = service.disableInterception();
      jest.advanceTimersByTime(500);
      await disablePromise;

      expect(service.isActive()).toBe(false);
    });
  });

  describe('Watchdog Safety', () => {
    it('debe auto-desactivar después del timeout máximo', async () => {
      const maxTime = 180000;

      const enablePromise = service.enableInterception();
      jest.advanceTimersByTime(200);
      await enablePromise;

      expect(service.isActive()).toBe(true);

      // Avanzar hasta justo antes del timeout
      jest.advanceTimersByTime(maxTime - 1);
      expect(service.isActive()).toBe(true);

      // Avanzar pasando el timeout + delay de desactivación
      jest.advanceTimersByTime(1);
      await flushPromises();
      jest.advanceTimersByTime(500);
      await flushPromises();

      expect(service.isActive()).toBe(false);
    });

    it('debe respetar el MAX_INTERCEPT_TIME_MS del .env', async () => {
      const customTimeout = 60000;
      process.env.MAX_INTERCEPT_TIME_MS = String(customTimeout);

      const customService = new RelayControllerService();
      const enablePromise = customService.enableInterception();
      jest.advanceTimersByTime(200);
      await enablePromise;

      expect(customService.isActive()).toBe(true);

      // Avanzar al timeout custom + delay de desactivación
      jest.advanceTimersByTime(customTimeout);
      await flushPromises();
      jest.advanceTimersByTime(500);
      await flushPromises();

      expect(customService.isActive()).toBe(false);
      customService.cleanup();
    });
  });

  describe('cleanup', () => {
    it('debe desactivar relés al limpiar', async () => {
      const promise = service.enableInterception();
      jest.advanceTimersByTime(200);
      await promise;

      service.cleanup();

      expect(service.isActive()).toBe(false);
      mockGpioInstances.forEach((gpio) => {
        expect(gpio.writeSync).toHaveBeenLastCalledWith(1);
      });
    });

    it('debe unexport los GPIO', () => {
      service.cleanup();

      expect(mockGpioInstances).toHaveLength(2);
      mockGpioInstances.forEach((gpio) => {
        expect(gpio.unexport).toHaveBeenCalled();
      });
    });

    it('no debe lanzar error si se llama múltiples veces', () => {
      expect(() => {
        service.cleanup();
        service.cleanup();
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    // Comportamiento actual: si el GPIO falla al inicializar, el servicio NO
    // lanza; queda no disponible (modo desarrollo sin hardware) y las
    // operaciones de intercepción son no-ops.
    it('no debe lanzar si el GPIO falla y debe quedar no disponible', async () => {
      GpioMock.mockImplementationOnce(() => ({
        writeSync: jest.fn(() => {
          throw new Error('GPIO error');
        }),
        unexport: jest.fn(),
      }));

      let degradedService: RelayControllerService | undefined;
      expect(() => {
        degradedService = new RelayControllerService();
      }).not.toThrow();

      expect(degradedService?.isRelayAvailable()).toBe(false);

      await degradedService?.enableInterception();
      expect(degradedService?.isActive()).toBe(false);
    });
  });
});
