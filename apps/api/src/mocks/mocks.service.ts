import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { isValidPattern, matchPath, type PathParams } from './path-match';
import { renderTemplate } from './template';

// 'text': the body is sent as UTF-8 and may use {{placeholders}}.
// 'base64': the body is decoded and sent as raw bytes (images, PDFs, protobuf...), never templated.
export type BodyEncoding = 'text' | 'base64';
const BODY_ENCODINGS: readonly BodyEncoding[] = ['text', 'base64'];

export interface MockRule {
  id: string;
  slug: string;
  position: number;
  method: string; // an HTTP method, or '*' for any
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string; // the text, or the base64 of the bytes when bodyEncoding is 'base64'
  bodyEncoding: BodyEncoding;
  delayMs: number;
  enabled: boolean;
  createdAt: string;
}

export interface MockInput {
  method?: string;
  path?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  bodyEncoding?: BodyEncoding;
  delayMs?: number;
  enabled?: boolean;
}

export type MockErrorCode = 'not_found' | 'invalid';

export class MockError extends Error {
  constructor(
    public readonly code: MockErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// ---- limits ----
export const MAX_RULES_PER_ENDPOINT = 50;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_DELAY_MS = 10_000;
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE = 1000;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/; // an HTTP "token"
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/; // no CR, LF or other control characters
// Standard (RFC 4648) base64 with the padding in place. Whitespace is removed before checking.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// Headers a mock may not set: they describe the connection (we must control
// them), or are security-sensitive. Content-Security-Policy and
// X-Content-Type-Options are always forced by the server (see the controller).
const FORBIDDEN_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'content-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'set-cookie',
  'set-cookie2',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-type-options',
]);

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer; // a Buffer for base64 rules

  delayMs: number;
}

@Injectable()
export class MocksService {
  constructor(private readonly dbs: DbService) {}

  list(slug: string): MockRule[] {
    this.requireEndpoint(slug);
    return this.rows(slug);
  }

