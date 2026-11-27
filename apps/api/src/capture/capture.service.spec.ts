import { CaptureService } from './capture.service';
import { DbService } from '../db/db.service';

// Each test gets a brand-new in-memory SQLite database (nothing touches disk).
function makeService() {
  process.env.HOOKPIT_DB = ':memory:';
  const dbs = new DbService();
  return { service: new CaptureService(dbs), dbs };
}

const sample = (slug: string, extra: Partial<Parameters<CaptureService['record']>[0]> = {}) => ({
  slug,
  method: 'POST',
  path: '/orders',
  query: {},
  headers: { 'content-type': 'application/json' },
  body: '{"a":1}',
  bodySize: 7,
  ip: '::1',
  ...extra,
});

describe('CaptureService', () => {
  let service: CaptureService;
  let dbs: DbService;

  beforeEach(() => ({ service, dbs } = makeService()));
  afterEach(() => dbs.onModuleDestroy());

  it('creates endpoints with a 12-character hex slug', () => {
    const { slug } = service.createEndpoint();
    expect(slug).toMatch(/^[0-9a-f]{12}$/);
    expect(service.endpointExists(slug)).toBe(true);
  });

  it('creates a different slug every time', () => {
    const slugs = new Set(Array.from({ length: 50 }, () => service.createEndpoint().slug));
    expect(slugs.size).toBe(50);
  });

  it('reports unknown slugs as not existing', () => {
    expect(service.endpointExists('doesnotexist')).toBe(false);
  });

  it('stores a request and returns it with all fields intact', () => {
    const { slug } = service.createEndpoint();
    const saved = service.record(
      sample(slug, { method: 'PUT', path: '/users/7', query: { x: '1' }, body: 'name=Ali' }),
    );

    const [found] = service.list(slug);
    expect(found).toEqual(saved);
    expect(found).toMatchObject({ method: 'PUT', path: '/users/7', query: { x: '1' }, body: 'name=Ali' });
    expect(found.id).toBeTruthy();
    expect(new Date(found.receivedAt).toString()).not.toBe('Invalid Date');
  });

  it('lists the newest request first', async () => {
    const { slug } = service.createEndpoint();
    service.record(sample(slug, { path: '/first' }));
    await new Promise((r) => setTimeout(r, 5)); // ensure different timestamps
    service.record(sample(slug, { path: '/second' }));

    expect(service.list(slug).map((r) => r.path)).toEqual(['/second', '/first']);
  });

  it('keeps requests of different endpoints separate', () => {
    const a = service.createEndpoint().slug;
    const b = service.createEndpoint().slug;
    service.record(sample(a));
    service.record(sample(a));
    service.record(sample(b));

    expect(service.list(a)).toHaveLength(2);
    expect(service.list(b)).toHaveLength(1);
  });

  it('respects the list limit', () => {
    const { slug } = service.createEndpoint();
    for (let i = 0; i < 5; i++) service.record(sample(slug));
    expect(service.list(slug, 3)).toHaveLength(3);
  });

  it('is safe against SQL injection in stored values', () => {
    const { slug } = service.createEndpoint();
    const evil = "'); DROP TABLE requests; --";
    service.record(sample(slug, { path: evil, body: evil }));

    const [found] = service.list(slug);
    expect(found.path).toBe(evil); // stored as plain text, table still alive
    expect(found.body).toBe(evil);
  });

  it('streams new requests only to listeners of that slug', () => {
    const a = service.createEndpoint().slug;
    const b = service.createEndpoint().slug;
    const received: string[] = [];
    const sub = service.stream(a).subscribe((r) => received.push(r.path));

    service.record(sample(a, { path: '/for-a' }));
    service.record(sample(b, { path: '/for-b' }));

    sub.unsubscribe();
    expect(received).toEqual(['/for-a']);
  });
});
