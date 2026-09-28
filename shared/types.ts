// Types shared by the client and the server.

export type Dir = 'across' | 'down';

/** Clues keyed by their number, e.g. { "1": "Truth or ___" }. */
export interface Clues {
  across: Record<string, string>;
  down: Record<string, string>;
}

/**
 * A puzzle file exactly as stored in /puzzles.
 * SERVER ONLY: `grid` contains the answers. "#" marks a black square.
 */
export interface PuzzleFile {
  id: number; // running puzzle number, shown as "Mini Crossword #12"
  date: string; // YYYY-MM-DD (UTC) the puzzle belongs to
  size: number; // 5 or 7
  grid: string[]; // one string per row, e.g. "#DARE"
  clues: Clues;
  author: string;
}

/** A signed-in player. */
export interface User {
  id: string; // Discord user ID
  username: string; // display name (Discord global_name, or the username)
  avatar: string | null; // Discord avatar hash; null = default avatar
}

export type AttemptStatus = 'playing' | 'solved' | 'gaveup';

/** A player's attempt at today's puzzle, as the server reports it. */
export interface AttemptState {
  status: AttemptStatus;
  letters: string[];
  revealed: number[]; // cells revealed with "Reveal cell"
  assisted: boolean; // used check or reveal
  elapsedMs: number; // measured by the server; frozen once the attempt ends
  solution?: string[]; // ONLY present once the attempt has ended
}

/** One row on today's leaderboard. Never contains anyone's letters. */
export interface LeaderboardEntry {
  rank: number | null; // null for players who gave up
  user: User;
  status: 'solved' | 'gaveup';
  assisted: boolean;
  timeMs: number | null; // null for players who gave up
  isMe: boolean;
}

export interface Leaderboard {
  puzzleId: number;
  entries: LeaderboardEntry[];
  streak: number; // the requesting player's current streak of solved days
}

/** What the client is allowed to see before finishing: the shape and the clues, never the letters. */
export interface PuzzleView {
  id: number;
  date: string;
  size: number;
  black: boolean[]; // row-major, length size*size
  clues: Clues;
  author: string;
}
