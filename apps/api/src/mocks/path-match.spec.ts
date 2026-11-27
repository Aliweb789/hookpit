import { isValidPattern, matchPath } from './path-match';

describe('matchPath', () => {
  it('matches exact paths', () => {
    expect(matchPath('/users', '/users')).toEqual({});
    expect(matchPath('/users', '/orders')).toBeNull();
  });

  it('matches the root path', () => {
    expect(matchPath('/', '/')).toEqual({});
    expect(matchPath('/', '/x')).toBeNull();
  });

  it('ignores trailing slashes on either side', () => {
    expect(matchPath('/users/', '/users')).toEqual({});
    expect(matchPath('/users', '/users/')).toEqual({});
  });

  it('is case-sensitive for literal segments', () => {
    expect(matchPath('/Users', '/users')).toBeNull();
  });

  it('captures :params', () => {
    expect(matchPath('/users/:id', '/users/42')).toEqual({ id: '42' });
    expect(matchPath('/users/:id/orders/:orderId', '/users/42/orders/9')).toEqual({ id: '42', orderId: '9' });
  });

  it('a :param matches exactly one segment', () => {
    expect(matchPath('/users/:id', '/users')).toBeNull();
    expect(matchPath('/users/:id', '/users/42/extra')).toBeNull();
  });

  it('decodes percent-escapes in captured params', () => {
    expect(matchPath('/files/:name', '/files/a%20b')).toEqual({ name: 'a b' });
  });

  it('keeps a malformed escape as received instead of throwing', () => {
    expect(matchPath('/files/:name', '/files/%E0%A4%A')).toEqual({ name: '%E0%A4%A' });
  });

  it('a trailing * matches everything below, including nothing', () => {
    expect(matchPath('/files/*', '/files')).toEqual({ '*': '' });
    expect(matchPath('/files/*', '/files/a')).toEqual({ '*': 'a' });
    expect(matchPath('/files/*', '/files/a/b/c')).toEqual({ '*': 'a/b/c' });
    expect(matchPath('/files/*', '/other/a')).toBeNull();
  });

  it('a lone * matches every path', () => {
    expect(matchPath('/*', '/')).toEqual({ '*': '' });
    expect(matchPath('/*', '/any/thing')).toEqual({ '*': 'any/thing' });
  });

  it('mixes params and a wildcard', () => {
    expect(matchPath('/v1/:tenant/*', '/v1/acme/a/b')).toEqual({ tenant: 'acme', '*': 'a/b' });
  });
});

describe('isValidPattern', () => {
  it.each(['/', '/users', '/users/:id', '/users/:user_id/orders', '/files/*', '/*', '/v1/:a/:b/*'])(
    'accepts %s',
    (p) => expect(isValidPattern(p)).toBe(true),
  );

  it.each([
    ['empty', ''],
    ['no leading slash', 'users'],
    ['double slash', '/a//b'],
    ['query string', '/a?x=1'],
    ['fragment', '/a#top'],
    ['whitespace', '/a b'],
    ['wildcard not last', '/*/a'],
    ['partial wildcard', '/fi*'],
    ['param with no name', '/:'],
    ['param with bad name', '/:1abc'],
    ['colon inside a segment', '/a:b'],
    ['too long', '/' + 'a'.repeat(250)],
  ])('rejects %s', (_label, p) => expect(isValidPattern(p)).toBe(false));

  it.each([undefined, null, 42, {}, []])('rejects non-string %p', (v) => expect(isValidPattern(v)).toBe(false));
});
