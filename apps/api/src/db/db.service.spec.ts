import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbService } from './db.service';

describe('DbService', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hookpit-db-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('adds body_encoding to a mock_rules table created before it existed, keeping the rows', () => {
    const file = join(dir, 'old.sqlite');
    const old = new Database(file);
    old.exec(`
      CREATE TABLE endpoints (slug TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE mock_rules (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL REFERENCES endpoints(slug), position INTEGER NOT NULL,
        method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, headers TEXT NOT NULL,
        body TEXT NOT NULL, delay_ms INTEGER NOT NULL, enabled INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO endpoints VALUES ('s1', '2026-01-01T00:00:00.000Z');
      INSERT INTO mock_rules VALUES ('r1', 's1', 1, '*', '/a', 200, '{}', 'hi', 0, 1, '2026-01-01T00:00:00.000Z');
    `);
    old.close();

    const previous = process.env.HOOKPIT_DB;
    process.env.HOOKPIT_DB = file;
    try {
      for (let i = 0; i < 2; i++) { // opening it again must not try to add the column twice
        const dbs = new DbService();
        expect(dbs.db.prepare('SELECT body, body_encoding FROM mock_rules WHERE id = ?').get('r1'))
          .toEqual({ body: 'hi', body_encoding: 'text' });
        dbs.onModuleDestroy();
      }
    } finally {
      process.env.HOOKPIT_DB = previous;
    }
  });
});
