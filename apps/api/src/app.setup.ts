import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';

// Shared by main.ts (production) and the e2e tests, so tests exercise the
// exact same raw-body behaviour that real users get.
export function configureApp(app: NestExpressApplication) {
  // Keep every body under /h/* as a raw Buffer, whatever its content type.
  app.use('/h', express.raw({ type: () => true, limit: '1mb' }));

  // The dashboard (a different origin in dev) needs permission to call us.
  app.enableCors();
}
