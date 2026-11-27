import { Injectable } from '@nestjs/common';
import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { CaptureService } from '../capture/capture.service';
import { isBlockedAddress } from './ip-guard';

export type ReplayErrorCode = 'not_found' | 'invalid' | 'blocked' | 'timeout' | 'network';

// A problem the caller can understand (bad URL, blocked target, timeout...).
export class ReplayError extends Error {
  constructor(
    public readonly code: ReplayErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ReplayInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ReplayResult {
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  bodyTruncated: boolean;
  durationMs: number;
}

const MAX_RESPONSE_BYTES = 1024 * 1024; // keep at most 1 MB of the response
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

// Headers that describe the original connection, not the message. We let Node
// set the correct ones for the new request instead of copying stale values.
const SKIPPED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'expect',
  'proxy-authorization',
  'proxy-connection',
  'accept-encoding', // we ask for an uncompressed reply so we can show it as text
]);

// Read at call time so tests (and operators) can change them without a restart.
const allowPrivateTargets = () => process.env.HOOKPIT_ALLOW_PRIVATE_TARGETS === 'true';
const timeoutMs = () => Number(process.env.HOOKPIT_REPLAY_TIMEOUT_MS) || 10_000;

/**
 * DNS lookup used for the real connection. Because the check happens on the
 * very addresses Node is about to connect to, DNS rebinding cannot swap in an
 * internal address after validation.
 */
function guardedLookup(hostname: string, options: any, callback: (...args: any[]) => void) {
  dns.lookup(hostname, options, (err: any, address: any, family: any) => {
    if (err) return callback(err, address, family);
    const list: Array<{ address: string }> = Array.isArray(address) ? address : [{ address }];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad) {
      const blocked: any = new ReplayError(
        'blocked',
        `Target resolves to a private or reserved address (${bad.address}).`,
      );
      return callback(blocked, undefined, undefined);
    }
    callback(null, address, family);
  });
}

@Injectable()
export class ReplayService {
  constructor(private readonly capture: CaptureService) {}

  async replay(slug: string, requestId: string, input: ReplayInput): Promise<ReplayResult> {
    const original = this.capture.getById(slug, requestId);
    if (!original) throw new ReplayError('not_found', 'Captured request not found.');

    const target = this.parseTarget(input?.url);
    const method = (input.method ?? original.method).toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      throw new ReplayError('invalid', `Method ${method} is not supported.`);
    }

    const source = input.headers ?? original.headers;
    const headers: Record<string, string> = { 'accept-encoding': 'identity' };
    for (const [name, value] of Object.entries(source)) {
      if (value === undefined || SKIPPED_HEADERS.has(name.toLowerCase())) continue;
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }

    const body = method === 'GET' || method === 'HEAD' ? '' : (input.body ?? original.body);
    // Without this Node would send the body chunked, and many receivers (and
    // signature checks) expect a plain Content-Length like the original request.
    if (body) headers['content-length'] = String(Buffer.byteLength(body));
    return this.send(target, method, headers, body);
  }

  private parseTarget(raw: unknown): URL {
    if (typeof raw !== 'string' || !raw) throw new ReplayError('invalid', 'A target URL is required.');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ReplayError('invalid', 'The target is not a valid URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ReplayError('invalid', 'Only http and https URLs are allowed.');
    }
    if (url.username || url.password) {
      throw new ReplayError('invalid', 'URLs with embedded credentials are not allowed.');
    }
    // IP literals skip DNS, so they must be checked here (the URL parser has
    // already normalised tricks like http://2130706433/ into 127.0.0.1).
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivateTargets() && isIP(host) && isBlockedAddress(host)) {
      throw new ReplayError('blocked', blockedMessage(host));
    }
    return url;
  }

  private send(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<ReplayResult> {
    const started = Date.now();
    const lib = url.protocol === 'https:' ? https : http;
    const guard = !allowPrivateTargets();

    return new Promise<ReplayResult>((resolve, reject) => {
      let settled = false;
      const fail = (error: ReplayError) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      // Redirects are NOT followed: http.request never does, and we return 3xx as-is.
      const req = lib.request(
        url,
        { method, headers, timeout: timeoutMs(), ...(guard ? { lookup: guardedLookup as any } : {}) },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve({
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? '',
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
              bodyTruncated: truncated,
              durationMs: Date.now() - started,
            });
          };
          res.on('data', (chunk: Buffer) => {
            if (truncated) return;
            if (size + chunk.length > MAX_RESPONSE_BYTES) {
              chunks.push(chunk.subarray(0, MAX_RESPONSE_BYTES - size));
              size = MAX_RESPONSE_BYTES;
              truncated = true;
              finish();
              res.destroy(); // stop downloading the rest
              return;
            }
            chunks.push(chunk);
            size += chunk.length;
          });
          res.on('end', finish);
          res.on('error', () => finish());
        },
      );

      req.on('timeout', () =>
        req.destroy(new ReplayError('timeout', `The target did not answer within ${timeoutMs()} ms.`)),
      );
      req.on('error', (err: any) => {
        if (err instanceof ReplayError) return fail(err);
        const detail = err?.code ? ` (${err.code})` : '';
        fail(new ReplayError('network', `Could not reach the target${detail}.`));
      });

      if (body) req.write(body);
      req.end();
    });
  }
}

function blockedMessage(address: string): string {
  return (
    `Target ${address} is a private or reserved address and is blocked to prevent SSRF. ` +
    `On a private, self-hosted instance you can allow it with HOOKPIT_ALLOW_PRIVATE_TARGETS=true.`
  );
}
