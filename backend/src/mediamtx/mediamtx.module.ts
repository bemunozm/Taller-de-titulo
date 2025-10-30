import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MediamtxService } from './mediamtx.service';
import { MediamtxController } from './mediamtx.controller';

@Module({
  imports: [HttpModule],
  providers: [MediamtxService],
  controllers: [MediamtxController],
  exports: [MediamtxService],
})
export class MediamtxModule {}
