import { Module } from '@nestjs/common';
import { CaptureModule } from './capture/capture.module';
import { DbModule } from './db/db.module';

@Module({ imports: [DbModule, CaptureModule] })
export class AppModule {}
