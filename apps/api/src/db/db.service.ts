import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Owns the one SQLite connection for the whole app.
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly db: Database.Database;

  constructor() {
    const file = process.env.HOOKPIT_DB ?? './data/hookpit.sqlite';
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL'); // faster, safer concurrent writes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS endpoints (
        slug       TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS requests (
        id          TEXT PRIMARY KEY,
        slug        TEXT NOT NULL REFERENCES endpoints(slug),
        method      TEXT NOT NULL,
        path        TEXT NOT NULL,
        query       TEXT NOT NULL,   -- JSON string
        headers     TEXT NOT NULL,   -- JSON string
        body        TEXT NOT NULL,
        body_size   INTEGER NOT NULL,
        ip          TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_slug_time
        ON requests (slug, received_at DESC);
    `);
  }

  onModuleDestroy() {
    this.db.close();
  }
}
