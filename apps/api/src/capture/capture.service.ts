import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Observable, Subject, filter } from 'rxjs';
import { DbService } from '../db/db.service';

export interface CapturedRequest {
  id: string;
  slug: string;
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  bodySize: number;
  ip: string;
  receivedAt: string;
}

@Injectable()
export class CaptureService {
  // A Subject is a live "megaphone": we push new requests in,
  // and every open SSE connection listens on the other side.
  private readonly live = new Subject<CapturedRequest>();

  constructor(private readonly dbs: DbService) {}

  createEndpoint() {
    const slug = randomBytes(6).toString('hex'); // 12 hex chars, hard to guess
    const createdAt = new Date().toISOString();
    this.dbs.db
      .prepare('INSERT INTO endpoints (slug, created_at) VALUES (?, ?)')
      .run(slug, createdAt);
    return { slug, createdAt };
  }

  endpointExists(slug: string): boolean {
    return !!this.dbs.db.prepare('SELECT 1 FROM endpoints WHERE slug = ?').get(slug);
  }

  record(input: Omit<CapturedRequest, 'id' | 'receivedAt'>): CapturedRequest {
    const captured: CapturedRequest = {
      ...input,
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
    };
    // "?" placeholders keep user data out of the SQL text (prevents SQL injection).
    this.dbs.db
      .prepare(
        `INSERT INTO requests
         (id, slug, method, path, query, headers, body, body_size, ip, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        captured.id,
        captured.slug,
        captured.method,
        captured.path,
        JSON.stringify(captured.query),
        JSON.stringify(captured.headers),
        captured.body,
        captured.bodySize,
        captured.ip,
        captured.receivedAt,
      );
    this.live.next(captured); // wake up every listener
    return captured;
  }

  list(slug: string, limit = 100): CapturedRequest[] {
    const rows = this.dbs.db
      .prepare(
        'SELECT * FROM requests WHERE slug = ? ORDER BY received_at DESC LIMIT ?',
      )
      .all(slug, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      method: r.method,
      path: r.path,
      query: JSON.parse(r.query),
      headers: JSON.parse(r.headers),
      body: r.body,
      bodySize: r.body_size,
      ip: r.ip,
      receivedAt: r.received_at,
    }));
  }

  // Stream of new requests for one slug.
  stream(slug: string): Observable<CapturedRequest> {
    return this.live.pipe(filter((r) => r.slug === slug));
  }
}
