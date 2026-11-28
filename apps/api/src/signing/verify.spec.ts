import { createHmac } from 'node:crypto';
import { verifySignature } from './verify';

// Known-answer values. The GitHub one is the example from GitHub's own docs;
// the others were computed once with `openssl`-compatible HMAC-SHA256 and are
// pinned here so a bug that is "consistent" between the code and a test that
// recomputes the same formula cannot slip through.
const GITHUB = {
  secret: "It's a Secret to Everybody",
  body: 'Hello, World!',
  sig: 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
};
const STRIPE = {
  secret: 'whsec_test_secret',
  body: '{"id":"evt_1"}',
  t: '1700000000',
  v1: '248a374f50f943a28b0f6ab50faf9a7e7e29b710fa26df9fb1618b9bf8ea9c9a',
};
const SLACK = {
  secret: '8f742231b10e8888abcd99yyyzzz85a5',
  body: 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J',
  t: '1531420618',
  sig: 'v0=bca5eef5dd737ed259b428b18cd24f679baa18c3fc5f1cb2a6ac9f03e717969a',
};

const flip = (hex: string) => (hex[0] === 'a' ? 'b' : 'a') + hex.slice(1); // change one character

describe('verifySignature: github', () => {
  const check = (headers: Record<string, any>, body = GITHUB.body, secret = GITHUB.secret) =>
    verifySignature('github', secret, headers, body);

  it('accepts the example from the GitHub docs', () => {
    expect(check({ 'x-hub-signature-256': GITHUB.sig })).toEqual({ provider: 'github', status: 'valid' });
  });

  it('is case-insensitive about the hex digits', () => {
    const upper = 'sha256=' + GITHUB.sig.slice(7).toUpperCase();
    expect(check({ 'x-hub-signature-256': upper }).status).toBe('valid');
  });

  it.each([
    ['a changed body', { 'x-hub-signature-256': GITHUB.sig }, 'Hello, World?', GITHUB.secret],
    ['a wrong secret', { 'x-hub-signature-256': GITHUB.sig }, GITHUB.body, 'another secret'],
    ['one changed character', { 'x-hub-signature-256': 'sha256=' + flip(GITHUB.sig.slice(7)) }, GITHUB.body, GITHUB.secret],
    ['a truncated signature', { 'x-hub-signature-256': GITHUB.sig.slice(0, -2) }, GITHUB.body, GITHUB.secret],
    ['an over-long signature', { 'x-hub-signature-256': GITHUB.sig + '00' }, GITHUB.body, GITHUB.secret],
    ['non-hex characters', { 'x-hub-signature-256': 'sha256=' + 'z'.repeat(64) }, GITHUB.body, GITHUB.secret],
    ['the wrong prefix', { 'x-hub-signature-256': GITHUB.sig.replace('sha256=', 'sha1=') }, GITHUB.body, GITHUB.secret],
    ['an empty signature', { 'x-hub-signature-256': 'sha256=' }, GITHUB.body, GITHUB.secret],
  ])('rejects %s', (_label, headers, body, secret) => {
    expect(check(headers, body, secret).status).toBe('invalid');
  });

  it('reports a missing header as missing, not invalid', () => {
    expect(check({}).status).toBe('missing');
    expect(check({ 'x-hub-signature-256': '' }).status).toBe('missing');
  });

  it('uses the first value when the header is repeated', () => {
    expect(check({ 'x-hub-signature-256': [GITHUB.sig, 'sha256=00'] }).status).toBe('valid');
  });

  it('never puts the secret or the expected signature in the reason', () => {
    const result = check({ 'x-hub-signature-256': 'sha256=' + flip(GITHUB.sig.slice(7)) });
    expect(JSON.stringify(result)).not.toContain(GITHUB.secret);
    expect(JSON.stringify(result)).not.toContain(GITHUB.sig.slice(7));
  });

  it('signs the exact bytes: whitespace in the body matters', () => {
    expect(check({ 'x-hub-signature-256': GITHUB.sig }, GITHUB.body + ' ').status).toBe('invalid');
  });

  it('handles a multi-byte body as UTF-8', () => {
    const body = '{"name":"Zoë 🪝"}';
    const sig = 'sha256=' + createHmac('sha256', 's').update(Buffer.from(body, 'utf8')).digest('hex');
    expect(verifySignature('github', 's', { 'x-hub-signature-256': sig }, body).status).toBe('valid');
  });
});