  create(slug: string, input: MockInput): MockRule {
    this.requireEndpoint(slug);
    const data = this.validate(input);
    const existing = this.dbs.db
      .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS maxPos FROM mock_rules WHERE slug = ?')
      .get(slug) as { n: number; maxPos: number };
    if (existing.n >= MAX_RULES_PER_ENDPOINT) {
      throw new MockError('invalid', `An endpoint can have at most ${MAX_RULES_PER_ENDPOINT} mock rules.`);
    }
    const id = randomUUID();
    this.dbs.db
      .prepare(
        `INSERT INTO mock_rules
         (id, slug, position, method, path, status, headers, body, body_encoding, delay_ms, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, slug, existing.maxPos + 1, data.method, data.path, data.status,
        JSON.stringify(data.headers), data.body, data.bodyEncoding, data.delayMs, data.enabled ? 1 : 0,
        new Date().toISOString(),
      );
    return this.get(slug, id);
  }

  /** Replaces every editable field of a rule. */
  update(slug: string, id: string, input: MockInput): MockRule {
    this.requireEndpoint(slug);
    this.get(slug, id); // 404 if it does not belong to this endpoint
    const data = this.validate(input);
    this.dbs.db
      .prepare(
        `UPDATE mock_rules
         SET method = ?, path = ?, status = ?, headers = ?, body = ?, body_encoding = ?, delay_ms = ?, enabled = ?
         WHERE slug = ? AND id = ?`,
      )
      .run(
        data.method, data.path, data.status, JSON.stringify(data.headers), data.body, data.bodyEncoding,
        data.delayMs, data.enabled ? 1 : 0, slug, id,
      );
    return this.get(slug, id);
  }

  remove(slug: string, id: string): void {
    this.requireEndpoint(slug);
    const result = this.dbs.db.prepare('DELETE FROM mock_rules WHERE slug = ? AND id = ?').run(slug, id);
    if (result.changes === 0) throw new MockError('not_found', 'Mock rule not found.');
  }

  /** First enabled rule (in order) that matches this method and path. */
  findMatch(slug: string, method: string, path: string): { rule: MockRule; params: PathParams } | undefined {
    for (const rule of this.rows(slug)) {
      if (!rule.enabled) continue;
      if (rule.method !== '*' && rule.method !== method.toUpperCase()) continue;
      const params = matchPath(rule.path, path);
      if (params) return { rule, params };
    }
    return undefined;
  }

  /**
   * Fill in the body template, or decode a base64 body to its bytes (never templated).
   * Headers are sent exactly as configured (never templated).
   */
  render(
    match: { rule: MockRule; params: PathParams },
    request: { method: string; path: string; query: unknown; headers: unknown; body: string },
  ): MockResponse {
    const { status, headers, delayMs } = match.rule;
    if (match.rule.bodyEncoding === 'base64') {
      return { status, headers, body: Buffer.from(match.rule.body, 'base64'), delayMs };
    }
    let json: unknown;
    try {
      json = JSON.parse(request.body);
    } catch {
      json = undefined; // not JSON: {{request.json...}} simply renders empty
    }
    const body = renderTemplate(match.rule.body, {
      params: match.params,
      request: { ...request, json },
    });
    return { status, headers, body, delayMs };
  }

  // ---- internals ----

  private requireEndpoint(slug: string) {
    const found = this.dbs.db.prepare('SELECT 1 FROM endpoints WHERE slug = ?').get(slug);
    if (!found) throw new MockError('not_found', 'Endpoint not found.');
  }

  private get(slug: string, id: string): MockRule {
    const row = this.dbs.db.prepare('SELECT * FROM mock_rules WHERE slug = ? AND id = ?').get(slug, id);
    if (!row) throw new MockError('not_found', 'Mock rule not found.');
    return this.toRule(row as any);
  }

  private rows(slug: string): MockRule[] {
    return (
      this.dbs.db
        .prepare('SELECT * FROM mock_rules WHERE slug = ? ORDER BY position ASC, created_at ASC')
        .all(slug) as any[]
    ).map((r) => this.toRule(r));
  }

  private toRule(r: any): MockRule {
    return {
      id: r.id,
      slug: r.slug,
      position: r.position,
      method: r.method,
      path: r.path,
      status: r.status,
      headers: JSON.parse(r.headers),
      body: r.body,
      bodyEncoding: r.body_encoding === 'base64' ? 'base64' : 'text',
      delayMs: r.delay_ms,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
    };
  }

  private validate(input: MockInput) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new MockError('invalid', 'A JSON object is required.');
    }
    const fail = (message: string): never => {
      throw new MockError('invalid', message);
    };

    const method = String(input.method ?? '*').toUpperCase();
    if (method !== '*' && !METHODS.has(method)) fail(`Method must be one of ${[...METHODS].join(', ')} or *.`);

    if (!isValidPattern(input.path)) {
      fail('Path must start with "/" and may use :params and a trailing * (for example /users/:id or /files/*).');
    }

    const status = input.status ?? 200;
    if (!Number.isInteger(status) || status < 200 || status > 599) fail('Status must be an integer from 200 to 599.');

    const delayMs = input.delayMs ?? 0;
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
      fail(`Delay must be an integer from 0 to ${MAX_DELAY_MS} ms.`);
    }

    const bodyEncoding = input.bodyEncoding ?? 'text';
    if (!BODY_ENCODINGS.includes(bodyEncoding)) fail(`Body encoding must be one of ${BODY_ENCODINGS.join(', ')}.`);

    let body = input.body ?? '';
    if (typeof body !== 'string') fail('Body must be a string.');
    if (bodyEncoding === 'base64') {
      body = body.replace(/\s+/g, ''); // allow line-wrapped base64, store it compact
      if (!BASE64.test(body)) fail('Body is not valid base64.');
      if (Buffer.from(body, 'base64').length > MAX_BODY_BYTES) {
        fail(`Body must decode to at most ${MAX_BODY_BYTES / 1024} KB.`);
      }
    } else if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      fail(`Body must be at most ${MAX_BODY_BYTES / 1024} KB.`);
    }

    const enabled = input.enabled ?? true;
    if (typeof enabled !== 'boolean') fail('Enabled must be true or false.');

    const rawHeaders = input.headers ?? {};
    if (rawHeaders === null || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
      fail('Headers must be an object of name: value strings.');
    }
    const entries = Object.entries(rawHeaders);
    if (entries.length > MAX_HEADERS) fail(`At most ${MAX_HEADERS} headers are allowed.`);
    const headers: Record<string, string> = {};
    for (const [name, value] of entries) {
      if (!HEADER_NAME.test(name)) fail(`"${name}" is not a valid header name.`);
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) fail(`The ${name} header cannot be set by a mock.`);
      if (typeof value !== 'string' || value.length > MAX_HEADER_VALUE || !HEADER_VALUE.test(value)) {
        fail(`Invalid value for header ${name}.`);
      }
      headers[name.toLowerCase()] = value;
    }

    return { method, path: input.path as string, status, headers, body, bodyEncoding, delayMs, enabled };
  }
}
