import { Module } from '@nestjs/common';
import { CaptureModule } from '../capture/capture.module';
import { ReplayController } from './replay.controller';
import { ReplayService } from './replay.service';

@Module({
  imports: [CaptureModule],
  controllers: [ReplayController],
  providers: [ReplayService],
})
export class ReplayModule {}
