import { MAX_SUBSTITUTED_BYTES, renderTemplate } from './template';

const ctx = {
  params: { id: '42' },
  request: {
    method: 'POST',
    path: '/users/42',
    query: { page: '2' },
    headers: { 'x-signature': 'abc', 'content-type': 'application/json' },
    body: '{"user":{"id":7,"tags":["a","b"]}}',
    json: { user: { id: 7, tags: ['a', 'b'] } },
  },
};

describe('renderTemplate', () => {
  it('leaves text without placeholders untouched', () => {
    expect(renderTemplate('{"ok":true}', ctx)).toBe('{"ok":true}');
  });

  it('inserts params, request fields, query, headers and nested JSON', () => {
    expect(renderTemplate('{{params.id}}|{{request.method}}|{{request.path}}', ctx)).toBe('42|POST|/users/42');
    expect(renderTemplate('{{request.query.page}}', ctx)).toBe('2');
    expect(renderTemplate('{{request.headers.x-signature}}', ctx)).toBe('abc');
    expect(renderTemplate('{{request.json.user.id}}', ctx)).toBe('7');
    expect(renderTemplate('{{request.body}}', ctx)).toBe('{"user":{"id":7,"tags":["a","b"]}}');
  });

  it('tolerates spaces inside the braces', () => {
    expect(renderTemplate('{{  params.id  }}', ctx)).toBe('42');
  });

  it('serialises objects and arrays as JSON, and reads array items by index', () => {
    expect(renderTemplate('{{request.json.user.tags}}', ctx)).toBe('["a","b"]');
    expect(renderTemplate('{{request.json.user.tags.1}}', ctx)).toBe('b');
  });

  it('turns missing values into an empty string', () => {
    expect(renderTemplate('[{{nope}}][{{params.missing}}][{{request.json.a.b.c}}]', ctx)).toBe('[][][]');
  });

  it('provides uuid, now and timestamp', () => {
    expect(renderTemplate('{{uuid}}', ctx)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(renderTemplate('{{uuid}}', ctx)).not.toBe(renderTemplate('{{uuid}}', ctx));
    const now = renderTemplate('{{now}}', ctx); // render once: two renders could differ by a millisecond
    expect(new Date(now).toISOString()).toBe(now); // a valid ISO-8601 timestamp
    expect(Number(renderTemplate('{{timestamp}}', ctx))).toBeGreaterThan(1_700_000_000_000);
  });

  describe('safety', () => {
    it.each([
      '{{constructor}}',
      '{{constructor.constructor}}',
      '{{__proto__}}',
      '{{request.__proto__}}',
      '{{request.constructor.name}}',
      '{{request.json.__proto__.polluted}}',
      '{{params.prototype}}',
    ])('never reaches the prototype chain: %s', (t) => expect(renderTemplate(t, ctx)).toBe(''));

    it('does not execute code or expressions', () => {
      expect(renderTemplate('{{1+1}}', ctx)).toBe('{{1+1}}'); // not a valid placeholder, left as text
      expect(renderTemplate('{{process.exit()}}', ctx)).toBe('{{process.exit()}}');
      expect(renderTemplate('{{process.env.HOME}}', ctx)).toBe('');
      expect(renderTemplate('{{require}}', ctx)).toBe('');
    });

    it('caps total substituted size so repeated placeholders cannot blow up memory', () => {
      const big = { request: { body: 'x'.repeat(MAX_SUBSTITUTED_BYTES) } };
      const out = renderTemplate('{{request.body}}'.repeat(5000), big);
      expect(out.length).toBe(MAX_SUBSTITUTED_BYTES);
    });
  });
});
