import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { envInt, rateLimit } from './rate-limit';

// Shared by main.ts (production) and the e2e tests, so tests exercise the
// exact same raw-body behaviour that real users get.
export function configureApp(app: NestExpressApplication) {
  // Behind a reverse proxy the client IP is in X-Forwarded-For. Opt in with
  // HOOKPIT_TRUST_PROXY (a hop count such as 1, or true) so req.ip is the real client.
  const trustProxy = process.env.HOOKPIT_TRUST_PROXY;
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true');

  // Rate limits. Set a limit to 0 to switch it off. The defaults leave normal local use alone.
  const windowMs = envInt('HOOKPIT_RATE_WINDOW_MS', 60_000);
  const replayMax = envInt('HOOKPIT_REPLAY_RATE_LIMIT', 30);
  const captureMax = envInt('HOOKPIT_CAPTURE_RATE_LIMIT', 600);
  const replayLimiter = rateLimit({ windowMs, max: replayMax, key: (req) => `replay:${req.ip ?? ''}` });
  const captureLimiter = rateLimit({
    windowMs,
    max: captureMax,
    key: (req) => `capture:${req.params.slug ?? ''}:${req.ip ?? ''}`,
  });
  app.use('/api/endpoints/:slug/requests/:id/replay', (req: Request, res: Response, next: NextFunction) =>
    req.method === 'POST' ? replayLimiter(req, res, next) : next(),
  );
  app.use('/h/:slug', captureLimiter);

  // Keep every body under /h/* as a raw Buffer, whatever its content type.
  app.use('/h', express.raw({ type: () => true, limit: '1mb' }));

  // The management API (/api/*) speaks normal JSON.
  app.use('/api', express.json({ limit: '1mb' }));

  // The dashboard (a different origin in dev) needs permission to call us.
  app.enableCors();
}
