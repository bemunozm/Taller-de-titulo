import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { CamerasModule } from 'src/cameras/cameras.module';
import { MediamtxModule } from 'src/mediamtx/mediamtx.module';

@Module({
  // Fase 4 · P6.M: MediamtxModule para esperar el stream tras re-registrar
  // una cámara que MediaMTX perdió al reiniciarse.
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([User]),
    CamerasModule,
    MediamtxModule,
  ],
  controllers: [StreamsController],
  providers: [StreamsService],
  exports: [StreamsService],
})
export class StreamsModule {}
