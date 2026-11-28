import { Module } from '@nestjs/common';
import { MocksModule } from '../mocks/mocks.module';
import { SigningModule } from '../signing/signing.module';
import { CaptureController } from './capture.controller';
import { CaptureService } from './capture.service';

@Module({
  imports: [MocksModule, SigningModule],
  controllers: [CaptureController],
  providers: [CaptureService],
  exports: [CaptureService], // the replay module reads stored requests
})
export class CaptureModule {}
