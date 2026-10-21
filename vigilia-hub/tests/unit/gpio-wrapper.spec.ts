/**
 * gpio-wrapper (Fase 4 · P8.C): `pigpio` pasó a dependencia opcional para que
 * `npm ci` funcione fuera de la Raspberry (CI, desarrollo). Si el equipo TIENE
 * GPIO pero pigpio no carga, el wrapper sigue simulando (no tumba el hub), pero
 * lo avisa como error una sola vez: en la Raspberry es una instalación rota.
 */
type GpioWrapperModule = typeof import('../../src/utils/gpio-wrapper');

interface LoggerDouble {
  error: jest.Mock;
  debug: jest.Mock;
}

interface FakePigpioPin {
  pin: number;
  digitalWrite: jest.Mock;
  digitalRead: jest.Mock;
  enableAlert: jest.Mock;
}

interface LoadOptions {
  /** `/dev/gpiomem` = Raspberry; `/dev/mem` sola = cualquier Linux. */
  device: 'none' | 'dev-mem' | 'gpiomem';
  pigpio: 'missing' | 'available';
}

interface LoadedWrapper {
  wrapper: GpioWrapperModule;
  logger: LoggerDouble;
  pigpioPins: FakePigpioPin[];
}

function loadWrapper(options: LoadOptions): LoadedWrapper {
  const logger: LoggerDouble = { error: jest.fn(), debug: jest.fn() };
  const pigpioPins: FakePigpioPin[] = [];

  // Registro limpio en cada carga: el wrapper hace `require('fs')` y
  // `require('pigpio')` al construir cada pin (después de cargarse), así que un
  // mock cacheado por otro test no debe sobrevivir (`isolateModules` no basta).
  jest.resetModules();
  jest.doMock('fs', () => ({
    ...jest.requireActual<typeof import('fs')>('fs'),
    existsSync: (path: string): boolean =>
      (options.device === 'gpiomem' && path === '/dev/gpiomem') ||
      (options.device !== 'none' && path === '/dev/mem'),
  }));
  jest.doMock('../../src/utils/logger', () => ({
    Logger: class {
      log(): void {}
      warn(): void {}
      error = logger.error;
      debug = logger.debug;
    },
  }));
  if (options.pigpio === 'missing') {
    jest.doMock(
      'pigpio',
      () => {
        throw new Error("Cannot find module 'pigpio'");
      },
      { virtual: true },
    );
  } else {
    jest.doMock(
      'pigpio',
      () => ({
        Gpio: class {
          static INPUT = 0;
          static OUTPUT = 1;
          static PUD_OFF = 0;
          static PUD_DOWN = 1;
          static PUD_UP = 2;
          digitalWrite = jest.fn();
          digitalRead = jest.fn().mockReturnValue(1);
          enableAlert = jest.fn();
          constructor(pin: number) {
            pigpioPins.push({
              pin,
              digitalWrite: this.digitalWrite,
              digitalRead: this.digitalRead,
              enableAlert: this.enableAlert,
            });
          }
        },
      }),
      { virtual: true },
    );
  }

  const wrapper = jest.requireActual<GpioWrapperModule>('../../src/utils/gpio-wrapper');
  return { wrapper, logger, pigpioPins };
}

describe('gpio-wrapper: pigpio opcional (Fase 4 · P8.C)', () => {
  afterAll(() => {
    jest.dontMock('fs');
    jest.dontMock('pigpio');
    jest.dontMock('../../src/utils/logger');
    jest.resetModules();
  });

  it('sin dispositivo GPIO (Windows/macOS) simula el pin sin reportar error', () => {
    const { wrapper, logger } = loadWrapper({ device: 'none', pigpio: 'missing' });

    const relay = new wrapper.Gpio(17, 'out');
    relay.writeSync(1);

    expect(relay.readSync()).toBe(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('en un Linux cualquiera (solo /dev/mem) sin pigpio simula sin reportar error', () => {
    const { wrapper, logger } = loadWrapper({ device: 'dev-mem', pigpio: 'missing' });

    const relay = new wrapper.Gpio(17, 'out');
    relay.writeSync(1);

    expect(relay.readSync()).toBe(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('en una Raspberry sin pigpio simula y lo reporta como error una sola vez', () => {
    const { wrapper, logger } = loadWrapper({ device: 'gpiomem', pigpio: 'missing' });

    const relay = new wrapper.Gpio(17, 'out');
    new wrapper.Gpio(27, 'out');
    new wrapper.Gpio(5, 'in', 'none', 'up');
    relay.writeSync(1);

    expect(relay.readSync()).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('SIMULADOS'),
      expect.any(Error),
    );
  });

  it('en una Raspberry con pigpio usa el hardware real', () => {
    const { wrapper, logger, pigpioPins } = loadWrapper({ device: 'gpiomem', pigpio: 'available' });

    const relay = new wrapper.Gpio(17, 'out');
    relay.writeSync(1);

    expect(pigpioPins).toHaveLength(1);
    expect(pigpioPins[0].pin).toBe(17);
    // Valor inicial de un output (0) y la escritura explícita (1).
    expect(pigpioPins[0].digitalWrite.mock.calls).toEqual([[0], [1]]);
    expect(relay.readSync()).toBe(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
