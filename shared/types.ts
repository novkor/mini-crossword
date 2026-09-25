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

/** What the client is allowed to see before finishing: the shape and the clues, never the letters. */
export interface PuzzleView {
  id: number;
  date: string;
  size: number;
  black: boolean[]; // row-major, length size*size
  clues: Clues;
  author: string;
}
