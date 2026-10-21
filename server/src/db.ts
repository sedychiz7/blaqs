import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

// Every table that holds personal data references users(id) with ON DELETE CASCADE,
// so deleting an account removes everything about that person in one statement.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  premium_until INTEGER,
  history_retention_hours INTEGER,
  sharing_paused INTEGER NOT NULL DEFAULT 0,
  push_token TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- A share is a one-directional grant: sharer's location becomes visible to viewer.
-- It is only "active" once BOTH people have said yes. Either side may be NULL while
-- the invited person has not joined yet; target_phone_hash lets us attach it later.
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  sharer_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  viewer_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('sharer', 'viewer')),
  target_phone_hash TEXT,
  invite_token TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'paused', 'declined', 'revoked', 'expired')),
  precision TEXT NOT NULL DEFAULT 'precise' CHECK (precision IN ('precise', 'approximate')),
  allow_history INTEGER NOT NULL DEFAULT 0,
  -- Requested length of the share; the clock starts when it is accepted.
  duration_minutes INTEGER,
  expires_at INTEGER,
  consent_confirmed_at INTEGER,
  trip_label TEXT,
  trip_lat REAL,
  trip_lng REAL,
  trip_radius_m REAL,
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_sharer ON shares(sharer_id, status);
CREATE INDEX IF NOT EXISTS shares_viewer ON shares(viewer_id, status);
CREATE INDEX IF NOT EXISTS shares_target ON shares(target_phone_hash);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  speed REAL,
  heading REAL,
  battery REAL,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS locations_user_time ON locations(user_id, recorded_at);

-- Transparency: every time someone looks at your location, you can see it.
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS access_log_subject ON access_log(subject_id, at);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_m REAL NOT NULL,
  created_at INTEGER NOT NULL
);

-- "Tell me when Sam arrives at School" — Sam has to approve it.
CREATE TABLE IF NOT EXISTS place_alerts (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  watcher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'declined', 'revoked')),
  last_state TEXT,
  created_at INTEGER NOT NULL,
  responded_at INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id, created_at);
`;

export function openDb(path = ':memory:'): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
