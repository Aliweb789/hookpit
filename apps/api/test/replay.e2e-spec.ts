import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Replay API (end to end)', () => {
  let app: NestExpressApplication;
  let target: http.Server;
  let targetUrl: string;
  let slug: string;
  let id: string;
  let received: { method?: string; body: string }[];

  beforeAll(async () => {
    target = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push({ method: req.method, body: Buffer.concat(chunks).toString() });
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('pong');
      });
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/webhook`;

    process.env.HOOKPIT_DB = ':memory:';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => target.close(r));
  });

  beforeEach(async () => {
    received = [];
    delete process.env.HOOKPIT_ALLOW_PRIVATE_TARGETS;
    slug = (await request(app.getHttpServer()).post('/api/endpoints')).body.slug;
    await request(app.getHttpServer())
      .post(`/h/${slug}/orders`)
      .set('Content-Type', 'application/json')
      .send('{"order":42}')
      .expect(200);
    id = (await request(app.getHttpServer()).get(`/api/endpoints/${slug}/requests`)).body[0].id;
  });

  const replay = (body: object, rid = id, s = slug) =>
    request(app.getHttpServer()).post(`/api/endpoints/${s}/requests/${rid}/replay`).send(body);

  it('replays a captured request to a target and returns its response', async () => {
    process.env.HOOKPIT_ALLOW_PRIVATE_TARGETS = 'true';
    const res = await replay({ url: targetUrl }).expect(200);

    expect(res.body).toMatchObject({ status: 200, body: 'pong', bodyTruncated: false });
    expect(received).toEqual([{ method: 'POST', body: '{"order":42}' }]);
  });

  it('lets you edit the body before replaying', async () => {
    process.env.HOOKPIT_ALLOW_PRIVATE_TARGETS = 'true';
    await replay({ url: targetUrl, body: '{"order":43}' }).expect(200);
    expect(received[0].body).toBe('{"order":43}');
  });

  it('answers 403 and sends nothing when the target is internal (default)', async () => {
    const res = await replay({ url: targetUrl }).expect(403);
    expect(res.body.message).toContain('HOOKPIT_ALLOW_PRIVATE_TARGETS');
    expect(received).toHaveLength(0);
  });

  it('answers 400 for a bad url or scheme', async () => {
    await replay({ url: 'file:///etc/passwd' }).expect(400);
    await replay({}).expect(400);
  });

  it('answers 404 for an unknown request id', async () => {
    await replay({ url: targetUrl }, 'does-not-exist').expect(404);
  });

  it('answers 502 when the target refuses the connection', async () => {
    process.env.HOOKPIT_ALLOW_PRIVATE_TARGETS = 'true';
    await replay({ url: 'http://127.0.0.1:1/' }).expect(502);
  });
});
