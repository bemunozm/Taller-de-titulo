import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LogsService } from './logs.service';
import { LogsController } from './logs.controller';
import { SystemLog } from './entities/system-log.entity';
import { User } from '../users/entities/user.entity';

@Global() // Hace el módulo global para que LogsService esté disponible en toda la app
@Module({
  imports: [TypeOrmModule.forFeature([SystemLog, User])],
  controllers: [LogsController],
  providers: [LogsService],
  exports: [LogsService], // Exportar para uso en otros módulos
})
export class LogsModule {}
