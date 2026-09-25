// SQLite storage for daily attempts: one row per player per UTC day.

import Database from 'better-sqlite3';
import type { AttemptStatus } from '../shared/types';

export type DB = Database.Database;

export function openDb(file = process.env.DB_FILE || 'crossword.db'): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // readers don't block the writer
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_attempts (
      user_id    TEXT    NOT NULL,             -- Discord user ID, set by the server, never by the client
      day        TEXT    NOT NULL,             -- UTC date, e.g. 2026-09-25 (so a rerun day is its own attempt)
      puzzle_id  INTEGER NOT NULL,
      letters    TEXT    NOT NULL,             -- JSON array of the player's letters
      revealed   TEXT    NOT NULL DEFAULT '[]',-- JSON array of revealed cell indexes
      started_at INTEGER NOT NULL,             -- ms timestamps from the server's clock
      ended_at   INTEGER,
      status     TEXT    NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'solved', 'gaveup')),
      assisted   INTEGER NOT NULL DEFAULT 0,   -- 1 once check or reveal was used
      PRIMARY KEY (user_id, day)               -- the database itself enforces one attempt per day
    );
  `);
  // ponytail: this table is only for the free daily puzzle (leaderboards, streaks).
  // A future paid archive should get its own table so it can never touch these.
  return db;
}

export interface Attempt {
  userId: string;
  day: string;
  puzzleId: number;
  letters: string[];
  revealed: number[];
  startedAt: number;
  endedAt: number | null;
  status: AttemptStatus;
  assisted: boolean;
}

interface Row {
  user_id: string;
  day: string;
  puzzle_id: number;
  letters: string;
  revealed: string;
  started_at: number;
  ended_at: number | null;
  status: AttemptStatus;
  assisted: number;
}

const fromRow = (r: Row): Attempt => ({
  userId: r.user_id,
  day: r.day,
  puzzleId: r.puzzle_id,
  letters: JSON.parse(r.letters),
  revealed: JSON.parse(r.revealed),
  startedAt: r.started_at,
  endedAt: r.ended_at,
  status: r.status,
  assisted: !!r.assisted,
});

export function getAttempt(db: DB, userId: string, day: string): Attempt | null {
  const row = db.prepare('SELECT * FROM daily_attempts WHERE user_id = ? AND day = ?').get(userId, day) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** Start today's attempt if it doesn't exist yet (INSERT OR IGNORE: loading twice never restarts the timer). */
export function startAttempt(db: DB, userId: string, day: string, puzzleId: number, cellCount: number, now: number): Attempt {
  db.prepare(
    `INSERT OR IGNORE INTO daily_attempts (user_id, day, puzzle_id, letters, started_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, day, puzzleId, JSON.stringify(Array(cellCount).fill('')), now);
  return getAttempt(db, userId, day)!;
}

/**
 * Write an attempt back. The `status = 'playing'` condition means a finished
 * attempt can never be changed again, even by two requests racing each other.
 */
export function saveAttempt(db: DB, a: Attempt): boolean {
  const result = db
    .prepare(
      `UPDATE daily_attempts SET letters = ?, revealed = ?, ended_at = ?, status = ?, assisted = ?
       WHERE user_id = ? AND day = ? AND status = 'playing'`,
    )
    .run(JSON.stringify(a.letters), JSON.stringify(a.revealed), a.endedAt, a.status, a.assisted ? 1 : 0, a.userId, a.day);
  return result.changes === 1;
}
