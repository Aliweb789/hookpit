import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { PROVIDERS, verifySignature, type Provider, type SignatureResult } from './verify';

export class SigningError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

export const MAX_SECRET_LENGTH = 512;

export interface SigningInput {
  provider?: unknown;
  secret?: unknown;
}

/** What the API may say about a configuration. The secret is never part of it. */
export type SigningConfigView = { configured: false } | { configured: true; provider: Provider };

interface StoredConfig {
  provider: Provider;
  secret: string;
}

@Injectable()
export class SigningService {
  constructor(private readonly dbs: DbService) {}

  get(slug: string): SigningConfigView {
    this.requireEndpoint(slug);
    const config = this.load(slug);
    return config ? { configured: true, provider: config.provider } : { configured: false };
  }

  set(slug: string, input: SigningInput): SigningConfigView {
    this.requireEndpoint(slug);
    const provider = input?.provider;
    if (typeof provider !== 'string' || !(PROVIDERS as readonly string[]).includes(provider)) {
      throw new SigningError('invalid', `Provider must be one of ${PROVIDERS.join(', ')}.`);
    }
    if (typeof input.secret !== 'string') throw new SigningError('invalid', 'Secret must be a string.');
    // A pasted secret often carries a trailing space or newline, which would make every check fail.
    const secret = input.secret.trim();
    if (secret.length === 0) throw new SigningError('invalid', 'Secret must not be empty.');
    if (secret.length > MAX_SECRET_LENGTH) {
      throw new SigningError('invalid', `Secret must be at most ${MAX_SECRET_LENGTH} characters.`);
    }

    this.dbs.db
      .prepare(
        `INSERT INTO signing_configs (slug, provider, secret, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET provider = excluded.provider,
                                         secret = excluded.secret,
                                         updated_at = excluded.updated_at`,
      )
      .run(slug, provider, secret, new Date().toISOString());
    return { configured: true, provider: provider as Provider };
  }

  clear(slug: string): void {
    this.requireEndpoint(slug);
    this.dbs.db.prepare('DELETE FROM signing_configs WHERE slug = ?').run(slug);
  }

  /**
   * Add a `signature` result to captured requests, when this endpoint has a
   * secret configured. Computed when requests are read (not when they are
   * captured), so changing the secret re-checks everything already stored.
   */
  annotateAll<T extends { headers: any; body: string }>(slug: string, requests: T[]): (T & { signature?: SignatureResult })[] {
    const config = this.load(slug);
    if (!config) return requests;
    return requests.map((r) => ({ ...r, signature: verifySignature(config.provider, config.secret, r.headers, r.body) }));
  }

  annotate<T extends { headers: any; body: string }>(slug: string, request: T): T & { signature?: SignatureResult } {
    return this.annotateAll(slug, [request])[0];
  }

  private load(slug: string): StoredConfig | undefined {
    return this.dbs.db.prepare('SELECT provider, secret FROM signing_configs WHERE slug = ?').get(slug) as
      | StoredConfig
      | undefined;
  }

  private requireEndpoint(slug: string) {
    if (!this.dbs.db.prepare('SELECT 1 FROM endpoints WHERE slug = ?').get(slug)) {
      throw new SigningError('not_found', 'Unknown endpoint.');
    }
  }
}
