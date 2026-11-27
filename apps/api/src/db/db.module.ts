import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

@Global() // available everywhere without re-importing
@Module({ providers: [DbService], exports: [DbService] })
export class DbModule {}
