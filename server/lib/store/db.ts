/**
 * Stockage local du webmail (préférences, contacts, 2FA) — SQLite intégré à Node
 * (`node:sqlite`), aucune dépendance native. Un seul fichier, facile à sauvegarder.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getConfig } from '../config'

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
  // 2 — R2 : identités, réponses types, carnet complet, groupes, journal de connexion
  `
  CREATE TABLE identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    reply_to TEXT NOT NULL DEFAULT '',
    bcc TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL DEFAULT '',
    signature_html TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX identities_owner ON identities (owner);
  CREATE TABLE responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    html TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX responses_owner ON responses (owner);
  -- contacts.email reste l'adresse principale ; le reste de la fiche en JSON
  -- (firstName, lastName, displayName, phones, organization, jobTitle, address, birthday, notes).
  ALTER TABLE contacts ADD COLUMN details TEXT NOT NULL DEFAULT '{}';
  CREATE TABLE contact_emails (
    contact_id INTEGER NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT 'other',
    address TEXT NOT NULL,
    PRIMARY KEY (contact_id, position)
  );
  CREATE INDEX contact_emails_address ON contact_emails (address);
  CREATE TABLE contact_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (owner, name)
  );
  CREATE TABLE contact_group_members (
    group_id INTEGER NOT NULL REFERENCES contact_groups (id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, contact_id)
  );
  -- owner = adresse saisie (en minuscules), y compris pour un échec de connexion.
  CREATE TABLE login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    at TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    success INTEGER NOT NULL
  );
  CREATE INDEX login_events_owner ON login_events (owner, at DESC);
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

/**
 * Base partagée du processus. `WEBMAIL_DATA_DIR` (défaut `.data`) — ignoré en
 * mode démo (COLOMBE_DEMO=true) : la base vit en mémoire (`:memory:`) et
 * disparaît avec le processus, comme le backend mémoire lui-même.
 */
export function useDb(): DatabaseSync {
  if (!shared) {
    const demo = getConfig().demo.enabled
    shared = openDatabase(demo ? ':memory:' : resolve(process.env.WEBMAIL_DATA_DIR || '.data', 'webmail.sqlite'))
  }
  return shared
}

/** Tests uniquement : remplace la base partagée (ex. `:memory:`). */
export function setDbForTests(db: DatabaseSync | null): void {
  shared = db
}
