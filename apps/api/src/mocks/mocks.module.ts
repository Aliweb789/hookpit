import { Module } from '@nestjs/common';
import { MocksController } from './mocks.controller';
import { MocksService } from './mocks.service';

@Module({
  controllers: [MocksController],
  providers: [MocksService],
  exports: [MocksService], // the capture controller serves matching rules
})
export class MocksModule {}
