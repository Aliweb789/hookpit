import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Hookpit API (end to end)', () => {
  let app: NestExpressApplication;
  let slug: string;

  beforeAll(async () => {
    process.env.HOOKPIT_DB = ':memory:';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Same options as main.ts: no automatic body parsing.
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    const res = await request(app.getHttpServer()).post('/api/endpoints').expect(201);
    slug = res.body.slug;
  });

  it('POST /api/endpoints returns a slug', () => {
    expect(slug).toMatch(/^[0-9a-f]{12}$/);
  });

  it('captures a request and lists it', async () => {
    await request(app.getHttpServer())
      .post(`/h/${slug}/stripe/events?source=test`)
      .set('Content-Type', 'application/json')
      .set('X-Demo', 'hookpit')
      .send('{"type":"payment.succeeded"}')
      .expect(200)
      .expect((r) => expect(r.body.ok).toBe(true));

    const { body } = await request(app.getHttpServer())
      .get(`/api/endpoints/${slug}/requests`)
      .expect(200);

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      method: 'POST',
      path: '/stripe/events',
      query: { source: 'test' },
      body: '{"type":"payment.succeeded"}',
    });
    expect(body[0].headers['x-demo']).toBe('hookpit');
  });

  it('preserves the raw body byte for byte (no JSON re-formatting)', async () => {
    const raw = '{"amount":   4200,  "note":"two  spaces"}'; // odd spacing on purpose
    await request(app.getHttpServer())
      .post(`/h/${slug}`)
      .set('Content-Type', 'application/json')
      .send(raw)
      .expect(200);

    const { body } = await request(app.getHttpServer()).get(`/api/endpoints/${slug}/requests`);
    expect(body[0].body).toBe(raw);
  });

  it('keeps invalid JSON exactly as sent instead of rejecting it', async () => {
    const broken = '{"oops": ';
    await request(app.getHttpServer())
      .post(`/h/${slug}`)
      .set('Content-Type', 'application/json')
      .send(broken)
      .expect(200);

    const { body } = await request(app.getHttpServer()).get(`/api/endpoints/${slug}/requests`);
    expect(body[0].body).toBe(broken);
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)('accepts %s', async (method) => {
    const verb = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    await request(app.getHttpServer())[verb](`/h/${slug}/any/path`).expect(200);

    const { body } = await request(app.getHttpServer()).get(`/api/endpoints/${slug}/requests`);
    expect(body[0]).toMatchObject({ method, path: '/any/path' });
  });

  it('captures form-encoded bodies as text', async () => {
    await request(app.getHttpServer())
      .put(`/h/${slug}/users/7`)
      .type('form')
      .send({ name: 'Ali', role: 'admin' })
      .expect(200);

    const { body } = await request(app.getHttpServer()).get(`/api/endpoints/${slug}/requests`);
    expect(body[0].body).toBe('name=Ali&role=admin');
  });

  it('returns 404 for an unknown capture URL and stores nothing', async () => {
    await request(app.getHttpServer()).post('/h/unknownslug').send('x').expect(404);
  });

  it('returns 404 when listing or streaming an unknown endpoint', async () => {
    await request(app.getHttpServer()).get('/api/endpoints/unknownslug/requests').expect(404);
    await request(app.getHttpServer()).get('/api/endpoints/unknownslug/stream').expect(404);
  });

  it('rejects bodies larger than 1 MB', async () => {
    await request(app.getHttpServer())
      .post(`/h/${slug}`)
      .send('x'.repeat(1024 * 1024 + 10))
      .expect(413);
  });
});
