import { decryptString, encryptString } from './crypto.util';

describe('crypto.util', () => {
  const original = process.env.CAMERAS_ENCRYPTION_KEY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CAMERAS_ENCRYPTION_KEY;
    } else {
      process.env.CAMERAS_ENCRYPTION_KEY = original;
    }
  });

  it('falla de forma explícita si no hay clave', () => {
    delete process.env.CAMERAS_ENCRYPTION_KEY;
    expect(() => encryptString('rtsp://x')).toThrow(
      'CAMERAS_ENCRYPTION_KEY no está definida',
    );
    expect(() => decryptString('abc')).toThrow(
      'CAMERAS_ENCRYPTION_KEY no está definida',
    );
  });

  it('falla si la clave no es base64 de 32 bytes (sin derivar una clave por hash)', () => {
    process.env.CAMERAS_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptString('rtsp://x')).toThrow(/inválida/);
    process.env.CAMERAS_ENCRYPTION_KEY = 'una-clave-cualquiera';
    expect(() => encryptString('rtsp://x')).toThrow(/inválida/);
    // 44 caracteres con símbolos fuera del alfabeto: Node los ignoraría y
    // podría llegar a 32 bytes; debe rechazarse igual.
    process.env.CAMERAS_ENCRYPTION_KEY = `${Buffer.alloc(32, 3).toString('base64').slice(0, 40)}!!!=`;
    expect(() => encryptString('rtsp://x')).toThrow(/inválida/);
  });

  it('cifra y descifra con una clave válida', () => {
    process.env.CAMERAS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const url = 'rtsp://user:pass@192.168.0.10:554/stream';
    const encrypted = encryptString(url);
    expect(encrypted).not.toContain('pass');
    expect(decryptString(encrypted)).toBe(url);
    // IV aleatorio: dos cifrados del mismo texto difieren.
    expect(encryptString(url)).not.toBe(encrypted);
  });

  it('no descifra con otra clave', () => {
    process.env.CAMERAS_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    const encrypted = encryptString('secreto');
    process.env.CAMERAS_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString('base64');
    expect(() => decryptString(encrypted)).toThrow();
  });

  describe('integridad (GCM)', () => {
    const IV_LENGTH = 12;
    const TAG_LENGTH = 16;

    beforeEach(() => {
      process.env.CAMERAS_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString(
        'base64',
      );
    });

    function flipByte(payload: string, index: number): string {
      const data = Buffer.from(payload, 'base64');
      data[index] = data[index] ^ 0x01;
      return data.toString('base64');
    }

    it('rechaza un ciphertext manipulado', () => {
      const encrypted = encryptString('rtsp://user:pass@cam/stream');
      const lastByte = Buffer.from(encrypted, 'base64').length - 1;
      expect(() => decryptString(flipByte(encrypted, lastByte))).toThrow();
    });

    it('rechaza un tag manipulado', () => {
      const encrypted = encryptString('rtsp://user:pass@cam/stream');
      expect(() => decryptString(flipByte(encrypted, IV_LENGTH))).toThrow();
    });

    it('rechaza un IV manipulado', () => {
      const encrypted = encryptString('rtsp://user:pass@cam/stream');
      expect(() => decryptString(flipByte(encrypted, 0))).toThrow();
    });

    it('rechaza un payload truncado (sin tag completo)', () => {
      const encrypted = encryptString('rtsp://user:pass@cam/stream');
      const data = Buffer.from(encrypted, 'base64');
      const truncated = data
        .subarray(0, IV_LENGTH + TAG_LENGTH - 4)
        .toString('base64');
      expect(() => decryptString(truncated)).toThrow(
        /Payload cifrado inválido/,
      );
    });

    it('rechaza un payload con el tag truncado y sin ciphertext', () => {
      const encrypted = encryptString('x');
      const data = Buffer.from(encrypted, 'base64');
      // IV + tag sin su último byte: GCM aceptaría un tag de 15 bytes si
      // `authTagLength` no estuviera fijado.
      const shortTag = data.subarray(0, IV_LENGTH + TAG_LENGTH - 1);
      expect(() => decryptString(shortTag.toString('base64'))).toThrow();
    });

    it('rechaza un ciphertext al que se le quitó el final', () => {
      const encrypted = encryptString('rtsp://user:pass@cam/stream');
      const data = Buffer.from(encrypted, 'base64');
      const cut = data.subarray(0, data.length - 3).toString('base64');
      expect(() => decryptString(cut)).toThrow();
    });
  });
});
