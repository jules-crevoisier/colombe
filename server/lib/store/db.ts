/**
 * Stockage local du webmail (préférences, contacts, 2FA) — SQLite intégré à Node
 * (`node:sqlite`), aucune dépendance native. Un seul fichier, facile à sauvegarder.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS: string[] = [
  // 1 — schéma initial
  `
  CREATE TABLE prefs (
    owner TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    manual INTEGER NOT NULL DEFAULT 0,
    times_contacted INTEGER NOT NULL DEFAULT 0,
    last_contacted_at TEXT,
    UNIQUE (owner, email)
  );
  CREATE INDEX contacts_owner ON contacts (owner, times_contacted DESC);
  CREATE TABLE totp (
    owner TEXT PRIMARY KEY,
    secret_enc TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_step INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX recovery_owner ON recovery_codes (owner);
  `,
]

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined
  let version = row?.version ?? 0
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run()
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version] ?? '')
      version += 1
      db.prepare('UPDATE schema_version SET version = ?').run(version)
      db.exec('COMMIT')
    }
    catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return db
}

let shared: DatabaseSync | null = null

/** Base partagée du processus. `WEBMAIL_DATA_DIR` (défaut `.data`). */
export function useDb(): DatabaseSync {
  shared ??= openDatabase(resolve(process.env.WEBMAIL_DATA_DIR || '.data', 'webmail.sqlite'))
  return shared
}

/** Tests uniquement : remplace la base partagée (ex. `:memory:`). */
export function setDbForTests(db: DatabaseSync | null): void {
  shared = db
}
