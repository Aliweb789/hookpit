import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Mock responses (end to end)', () => {
  let app: NestExpressApplication;
  let slug: string;

  beforeAll(async () => {
    process.env.HOOKPIT_DB = ':memory:';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    slug = (await request(app.getHttpServer()).post('/api/endpoints')).body.slug;
  });

  const http = () => request(app.getHttpServer());
  const addMock = (rule: object, s = slug) => http().post(`/api/endpoints/${s}/mocks`).send(rule);

  describe('management API', () => {
    it('creates, lists, updates and deletes a rule', async () => {
      const created = await addMock({ method: 'GET', path: '/users/:id', status: 200, body: 'hi' }).expect(201);
      expect(created.body).toMatchObject({ method: 'GET', path: '/users/:id', status: 200, enabled: true });

      const list = await http().get(`/api/endpoints/${slug}/mocks`).expect(200);
      expect(list.body).toHaveLength(1);

      const updated = await http()
        .put(`/api/endpoints/${slug}/mocks/${created.body.id}`)
        .send({ method: 'GET', path: '/users/:id', status: 404, body: 'gone', enabled: false })
        .expect(200);
      expect(updated.body).toMatchObject({ status: 404, body: 'gone', enabled: false });

      await http().delete(`/api/endpoints/${slug}/mocks/${created.body.id}`).expect(204);
      expect((await http().get(`/api/endpoints/${slug}/mocks`)).body).toEqual([]);
    });

    it('answers 404 for an unknown endpoint or rule', async () => {
      await http().get('/api/endpoints/nope/mocks').expect(404);
      await addMock({ path: '/a' }, 'nope').expect(404);
      await http().put(`/api/endpoints/${slug}/mocks/nope`).send({ path: '/a' }).expect(404);
      await http().delete(`/api/endpoints/${slug}/mocks/nope`).expect(404);
    });

    it.each([
      ['a bad status', { path: '/a', status: 99 }],
      ['a missing path', { status: 200 }],
      ['a forbidden header', { path: '/a', headers: { 'Set-Cookie': 'a=b' } }],
      ['header injection', { path: '/a', headers: { 'x-a': 'v\r\nx-b: 1' } }],
      ['a delay over the cap', { path: '/a', delayMs: 60000 }],
    ])('answers 400 for %s', async (_label, rule) => {
      const res = await addMock(rule).expect(400);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('serving a mock from the capture URL', () => {
    it('answers with the configured status, headers and body', async () => {
      await addMock({
        method: 'GET', path: '/teapot', status: 418,
        headers: { 'Content-Type': 'application/json', 'X-Custom': 'yes' }, body: '{"tea":true}',
      });
      const res = await http().get(`/h/${slug}/teapot`).expect(418);
      expect(res.headers['x-custom']).toBe('yes');
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.text).toBe('{"tea":true}');
    });

    it('fills params and the request into the body', async () => {
      await addMock({
        method: 'POST', path: '/users/:id', status: 201,
        body: '{"id":"{{params.id}}","name":"{{request.json.name}}","page":"{{request.query.page}}","sig":"{{request.headers.x-sig}}"}',
      });
      const res = await http()
        .post(`/h/${slug}/users/42?page=3`)
        .set('Content-Type', 'application/json')
        .set('X-Sig', 'abc')
        .send('{"name":"Ada"}')
        .expect(201);
      expect(JSON.parse(res.text)).toEqual({ id: '42', name: 'Ada', page: '3', sig: 'abc' });
    });

    it('generates fresh values for {{uuid}} on every request', async () => {
      await addMock({ path: '/id', body: '{{uuid}}' });
      const a = (await http().get(`/h/${slug}/id`)).text;
      const b = (await http().get(`/h/${slug}/id`)).text;
      expect(a).toMatch(/^[0-9a-f-]{36}$/);
      expect(a).not.toBe(b);
    });

    it('still records the request, so it appears in the dashboard list', async () => {
      await addMock({ path: '/hello', status: 200, body: 'mocked' });
      await http().post(`/h/${slug}/hello`).send('payload').expect(200);
      const { body } = await http().get(`/api/endpoints/${slug}/requests`);
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ method: 'POST', path: '/hello', body: 'payload' });
    });

    it('falls back to the default reply when nothing matches', async () => {
      await addMock({ method: 'GET', path: '/only-get' });
      const res = await http().post(`/h/${slug}/only-get`).expect(200); // wrong method
      expect(res.body.ok).toBe(true);
      const other = await http().get(`/h/${slug}/other`).expect(200); // wrong path
      expect(other.body.ok).toBe(true);
    });

    it('ignores disabled rules', async () => {
      await addMock({ path: '/a', status: 500, enabled: false });
      const res = await http().get(`/h/${slug}/a`).expect(200);
      expect(res.body.ok).toBe(true);
    });

    it('uses the first matching rule', async () => {
      await addMock({ path: '/users/me', status: 200, body: 'me' });
      await addMock({ path: '/users/:id', status: 200, body: 'someone' });
      expect((await http().get(`/h/${slug}/users/me`)).text).toBe('me');
      expect((await http().get(`/h/${slug}/users/7`)).text).toBe('someone');
    });

    it('supports a wildcard path and any method', async () => {
      await addMock({ path: '/api/*', status: 202, body: 'wild' });
      for (const verb of ['get', 'post', 'delete'] as const) {
        const res = await http()[verb](`/h/${slug}/api/v1/things/9`).expect(202);
        expect(res.text).toBe('wild');
      }
    });

    it("never applies one endpoint's rules to another", async () => {
      await addMock({ path: '/a', status: 500 });
      const other = (await http().post('/api/endpoints')).body.slug;
      await http().get(`/h/${other}/a`).expect(200);
    });

    it('delays the response by the configured time', async () => {
      await addMock({ path: '/slow', delayMs: 150, body: 'late' });
      const started = Date.now();
      const res = await http().get(`/h/${slug}/slow`).expect(200);
      expect(Date.now() - started).toBeGreaterThanOrEqual(140);
      expect(res.text).toBe('late');
    });

    it('sends no body for 204 and HEAD', async () => {
      await addMock({ path: '/none', status: 204, body: 'ignored' });
      const res = await http().get(`/h/${slug}/none`).expect(204);
      expect(res.text).toBeFalsy();
      await addMock({ path: '/page', status: 201, headers: { 'X-Mock': 'head' }, body: 'content' }); // matches any method
      const head = await http().head(`/h/${slug}/page`).expect(201); // the mock itself answered HEAD
      expect(head.headers['x-mock']).toBe('head');
      expect(head.text).toBeFalsy();
    });

    it('chooses a content type when the rule gives none', async () => {
      await addMock({ path: '/json', body: '{"a":1}' });
      await addMock({ path: '/text', body: 'just text' });
      expect((await http().get(`/h/${slug}/json`)).headers['content-type']).toContain('application/json');
      expect((await http().get(`/h/${slug}/text`)).headers['content-type']).toContain('text/plain');
    });

    it('supports redirects through a Location header', async () => {
      await addMock({ path: '/old', status: 302, headers: { Location: '/new' } });
      const res = await http().get(`/h/${slug}/old`).redirects(0).expect(302);
      expect(res.headers.location).toBe('/new');
    });
  });

  describe('safety of served mocks', () => {
    it('forces nosniff and a sandboxing CSP, even for HTML with a script', async () => {
      await addMock({
        path: '/evil', headers: { 'Content-Type': 'text/html' },
        body: '<script>document.title="pwned"</script>',
      });
      const res = await http().get(`/h/${slug}/evil`).expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain('sandbox');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('tags the response with the matching rule id for debugging', async () => {
      const rule = (await addMock({ path: '/x' })).body;
      expect((await http().get(`/h/${slug}/x`)).headers['x-hookpit-mock']).toBe(rule.id);
    });

    it('cannot be used to inject headers through request data', async () => {
      await addMock({ path: '/inj', headers: { 'x-echo': '{{request.query.v}}' }, body: '{{request.query.v}}' });
      const res = await http().get(`/h/${slug}/inj?v=a%0d%0aSet-Cookie:%20hacked=1`).expect(200);
      expect(res.headers['x-echo']).toBe('{{request.query.v}}'); // headers are never templated
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('does not let templates read internals', async () => {
      await addMock({ path: '/p', body: '[{{constructor.constructor}}][{{process.env.HOME}}][{{__proto__}}]' });
      expect((await http().get(`/h/${slug}/p`)).text).toBe('[][][]');
    });
  });
});
