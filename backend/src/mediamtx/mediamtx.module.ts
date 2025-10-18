import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MediamtxService } from './mediamtx.service';

@Module({
  imports: [HttpModule],
  providers: [MediamtxService],
  exports: [MediamtxService],
})
export class MediamtxModule {}
