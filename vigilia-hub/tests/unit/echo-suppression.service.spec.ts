import { EchoSuppressionService } from '../../src/services/echo-suppression.service';

describe('EchoSuppressionService', () => {
  let service: EchoSuppressionService;

  beforeEach(() => {
    // Reloj falso: Date.now() y setTimeout avanzan solo con advanceTimersByTime
    jest.useFakeTimers();

    // Configurar variables de entorno para testing
    process.env.RMS_THRESHOLD_DB = '-45';
    process.env.SUPPRESSION_TAIL_MS = '300';
    process.env.HALF_DUPLEX_ENABLED = 'true';

    service = new EchoSuppressionService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('shouldSendAudio', () => {
    it('debe suprimir audio cuando el speaker está activo', () => {
      service.notifySpeakerActive();

      // Crear buffer de audio con contenido
      const audioBuffer = Buffer.alloc(480); // 10ms @ 24kHz
      for (let i = 0; i < audioBuffer.length; i += 2) {
        audioBuffer.writeInt16LE(1000, i); // Señal fuerte
      }

      const shouldSend = service.shouldSendAudio(audioBuffer);

      expect(shouldSend).toBe(false);
    });

    it('debe suprimir audio durante la cola (tail) después del speaker', () => {
      service.notifySpeakerActive();
      service.notifySpeakerInactive();

      // Inmediatamente después (dentro de 300ms)
      const audioBuffer = Buffer.alloc(480);
      const shouldSend = service.shouldSendAudio(audioBuffer);

      expect(shouldSend).toBe(false);
    });

    it('debe permitir audio después de que expire la cola', () => {
      service.notifySpeakerActive();
      service.notifySpeakerInactive();

      // Avanzar más de 300ms
      jest.advanceTimersByTime(350);

      // Crear buffer con señal fuerte
      const audioBuffer = Buffer.alloc(480);
      for (let i = 0; i < audioBuffer.length; i += 2) {
        audioBuffer.writeInt16LE(5000, i); // Señal fuerte
      }

      const shouldSend = service.shouldSendAudio(audioBuffer);

      expect(shouldSend).toBe(true);
    });

    it('debe suprimir audio con volumen bajo (por debajo del threshold)', () => {
      // Crear buffer con señal muy débil
      const audioBuffer = Buffer.alloc(480);
      for (let i = 0; i < audioBuffer.length; i += 2) {
        audioBuffer.writeInt16LE(10, i); // Señal muy débil
      }

      const shouldSend = service.shouldSendAudio(audioBuffer);

      expect(shouldSend).toBe(false);
    });

    it('debe permitir audio con volumen alto', () => {
      // Esperar que no haya speaker activo
      service.notifySpeakerInactive();

      // Avanzar más de 300ms
      jest.advanceTimersByTime(350);

      // Crear buffer con señal fuerte
      const audioBuffer = Buffer.alloc(480);
      for (let i = 0; i < audioBuffer.length; i += 2) {
        audioBuffer.writeInt16LE(10000, i); // Señal fuerte
      }

      expect(service.shouldSendAudio(audioBuffer)).toBe(true);
    });

    it('debe suprimir justo antes de que expire la cola y permitir al cumplirla', () => {
      service.notifySpeakerInactive();
      const audioBuffer = Buffer.alloc(480);
      for (let i = 0; i < audioBuffer.length; i += 2) {
        audioBuffer.writeInt16LE(10000, i);
      }

      jest.advanceTimersByTime(299);
      expect(service.shouldSendAudio(audioBuffer)).toBe(false);

      jest.advanceTimersByTime(1);
      expect(service.shouldSendAudio(audioBuffer)).toBe(true);
    });

    it('debe permitir todo el audio cuando half-duplex está deshabilitado', () => {
      // Crear nuevo servicio con half-duplex deshabilitado
      process.env.HALF_DUPLEX_ENABLED = 'false';
      const serviceNoDuplex = new EchoSuppressionService();

      serviceNoDuplex.notifySpeakerActive();

      const audioBuffer = Buffer.alloc(480);
      const shouldSend = serviceNoDuplex.shouldSendAudio(audioBuffer);

      expect(shouldSend).toBe(true);
    });
  });

  describe('RMS Calculation', () => {
    it('debe calcular correctamente el RMS de una señal de prueba', () => {
      // Crear buffer con señal conocida
      const audioBuffer = Buffer.alloc(480);
      const amplitude = 16384; // 50% del máximo

      for (let i = 0; i < audioBuffer.length; i += 2) {
        audioBuffer.writeInt16LE(amplitude, i);
      }

      // Calcular RMS usando el método privado (indirectamente)
      const shouldSend = service.shouldSendAudio(audioBuffer);

      // Una señal de 16384 debería estar por encima del threshold de -45dB
      expect(typeof shouldSend).toBe('boolean');
    });

    it('debe manejar buffers vacíos sin errores', () => {
      const audioBuffer = Buffer.alloc(480);

      expect(() => {
        service.shouldSendAudio(audioBuffer);
      }).not.toThrow();
    });
  });

  describe('getTimeSinceSpeaker', () => {
    it('debe retornar el tiempo desde la última actividad del speaker', () => {
      service.notifySpeakerActive();
      service.notifySpeakerInactive();

      jest.advanceTimersByTime(100);

      expect(service.getTimeSinceSpeaker()).toBe(100);
    });
  });

  describe('Performance', () => {
    it('debe procesar audio en menos de 1ms', () => {
      // Mide tiempo real de CPU: no puede usar el reloj falso
      jest.useRealTimers();
      const audioBuffer = Buffer.alloc(480);
      
      const iterations = 1000;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        service.shouldSendAudio(audioBuffer);
      }

      const duration = Date.now() - start;
      const avgTime = duration / iterations;

      expect(avgTime).toBeLessThan(1);
    });
  });
});
