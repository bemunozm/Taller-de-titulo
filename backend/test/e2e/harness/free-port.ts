import { createServer } from 'node:net';

/**
 * Puerto TCP libre en `host` (lo asigna el SO con el puerto 0 y se libera de
 * inmediato). Hay una ventana mínima entre liberarlo y que el hijo lo tome;
 * si otro proceso lo ocupa, el backend no arranca y el setup falla con el log.
 */
export function findFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('No se pudo obtener un puerto libre'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
