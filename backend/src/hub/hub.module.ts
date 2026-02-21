import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { HubGateway } from './hub.gateway';
import { Hub } from './entities/hub.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Hub]),
    ConfigModule,
  ],
  providers: [HubGateway],
  exports: [HubGateway],
})
export class HubModule {}
