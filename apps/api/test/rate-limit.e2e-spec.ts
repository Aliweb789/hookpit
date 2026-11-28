import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { rateLimit } from '../src/rate-limit';

async function startApp(env: Record<string, string>) {
  process.env.HOOKPIT_DB = ':memory:';
  Object.assign(process.env, env);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}

describe('Rate limiting (end to end)', () => {
  const keys = ['HOOKPIT_REPLAY_RATE_LIMIT', 'HOOKPIT_CAPTURE_RATE_LIMIT', 'HOOKPIT_RATE_WINDOW_MS'];
  afterEach(() => keys.forEach((k) => delete process.env[k]));

  it('answers 429 with Retry-After once capture goes over the limit, per slug', async () => {
    const app = await startApp({ HOOKPIT_CAPTURE_RATE_LIMIT: '3', HOOKPIT_RATE_WINDOW_MS: '60000' });
    try {
      const a = (await request(app.getHttpServer()).post('/api/endpoints')).body.slug;
      const b = (await request(app.getHttpServer()).post('/api/endpoints')).body.slug;
      for (let i = 0; i < 3; i++) await request(app.getHttpServer()).post(`/h/${a}`).send('x').expect(200);

      const limited = await request(app.getHttpServer()).post(`/h/${a}`).send('x').expect(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(limited.body.ok).toBe(false);

      // Another endpoint is not affected.
      await request(app.getHttpServer()).post(`/h/${b}`).send('x').expect(200);
      // Nothing over the limit was stored.
      const stored = await request(app.getHttpServer()).get(`/api/endpoints/${a}/requests`);
      expect(stored.body).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it('limits replay per client and leaves reading requests alone', async () => {
    const app = await startApp({ HOOKPIT_REPLAY_RATE_LIMIT: '2' });
    try {
      const slug = (await request(app.getHttpServer()).post('/api/endpoints')).body.slug;
      await request(app.getHttpServer()).post(`/h/${slug}`).send('{}').expect(200);
      const id = (await request(app.getHttpServer()).get(`/api/endpoints/${slug}/requests`)).body[0].id;
      const replay = () =>
        request(app.getHttpServer()).post(`/api/endpoints/${slug}/requests/${id}/replay`).send({ url: 'http://127.0.0.1:1/' });

      // Blocked by the SSRF guard (403), but each attempt still counts against the limit.
      await replay().expect(403);
      await replay().expect(403);
      const limited = await replay().expect(429);
      expect(limited.headers['retry-after']).toBeDefined();

      await request(app.getHttpServer()).get(`/api/endpoints/${slug}/requests`).expect(200);
    } finally {
      await app.close();
    }
  });

  it('can be switched off with a limit of 0', async () => {
    const app = await startApp({ HOOKPIT_CAPTURE_RATE_LIMIT: '0' });
    try {
      const slug = (await request(app.getHttpServer()).post('/api/endpoints')).body.slug;
      for (let i = 0; i < 10; i++) await request(app.getHttpServer()).post(`/h/${slug}`).send('x').expect(200);
    } finally {
      await app.close();
    }
  });
});

describe('rateLimit window', () => {
  it('lets requests through again once the window has passed', () => {
    jest.useFakeTimers();
    try {
      const limiter = rateLimit({ windowMs: 1000, max: 1, key: () => 'k' });
      const res = () => {
        const r: { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock } = {
          status: jest.fn(), json: jest.fn(), setHeader: jest.fn(),
        };
        r.status.mockReturnValue(r);
        return r;
      };
      const next = jest.fn();

      limiter({} as never, res() as never, next);
      expect(next).toHaveBeenCalledTimes(1);

      const blocked = res();
      limiter({} as never, blocked as never, next);
      expect(blocked.status).toHaveBeenCalledWith(429);
      expect(next).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1001);
      limiter({} as never, res() as never, next);
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
