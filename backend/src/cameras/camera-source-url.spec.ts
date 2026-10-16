import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { isAllowedCameraSourceUrl } from './camera-source-url';

/**
 * Fase 4 · P7.L (pendiente de P6.M): la URL de origen de una cámara no admite
 * espacios ni `"`, `'`, `<`, `>` sin codificar, al crear y al editar. La
 * redacción de los logs corta en esos caracteres y dejaba la cola de la
 * clave RTSP a la vista.
 */
describe('sourceUrl de cámaras: sin espacios ni comillas/ángulos sin codificar', () => {
  async function sourceErrors(
    dtoClass: typeof CreateCameraDto | typeof UpdateCameraDto,
    sourceUrl: string,
  ): Promise<string[]> {
    const dto = plainToInstance(dtoClass, { name: 'Portón', sourceUrl });
    const errors = await validate(dto);
    return errors
      .filter((error) => error.property === 'sourceUrl')
      .flatMap((error) => Object.keys(error.constraints ?? {}));
  }

  it.each([
    'rtsp://admin:cl"ave@10.0.0.5:554/Streaming/101',
    "rtsp://admin:cl'ave@10.0.0.5:554/Streaming/101",
    'rtsp://admin:cl<ave@10.0.0.5:554/Streaming/101',
    'rtsp://admin:cl>ave@10.0.0.5:554/Streaming/101',
    'rtsp://admin:cl ave@10.0.0.5:554/Streaming/101',
    'rtsp://admin:clave@10.0.0.5:554/Streaming/101 ',
    'rtsp://admin:clave@10.0.0.5:554/Stream\ting',
    'rtsps://cam.local/live"><script>',
  ])('rechaza %j (creación y edición)', async (url) => {
    await expect(sourceErrors(CreateCameraDto, url)).resolves.toContain(
      'isCameraSourceUrl',
    );
    await expect(sourceErrors(UpdateCameraDto, url)).resolves.toContain(
      'isCameraSourceUrl',
    );
    expect(isAllowedCameraSourceUrl(url)).toBe(false);
  });

  it.each([
    'rtsp://admin:cl%22ave%3C%3E%27%20x@10.0.0.5:554/Streaming/101',
    'rtsp://admin:Cl4ve!$&()*+,;=@10.0.0.5:554/Streaming/101?channel=1',
    'RTSPS://cam.local/live',
  ])('acepta %s (los caracteres codificados sí)', async (url) => {
    await expect(sourceErrors(CreateCameraDto, url)).resolves.toEqual([]);
    await expect(sourceErrors(UpdateCameraDto, url)).resolves.toEqual([]);
    expect(isAllowedCameraSourceUrl(url)).toBe(true);
  });
});
