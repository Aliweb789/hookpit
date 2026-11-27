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
      CREATE TABLE IF NOT EXISTS mock_rules (
        id         TEXT PRIMARY KEY,
        slug       TEXT NOT NULL REFERENCES endpoints(slug),
        position   INTEGER NOT NULL,          -- rules are tried in this order
        method     TEXT NOT NULL,             -- an HTTP method, or '*' for any
        path       TEXT NOT NULL,             -- pattern such as /users/:id
        status     INTEGER NOT NULL,
        headers    TEXT NOT NULL,             -- JSON object
        body       TEXT NOT NULL,             -- may contain {{placeholders}}
        delay_ms   INTEGER NOT NULL,
        enabled    INTEGER NOT NULL,          -- 1 or 0
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mock_rules_slug
        ON mock_rules (slug, position);
    `);
  }

  onModuleDestroy() {
    this.db.close();
  }
}
