import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefijo global para las rutas de la API
  app.setGlobalPrefix('api/v1');

  // Configuración global de validación
  // Agrega validadores a los DTOs y transforma los tipos automáticamente
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Elimina propiedades no definidas en el DTO
    forbidNonWhitelisted: true, // Lanza un error si se reciben propiedades no definidas
    transform: true, // Transforma automáticamente los tipos de datos
  }));


  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
