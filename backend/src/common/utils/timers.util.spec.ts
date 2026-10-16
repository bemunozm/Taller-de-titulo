import { sleepUnref } from './timers.util';

describe('sleepUnref (Fase 4 · P8)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resuelve después de la espera', async () => {
    const start = Date.now();

    await sleepUnref(20);

    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('su timer no mantiene vivo el proceso (unref)', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const pending = sleepUnref(5);
    const timer = setTimeoutSpy.mock.results[0]?.value as NodeJS.Timeout;

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5);
    expect(timer.hasRef()).toBe(false);
    await pending;
  });
});
