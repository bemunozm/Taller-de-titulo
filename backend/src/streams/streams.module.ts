import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { CamerasModule } from 'src/cameras/cameras.module';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([User]), CamerasModule],
  controllers: [StreamsController],
  providers: [StreamsService],
  exports: [StreamsService],
})
export class StreamsModule {}