describe('verifySignature: stripe', () => {
  const header = (t: string, ...v1: string[]) => `t=${t},${v1.map((v) => `v1=${v}`).join(',')}`;
  const check = (headers: Record<string, any>, body = STRIPE.body, secret = STRIPE.secret) =>
    verifySignature('stripe', secret, headers, body);

  it('accepts a correct signature', () => {
    expect(check({ 'stripe-signature': header(STRIPE.t, STRIPE.v1) })).toEqual({ provider: 'stripe', status: 'valid' });
  });

  it('accepts when any of several v1 values matches (secret rotation)', () => {
    expect(check({ 'stripe-signature': header(STRIPE.t, flip(STRIPE.v1), STRIPE.v1) }).status).toBe('valid');
  });

  it('ignores other schemes such as v0', () => {
    expect(check({ 'stripe-signature': `t=${STRIPE.t},v0=${STRIPE.v1}` }).status).toBe('invalid');
  });

  it('tolerates spaces around the parts', () => {
    expect(check({ 'stripe-signature': ` t=${STRIPE.t} , v1=${STRIPE.v1} ` }).status).toBe('valid');
  });

  it.each([
    ['a changed body', header(STRIPE.t, STRIPE.v1), '{"id":"evt_2"}', STRIPE.secret],
    ['a wrong secret', header(STRIPE.t, STRIPE.v1), STRIPE.body, 'whsec_other'],
    ['a changed timestamp (it is part of the signed text)', header('1700000001', STRIPE.v1), STRIPE.body, STRIPE.secret],
    ['one changed character', header(STRIPE.t, flip(STRIPE.v1)), STRIPE.body, STRIPE.secret],
    ['no timestamp', `v1=${STRIPE.v1}`, STRIPE.body, STRIPE.secret],
    ['a non-numeric timestamp', header('abc', STRIPE.v1), STRIPE.body, STRIPE.secret],
    ['no v1 value', `t=${STRIPE.t}`, STRIPE.body, STRIPE.secret],
    ['a garbage header', 'hello world', STRIPE.body, STRIPE.secret],
  ])('rejects %s', (_label, value, body, secret) => {
    expect(check({ 'stripe-signature': value }, body, secret).status).toBe('invalid');
  });

  it('reports a missing header as missing', () => {
    expect(check({}).status).toBe('missing');
  });

  it('does not enforce timestamp age, so old captures can still be checked', () => {
    expect(Number(STRIPE.t)).toBeLessThan(Date.now() / 1000 - 86400);
    expect(check({ 'stripe-signature': header(STRIPE.t, STRIPE.v1) }).status).toBe('valid');
  });
});

describe('verifySignature: slack', () => {
  const check = (headers: Record<string, any>, body = SLACK.body, secret = SLACK.secret) =>
    verifySignature('slack', secret, headers, body);
  const good = { 'x-slack-signature': SLACK.sig, 'x-slack-request-timestamp': SLACK.t };

  it('accepts a correct signature', () => {
    expect(check(good)).toEqual({ provider: 'slack', status: 'valid' });
  });

  it.each([
    ['a changed body', good, SLACK.body + '&x=1', SLACK.secret],
    ['a wrong secret', good, SLACK.body, 'nope'],
    ['a changed timestamp', { ...good, 'x-slack-request-timestamp': '1531420619' }, SLACK.body, SLACK.secret],
    ['one changed character', { ...good, 'x-slack-signature': 'v0=' + flip(SLACK.sig.slice(3)) }, SLACK.body, SLACK.secret],
    ['the wrong prefix', { ...good, 'x-slack-signature': SLACK.sig.replace('v0=', 'v1=') }, SLACK.body, SLACK.secret],
    ['no timestamp header', { 'x-slack-signature': SLACK.sig }, SLACK.body, SLACK.secret],
    ['a non-numeric timestamp', { ...good, 'x-slack-request-timestamp': 'later' }, SLACK.body, SLACK.secret],
  ])('rejects %s', (_label, headers, body, secret) => {
    expect(check(headers, body, secret).status).toBe('invalid');
  });

  it('reports a missing signature header as missing', () => {
    expect(check({ 'x-slack-request-timestamp': SLACK.t }).status).toBe('missing');
  });
});

describe('verifySignature: providers do not accept each other\'s headers', () => {
  it('a valid GitHub header does not satisfy Stripe or Slack', () => {
    const headers = { 'x-hub-signature-256': GITHUB.sig };
    expect(verifySignature('stripe', GITHUB.secret, headers, GITHUB.body).status).toBe('missing');
    expect(verifySignature('slack', GITHUB.secret, headers, GITHUB.body).status).toBe('missing');
  });
});
