import { Module } from '@nestjs/common';
import { CaptureModule } from './capture/capture.module';
import { DbModule } from './db/db.module';
import { ReplayModule } from './replay/replay.module';

@Module({ imports: [DbModule, CaptureModule, ReplayModule] })
export class AppModule {}
