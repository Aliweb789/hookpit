import { Module } from '@nestjs/common';
import { SigningController } from './signing.controller';
import { SigningService } from './signing.service';

@Module({
  controllers: [SigningController],
  providers: [SigningService],
  exports: [SigningService], // the capture controller adds results to what it returns
})
export class SigningModule {}
