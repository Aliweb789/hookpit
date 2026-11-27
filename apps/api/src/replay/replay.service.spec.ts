import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CaptureService } from '../capture/capture.service';
import { DbService } from '../db/db.service';
import { ReplayError, ReplayService } from './replay.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const dns = require('node:dns'); // CommonJS object, so jest.spyOn can replace lookup

interface Seen { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }

describe('ReplayService', () => {
  let dbs: DbService;
  let captureService: CaptureService;
  let service: ReplayService;
  let slug: string;
  let requestId: string;

  // A tiny target server that records what it receives.
  let target: http.Server;
  let targetPort: number;
  let seen: Seen[];
  let handler: http.RequestListener;

  const defaultHandler: http.RequestListener = (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(201, { 'content-type': 'application/json', 'x-from': 'target' });
      res.end('{"received":true}');
    });
  };

  beforeAll(async () => {
    target = http.createServer((req, res) => handler(req, res));
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    targetPort = (target.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((r) => target.close(r)));

  beforeEach(() => {
    process.env.HOOKPIT_DB = ':memory:';
    delete process.env.HOOKPIT_ALLOW_PRIVATE_TARGETS;
    delete process.env.HOOKPIT_REPLAY_TIMEOUT_MS;
    seen = [];
    handler = defaultHandler;
    dbs = new DbService();
    captureService = new CaptureService(dbs);
    service = new ReplayService(captureService);
    slug = captureService.createEndpoint().slug;
    requestId = captureService.record({
      slug,
      method: 'POST',
      path: '/stripe/events',
      query: {},
      headers: {
        host: 'hookpit.example',
        'content-type': 'application/json',
        'content-length': '999', // deliberately wrong: must not be copied
        'x-signature': 'abc123',
      },
      body: '{"type":"payment.succeeded"}',
      bodySize: 28,
      ip: '::1',
    }).id;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    dbs.onModuleDestroy();
  });

  const url = () => `http://127.0.0.1:${targetPort}/hook?x=1`;
  const allowPrivate = () => (process.env.HOOKPIT_ALLOW_PRIVATE_TARGETS = 'true');
  const expectError = async (p: Promise<unknown>, code: string) => {
    await expect(p).rejects.toBeInstanceOf(ReplayError);
    await expect(p).rejects.toMatchObject({ code });
  };

  describe('when private targets are allowed (self-hosted use)', () => {
    beforeEach(allowPrivate);

    it('resends the original method, headers and body and returns the response', async () => {
      const result = await service.replay(slug, requestId, { url: url() });

      expect(seen).toHaveLength(1);
      expect(seen[0].method).toBe('POST');
      expect(seen[0].url).toBe('/hook?x=1');
      expect(seen[0].body).toBe('{"type":"payment.succeeded"}');
      expect(seen[0].headers['x-signature']).toBe('abc123');
      expect(seen[0].headers['content-type']).toBe('application/json');

      expect(result.status).toBe(201);
      expect(result.body).toBe('{"received":true}');
      expect(result.headers['x-from']).toBe('target');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('does not copy connection-specific headers (host, content-length)', async () => {
      await service.replay(slug, requestId, { url: url() });
      expect(seen[0].headers.host).toBe(`127.0.0.1:${targetPort}`); // not hookpit.example
      expect(seen[0].headers['content-length']).toBe(String(Buffer.byteLength('{"type":"payment.succeeded"}')));
    });

    it('lets the caller override method and body', async () => {
      await service.replay(slug, requestId, { url: url(), method: 'put', body: 'edited' });
      expect(seen[0].method).toBe('PUT');
      expect(seen[0].body).toBe('edited');
    });

    it('sends no body for GET', async () => {
      await service.replay(slug, requestId, { url: url(), method: 'GET' });
      expect(seen[0].method).toBe('GET');
      expect(seen[0].body).toBe('');
    });

    it('does NOT follow redirects, it returns the 3xx as is', async () => {
      handler = (_req, res) => {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      };
      const result = await service.replay(slug, requestId, { url: url() });
      expect(result.status).toBe(302);
      expect(result.headers.location).toBe('http://169.254.169.254/latest/meta-data/');
    });

    it('truncates very large responses to 1 MB', async () => {
      handler = (_req, res) => {
        res.writeHead(200);
        res.end('x'.repeat(2 * 1024 * 1024));
      };
      const result = await service.replay(slug, requestId, { url: url() });
      expect(result.bodyTruncated).toBe(true);
      expect(result.body.length).toBe(1024 * 1024);
    });

    it('times out when the target never answers', async () => {
      process.env.HOOKPIT_REPLAY_TIMEOUT_MS = '200';
      handler = () => { /* never respond */ };
      await expectError(service.replay(slug, requestId, { url: url() }), 'timeout');
    });

    it('reports a connection failure as a network error', async () => {
      await expectError(service.replay(slug, requestId, { url: 'http://127.0.0.1:1/' }), 'network');
    });
  });

  describe('when private targets are NOT allowed (default, public instance)', () => {
    it.each([
      ['loopback', 'http://127.0.0.1:8080/'],
      ['localhost by name', 'http://localhost:8080/'],
      ['IPv6 loopback', 'http://[::1]:8080/'],
      ['IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]:8080/'],
      ['cloud metadata service', 'http://169.254.169.254/latest/meta-data/'],
      ['private 10/8', 'http://10.0.0.5/admin'],
      ['private 192.168/16', 'http://192.168.1.1/'],
      ['decimal-encoded loopback', 'http://2130706433/'],
      ['hex-encoded loopback', 'http://0x7f000001/'],
      ['short-form loopback', 'http://127.1/'],
    ])('blocks %s', async (_label, target) => {
      await expectError(service.replay(slug, requestId, { url: target }), 'blocked');
      expect(seen).toHaveLength(0);
    });

    it('blocks a hostname that resolves to an internal address (DNS rebinding)', async () => {
      jest.spyOn(dns, 'lookup').mockImplementation(((_host: string, opts: any, cb: any) => {
        if (opts?.all) cb(null, [{ address: '127.0.0.1', family: 4 }]);
        else cb(null, '127.0.0.1', 4);
      }) as any);
      await expectError(
        service.replay(slug, requestId, { url: `http://totally-public.example:${targetPort}/` }),
        'blocked',
      );
      expect(seen).toHaveLength(0); // the connection was never made
    });

    it('blocks when ANY resolved address is internal', async () => {
      jest.spyOn(dns, 'lookup').mockImplementation(((_host: string, opts: any, cb: any) => {
        const list = [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ];
        if (opts?.all) cb(null, list);
        else cb(null, list[0].address, 4);
      }) as any);
      await expectError(service.replay(slug, requestId, { url: `http://mixed.example:${targetPort}/` }), 'blocked');
    });
  });

  describe('input validation (always enforced)', () => {
    beforeEach(allowPrivate); // proves these rules do not depend on the SSRF switch

    it.each([
      ['file://', 'file:///etc/passwd'],
      ['ftp://', 'ftp://example.com/'],
      ['javascript:', 'javascript:alert(1)'],
      ['gopher://', 'gopher://127.0.0.1:6379/'],
      ['credentials in the URL', 'http://user:pass@example.com/'],
      ['garbage', 'not a url'],
      ['empty', ''],
    ])('rejects %s', async (_label, bad) => {
      await expectError(service.replay(slug, requestId, { url: bad }), 'invalid');
    });

    it('rejects a missing url', async () => {
      await expectError(service.replay(slug, requestId, {} as any), 'invalid');
    });

    it('rejects unsupported methods', async () => {
      await expectError(service.replay(slug, requestId, { url: url(), method: 'TRACE' }), 'invalid');
      await expectError(service.replay(slug, requestId, { url: url(), method: 'CONNECT' }), 'invalid');
    });

    it('returns not_found for an unknown request id', async () => {
      await expectError(service.replay(slug, 'nope', { url: url() }), 'not_found');
    });

    it("cannot replay another endpoint's request", async () => {
      const other = captureService.createEndpoint().slug;
      await expectError(service.replay(other, requestId, { url: url() }), 'not_found');
    });
  });
});
