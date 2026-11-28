import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const SECRET = 'whsec_super_secret_value_123';
const hmac = (secret: string, message: string) => createHmac('sha256', secret).update(message).digest('hex');

describe('Signature verification (end to end)', () => {
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

  const http = () => request(app.getHttpServer());
  beforeEach(async () => {
    slug = (await http().post('/api/endpoints').expect(201)).body.slug;
  });

  const configure = (provider: string, secret: string = SECRET, s = slug) =>
    http().put(`/api/endpoints/${s}/signing`).send({ provider, secret });
  const send = (headers: Record<string, string>, body: string) =>
    http().post(`/h/${slug}`).set(headers).set('content-type', 'application/json').send(body);
  const latest = async () => (await http().get(`/api/endpoints/${slug}/requests`).expect(200)).body[0];

  describe('configuration', () => {
    it('starts unconfigured, can be set, read back and cleared', async () => {
      expect((await http().get(`/api/endpoints/${slug}/signing`).expect(200)).body).toEqual({ configured: false });
      expect((await configure('github').expect(200)).body).toEqual({ configured: true, provider: 'github' });
      expect((await http().get(`/api/endpoints/${slug}/signing`).expect(200)).body).toEqual({
        configured: true, provider: 'github',
      });
      await http().delete(`/api/endpoints/${slug}/signing`).expect(204);
      expect((await http().get(`/api/endpoints/${slug}/signing`).expect(200)).body).toEqual({ configured: false });
    });

    it('can switch provider and secret', async () => {
      await configure('github').expect(200);
      expect((await configure('stripe', 'other').expect(200)).body.provider).toBe('stripe');
    });

    it('never returns the secret, from any endpoint', async () => {
      const put = await configure('github');
      const get = await http().get(`/api/endpoints/${slug}/signing`);
      await send({ 'x-hub-signature-256': 'sha256=' + hmac(SECRET, '{}') }, '{}');
      const list = await http().get(`/api/endpoints/${slug}/requests`);
      for (const res of [put, get, list]) expect(JSON.stringify(res.body) + res.text).not.toContain(SECRET);
    });

    it('trims whitespace around a pasted secret', async () => {
      await configure('github', `  ${SECRET}\n`).expect(200);
      const body = '{"a":1}';
      await send({ 'x-hub-signature-256': 'sha256=' + hmac(SECRET, body) }, body);
      expect((await latest()).signature.status).toBe('valid');
    });

    it('answers 404 for an unknown endpoint', async () => {
      await configure('github', SECRET, 'nope').expect(404);
      await http().get('/api/endpoints/nope/signing').expect(404);
      await http().delete('/api/endpoints/nope/signing').expect(404);
    });

    it.each([
      ['an unknown provider', { provider: 'paypal', secret: 'x' }],
      ['a missing provider', { secret: 'x' }],
      ['a non-string provider', { provider: 5, secret: 'x' }],
      ['a prototype-style provider name', { provider: 'constructor', secret: 'x' }],
      ['a missing secret', { provider: 'github' }],
      ['a non-string secret', { provider: 'github', secret: 123 }],
      ['an empty secret', { provider: 'github', secret: '' }],
      ['a whitespace-only secret', { provider: 'github', secret: '  \n ' }],
      ['an over-long secret', { provider: 'github', secret: 'x'.repeat(513) }],
    ])('answers 400 for %s', async (_label, payload) => {
      const res = await http().put(`/api/endpoints/${slug}/signing`).send(payload).expect(400);
      expect(res.body.message).toBeTruthy();
      expect((await http().get(`/api/endpoints/${slug}/signing`)).body).toEqual({ configured: false });
    });

    it('a rejected update leaves the previous configuration in place', async () => {
      await configure('github').expect(200);
      await http().put(`/api/endpoints/${slug}/signing`).send({ provider: 'github', secret: '' }).expect(400);
      expect((await http().get(`/api/endpoints/${slug}/signing`)).body.configured).toBe(true);
    });

    it('keeps endpoints separate', async () => {
      const other = (await http().post('/api/endpoints')).body.slug;
      await configure('github');
      expect((await http().get(`/api/endpoints/${other}/signing`)).body).toEqual({ configured: false });
    });
  });

  describe('checking captured requests', () => {
    it('adds no signature field when nothing is configured', async () => {
      await send({}, '{}');
      expect(await latest()).not.toHaveProperty('signature');
    });

    it('GitHub: valid, tampered, wrong secret and missing', async () => {
      await configure('github');
      const body = '{ "action":  "opened" }'; // odd spacing on purpose: the signature covers the exact bytes
      const good = 'sha256=' + hmac(SECRET, body);

      await send({ 'x-hub-signature-256': good }, body);
      expect((await latest()).signature).toEqual({ provider: 'github', status: 'valid' });

      await send({ 'x-hub-signature-256': good }, '{"action":"opened"}'); // same JSON, different bytes
      expect((await latest()).signature.status).toBe('invalid');

      await send({ 'x-hub-signature-256': 'sha256=' + hmac('wrong', body) }, body);
      expect((await latest()).signature.status).toBe('invalid');

      await send({}, body);
      expect((await latest()).signature.status).toBe('missing');
    });

    it('Stripe: valid with several signatures, invalid when the timestamp is altered', async () => {
      await configure('stripe');
      const body = '{"id":"evt_9"}';
      const t = '1700000000';
      const v1 = hmac(SECRET, `${t}.${body}`);

      await send({ 'stripe-signature': `t=${t},v1=${'0'.repeat(64)},v1=${v1}` }, body);
      expect((await latest()).signature.status).toBe('valid');

      await send({ 'stripe-signature': `t=1700000001,v1=${v1}` }, body);
      expect((await latest()).signature.status).toBe('invalid');
    });

    it('Slack: valid, and invalid without the timestamp header', async () => {
      await configure('slack');
      const body = 'token=abc&team_id=T1';
      const t = '1531420618';
      const sig = 'v0=' + hmac(SECRET, `v0:${t}:${body}`);

      await http().post(`/h/${slug}`).set({ 'x-slack-signature': sig, 'x-slack-request-timestamp': t })
        .set('content-type', 'application/x-www-form-urlencoded').send(body);
      expect((await latest()).signature.status).toBe('valid');

      await http().post(`/h/${slug}`).set({ 'x-slack-signature': sig })
        .set('content-type', 'application/x-www-form-urlencoded').send(body);
      expect((await latest()).signature.status).toBe('invalid');
    });

    it('re-checks stored requests when the secret changes', async () => {
      await configure('github');
      const body = '{"x":1}';
      await send({ 'x-hub-signature-256': 'sha256=' + hmac(SECRET, body) }, body);
      expect((await latest()).signature.status).toBe('valid');

      await configure('github', 'a-different-secret');
      expect((await latest()).signature.status).toBe('invalid');

      await http().delete(`/api/endpoints/${slug}/signing`).expect(204);
      expect(await latest()).not.toHaveProperty('signature');
    });

    it('does not change what is captured or how the capture URL answers', async () => {
      await configure('github');
      const body = '{ "keep":   "exactly" }';
      const res = await send({ 'x-hub-signature-256': 'sha256=bad' }, body).expect(200); // invalid signatures are still accepted
      expect(res.body.ok).toBe(true);
      expect((await latest()).body).toBe(body);
    });
  });

  describe('live stream', () => {
    it('includes the result but never the secret', async () => {
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      await configure('github');

      const controller = new AbortController();
      const stream = await fetch(`${base}/api/endpoints/${slug}/stream`, { signal: controller.signal });
      const reader = stream.body!.getReader();

      const body = '{"live":true}';
      await fetch(`${base}/h/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + hmac(SECRET, body) },
        body,
      });

      let text = '';
      const decoder = new TextDecoder();
      while (!text.includes('\n\n')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      controller.abort();

      const event = JSON.parse(text.split('data: ')[1].split('\n')[0]);
      expect(event.signature).toEqual({ provider: 'github', status: 'valid' });
      expect(text).not.toContain(SECRET);
    });
  });
});
