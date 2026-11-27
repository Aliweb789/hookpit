import { CaptureService } from '../capture/capture.service';
import { DbService } from '../db/db.service';
import {
  MAX_BODY_BYTES,
  MAX_DELAY_MS,
  MAX_RULES_PER_ENDPOINT,
  MockError,
  MocksService,
} from './mocks.service';

describe('MocksService', () => {
  let dbs: DbService;
  let service: MocksService;
  let slug: string;

  beforeEach(() => {
    process.env.HOOKPIT_DB = ':memory:';
    dbs = new DbService();
    slug = new CaptureService(dbs).createEndpoint().slug;
    service = new MocksService(dbs);
  });
  afterEach(() => dbs.onModuleDestroy());

  const invalid = (fn: () => unknown, message?: RegExp) => {
    let error: unknown;
    try { fn(); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(MockError);
    expect((error as MockError).code).toBe('invalid');
    if (message) expect((error as MockError).message).toMatch(message);
  };

  describe('create, update, list, delete', () => {
    it('creates a rule with sensible defaults', () => {
      const rule = service.create(slug, { path: '/ping' });
      expect(rule).toMatchObject({
        slug, method: '*', path: '/ping', status: 200, headers: {}, body: '', delayMs: 0, enabled: true, position: 1,
      });
      expect(rule.id).toBeTruthy();
    });

    it('stores every field and lowercases header names', () => {
      const rule = service.create(slug, {
        method: 'post', path: '/users/:id', status: 201,
        headers: { 'Content-Type': 'application/json', 'X-Mock': 'yes' },
        body: '{"id":"{{params.id}}"}', delayMs: 250, enabled: false,
      });
      expect(rule).toMatchObject({
        method: 'POST', status: 201, delayMs: 250, enabled: false,
        headers: { 'content-type': 'application/json', 'x-mock': 'yes' },
        body: '{"id":"{{params.id}}"}',
      });
    });

    it('lists rules in creation order', () => {
      service.create(slug, { path: '/a' });
      service.create(slug, { path: '/b' });
      service.create(slug, { path: '/c' });
      expect(service.list(slug).map((r) => r.path)).toEqual(['/a', '/b', '/c']);
    });

    it('updates all editable fields and keeps id and position', () => {
      const created = service.create(slug, { path: '/a', status: 200 });
      const updated = service.update(slug, created.id, { path: '/b', status: 404, body: 'nope', enabled: false });
      expect(updated).toMatchObject({ id: created.id, position: created.position, path: '/b', status: 404, body: 'nope', enabled: false });
    });

    it('deletes a rule', () => {
      const rule = service.create(slug, { path: '/a' });
      service.remove(slug, rule.id);
      expect(service.list(slug)).toEqual([]);
    });

    it('answers not_found for unknown endpoints and rules', () => {
      const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as MockError).code; } };
      expect(code(() => service.list('nope'))).toBe('not_found');
      expect(code(() => service.create('nope', { path: '/a' }))).toBe('not_found');
      expect(code(() => service.update(slug, 'nope', { path: '/a' }))).toBe('not_found');
      expect(code(() => service.remove(slug, 'nope'))).toBe('not_found');
    });

    it("cannot touch another endpoint's rule", () => {
      const other = new CaptureService(dbs).createEndpoint().slug;
      const rule = service.create(slug, { path: '/a' });
      const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as MockError).code; } };
      expect(code(() => service.update(other, rule.id, { path: '/x' }))).toBe('not_found');
      expect(code(() => service.remove(other, rule.id))).toBe('not_found');
      expect(service.list(slug)).toHaveLength(1);
    });
  });

  describe('matching', () => {
    it('returns the first enabled rule that matches, in order', () => {
      service.create(slug, { path: '/users/me', body: 'specific' });
      service.create(slug, { path: '/users/:id', body: 'generic' });
      expect(service.findMatch(slug, 'GET', '/users/me')?.rule.body).toBe('specific');
      expect(service.findMatch(slug, 'GET', '/users/7')?.rule.body).toBe('generic');
    });

    it('skips disabled rules', () => {
      service.create(slug, { path: '/a', body: 'off', enabled: false });
      service.create(slug, { path: '/a', body: 'on' });
      expect(service.findMatch(slug, 'GET', '/a')?.rule.body).toBe('on');
    });

    it('honours the method, and * matches any method', () => {
      service.create(slug, { method: 'POST', path: '/a', body: 'post-only' });
      expect(service.findMatch(slug, 'GET', '/a')).toBeUndefined();
      expect(service.findMatch(slug, 'post', '/a')?.rule.body).toBe('post-only');
      service.create(slug, { path: '/b' });
      for (const m of ['GET', 'PUT', 'DELETE']) expect(service.findMatch(slug, m, '/b')).toBeDefined();
    });

    it('returns the captured params', () => {
      service.create(slug, { path: '/users/:id/orders/:orderId' });
      expect(service.findMatch(slug, 'GET', '/users/4/orders/9')?.params).toEqual({ id: '4', orderId: '9' });
    });

    it('returns nothing when no rule matches or the endpoint has no rules', () => {
      expect(service.findMatch(slug, 'GET', '/x')).toBeUndefined();
      service.create(slug, { path: '/a' });
      expect(service.findMatch(slug, 'GET', '/x')).toBeUndefined();
    });

    it("never matches another endpoint's rules", () => {
      const other = new CaptureService(dbs).createEndpoint().slug;
      service.create(other, { path: '/a' });
      expect(service.findMatch(slug, 'GET', '/a')).toBeUndefined();
    });
  });

  describe('render', () => {
    const req = (over = {}) => ({ method: 'POST', path: '/users/4', query: { v: '2' }, headers: { 'x-id': 'h1' }, body: '{"name":"Ada"}', ...over });

    it('fills the body from params and the request', () => {
      service.create(slug, { path: '/users/:id', body: '{"id":"{{params.id}}","name":"{{request.json.name}}","v":"{{request.query.v}}"}' });
      const match = service.findMatch(slug, 'POST', '/users/4')!;
      expect(service.render(match, req()).body).toBe('{"id":"4","name":"Ada","v":"2"}');
    });

    it('renders {{request.json...}} as empty when the request body is not JSON', () => {
      service.create(slug, { path: '/a', body: '[{{request.json.name}}]' });
      const match = service.findMatch(slug, 'POST', '/a')!;
      expect(service.render(match, req({ body: 'plain text' })).body).toBe('[]');
    });

    it('never templates headers, so request data cannot inject header values', () => {
      service.create(slug, { path: '/a', headers: { 'x-echo': '{{request.query.v}}' } });
      const match = service.findMatch(slug, 'GET', '/a')!;
      expect(service.render(match, req()).headers['x-echo']).toBe('{{request.query.v}}');
    });
  });

  describe('validation', () => {
    it.each([null, 'text', 42, [], undefined])('rejects a non-object payload %p', (v) =>
      invalid(() => service.create(slug, v as any)));

    it.each([
      ['missing path', {}],
      ['path without slash', { path: 'users' }],
      ['wildcard in the middle', { path: '/*/x' }],
      ['bad method', { path: '/a', method: 'TRACE' }],
      ['status below 200', { path: '/a', status: 199 }],
      ['status above 599', { path: '/a', status: 600 }],
      ['non-integer status', { path: '/a', status: 200.5 }],
      ['status as text', { path: '/a', status: '200' }],
      ['negative delay', { path: '/a', delayMs: -1 }],
      ['delay over the cap', { path: '/a', delayMs: MAX_DELAY_MS + 1 }],
      ['body not a string', { path: '/a', body: { a: 1 } }],
      ['body too large', { path: '/a', body: 'x'.repeat(MAX_BODY_BYTES + 1) }],
      ['enabled not boolean', { path: '/a', enabled: 'yes' }],
      ['headers not an object', { path: '/a', headers: ['a'] }],
      ['too many headers', { path: '/a', headers: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`x-h${i}`, 'v'])) }],
    ])('rejects %s', (_label, payload) => invalid(() => service.create(slug, payload as any)));

    it('accepts the largest allowed delay and body', () => {
      expect(() => service.create(slug, { path: '/a', delayMs: MAX_DELAY_MS, body: 'x'.repeat(MAX_BODY_BYTES) })).not.toThrow();
    });

    describe('response headers', () => {
      it.each([
        'content-length', 'Transfer-Encoding', 'content-encoding', 'connection', 'keep-alive', 'upgrade',
        'Set-Cookie', 'set-cookie2', 'Content-Security-Policy', 'x-content-type-options',
      ])('forbids %s', (name) => invalid(() => service.create(slug, { path: '/a', headers: { [name]: 'x' } }), /cannot be set/));

      it.each([
        ['CR LF injection', 'ok\r\nSet-Cookie: a=b'],
        ['bare LF', 'ok\nx'],
        ['NUL byte', 'ok\0x'],
        ['too long', 'x'.repeat(1001)],
      ])('rejects a header value with %s', (_label, value) =>
        invalid(() => service.create(slug, { path: '/a', headers: { 'x-test': value } })));

      it.each(['bad name', 'bad:name', 'bad\r\nname', '', 'näme'])('rejects the header name %p', (name) =>
        invalid(() => service.create(slug, { path: '/a', headers: { [name]: 'v' } })));

      it('allows ordinary headers such as Location and Cache-Control', () => {
        expect(() => service.create(slug, { path: '/a', status: 302, headers: { Location: '/elsewhere', 'Cache-Control': 'no-store' } })).not.toThrow();
      });
    });

    it('limits the number of rules per endpoint', () => {
      for (let i = 0; i < MAX_RULES_PER_ENDPOINT; i++) service.create(slug, { path: `/r${i}` });
      invalid(() => service.create(slug, { path: '/one-too-many' }), /at most/);
    });

    it('does not change a rule when an update is invalid', () => {
      const rule = service.create(slug, { path: '/a', status: 200 });
      invalid(() => service.update(slug, rule.id, { path: '/a', status: 999 }));
      expect(service.list(slug)[0].status).toBe(200);
    });
  });
});
