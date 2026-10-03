// SQLite storage for daily attempts: one row per player per UTC day.

import Database from 'better-sqlite3';
import type { AttemptStatus, User } from '../shared/types';

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

    -- Names and avatars for the leaderboard, refreshed each time a player opens the game.
    CREATE TABLE IF NOT EXISTS users (
      id       TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      avatar   TEXT
    );
  `);
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

export function upsertUser(db: DB, u: User) {
  db.prepare(
    `INSERT INTO users (id, username, avatar) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar`,
  ).run(u.id, u.username, u.avatar);
}

export interface FinishedRow {
  user_id: string;
  username: string;
  avatar: string | null;
  status: 'solved' | 'gaveup';
  assisted: number;
  time_ms: number;
}

/**
 * Everyone who has finished a day's puzzle, already in leaderboard order:
 * unassisted solves by time, then assisted solves by time, then give-ups.
 * Players still playing are never included. Only names and results: no letters.
 */
export function finishedAttempts(db: DB, day: string, puzzleId: number): FinishedRow[] {
  // ponytail: returns every finisher; add LIMIT + "your rank" query if a day ever has thousands of players
  return db
    .prepare(
      `SELECT a.user_id, u.username, u.avatar, a.status, a.assisted, a.ended_at - a.started_at AS time_ms
       FROM daily_attempts a JOIN users u ON u.id = a.user_id
       WHERE a.day = ? AND a.puzzle_id = ? AND a.status != 'playing'
       ORDER BY a.status = 'gaveup', a.assisted, time_ms, a.ended_at`,
    )
    .all(day, puzzleId) as FinishedRow[];
}

/** Remove a player's attempt for a day (used when that day's puzzle was swapped). */
export function deleteAttempt(db: DB, userId: string, day: string) {
  db.prepare('DELETE FROM daily_attempts WHERE user_id = ? AND day = ?').run(userId, day);
}

/** The days a player solved (for streaks). */
export function solvedDays(db: DB, userId: string): string[] {
  const rows = db.prepare(`SELECT day FROM daily_attempts WHERE user_id = ? AND status = 'solved'`).all(userId) as { day: string }[];
  return rows.map((r) => r.day);
}
