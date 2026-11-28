import { createHmac, timingSafeEqual } from 'node:crypto';

// Webhook signature checks. Each provider signs the raw body with a shared
// secret using HMAC-SHA256 and puts the result in a header. We recompute it
// and compare. These are pure functions: no database, no HTTP, easy to test.

export const PROVIDERS = ['github', 'stripe', 'slack'] as const;
export type Provider = (typeof PROVIDERS)[number];

export type SignatureStatus = 'valid' | 'invalid' | 'missing';

export interface SignatureResult {
  provider: Provider;
  status: SignatureStatus;
  /** Why it is invalid or missing. Never contains the secret or the expected signature. */
  reason?: string;
}

type Headers = Record<string, string | string[] | undefined>;

// Node lowercases header names. A repeated header arrives as an array: use the first value.
function header(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first.length > 0 ? first : undefined;
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

// Constant-time comparison, so the time taken does not reveal how many leading
// characters were right. timingSafeEqual needs equal lengths, so a wrong length
// (or anything that is not hex) is simply a mismatch.
function safeEqualHex(expected: string, provided: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(provided) || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided.toLowerCase(), 'hex'));
}

const missing = (provider: Provider, reason: string): SignatureResult => ({ provider, status: 'missing', reason });
const invalid = (provider: Provider, reason: string): SignatureResult => ({ provider, status: 'invalid', reason });
const valid = (provider: Provider): SignatureResult => ({ provider, status: 'valid' });

// GitHub: X-Hub-Signature-256: sha256=<hex of HMAC(secret, body)>
function verifyGithub(secret: string, headers: Headers, body: string): SignatureResult {
  const value = header(headers, 'x-hub-signature-256');
  if (!value) return missing('github', 'No X-Hub-Signature-256 header.');
  if (!value.startsWith('sha256=')) return invalid('github', 'Header does not start with "sha256=".');
  return safeEqualHex(hmacHex(secret, body), value.slice('sha256='.length))
    ? valid('github')
    : invalid('github', 'Signature does not match. Wrong secret, or the body was changed.');
}

// Stripe: Stripe-Signature: t=<unix time>,v1=<hex>[,v1=<hex>...]
// The signed text is "<t>.<body>". Several v1 values can be present (during a
// secret rotation); the request is valid if any one matches. The secret is
// used exactly as shown in the Stripe dashboard, "whsec_" prefix included.
function verifyStripe(secret: string, headers: Headers, body: string): SignatureResult {
  const value = header(headers, 'stripe-signature');
  if (!value) return missing('stripe', 'No Stripe-Signature header.');

  let timestamp: string | undefined;
  const candidates: string[] = [];
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === 't') timestamp = val;
    else if (key === 'v1') candidates.push(val);
  }
  if (!timestamp || !/^\d+$/.test(timestamp)) return invalid('stripe', 'Header has no valid timestamp (t=).');
  if (candidates.length === 0) return invalid('stripe', 'Header has no v1 signature.');

  const expected = hmacHex(secret, `${timestamp}.${body}`);
  return candidates.some((c) => safeEqualHex(expected, c))
    ? valid('stripe')
    : invalid('stripe', 'Signature does not match. Wrong secret, or the body was changed.');
}

// Slack: X-Slack-Signature: v0=<hex of HMAC(secret, "v0:<timestamp>:<body>")>
// with the timestamp taken from X-Slack-Request-Timestamp.
function verifySlack(secret: string, headers: Headers, body: string): SignatureResult {
  const value = header(headers, 'x-slack-signature');
  if (!value) return missing('slack', 'No X-Slack-Signature header.');
  const timestamp = header(headers, 'x-slack-request-timestamp');
  if (!timestamp || !/^\d+$/.test(timestamp)) return invalid('slack', 'No valid X-Slack-Request-Timestamp header.');
  if (!value.startsWith('v0=')) return invalid('slack', 'Header does not start with "v0=".');
  return safeEqualHex(hmacHex(secret, `v0:${timestamp}:${body}`), value.slice('v0='.length))
    ? valid('slack')
    : invalid('slack', 'Signature does not match. Wrong secret, or the body was changed.');
}

/**
 * Check a captured request against a provider's signature scheme.
 *
 * Timestamps are NOT checked for age: Hookpit shows requests that were captured
 * minutes or days ago, and a live "reject anything older than 5 minutes" rule
 * would mark all of them invalid. The timestamp is still part of the signed
 * text, so changing it breaks the signature.
 */
export function verifySignature(
  provider: Provider,
  secret: string,
  headers: Headers,
  body: string,
): SignatureResult {
  switch (provider) {
    case 'github':
      return verifyGithub(secret, headers, body);
    case 'stripe':
      return verifyStripe(secret, headers, body);
    case 'slack':
      return verifySlack(secret, headers, body);
  }
}
