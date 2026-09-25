// The API. All checking and timing happens here. The client only ever gets
// right/wrong per cell, and never the solution until its attempt has ended.
//
// FREE AND FAIR: the daily puzzle routes below must never depend on paid
// entitlements. Nothing bought may help anyone solve faster or rank higher.

import express, { type Request, type Response } from 'express';
import { solutionOf, toView } from '../shared/puzzle';
import type { AttemptState, PuzzleFile } from '../shared/types';
import { requireUser } from './auth';
import { getAttempt, saveAttempt, startAttempt, type Attempt, type DB } from './db';
import { puzzleForDay, utcDay } from './puzzles';

interface Options {
  db: DB;
  puzzleFor?: (day: string) => PuzzleFile; // tests pin the puzzle
  now?: () => number; // tests control the clock
  allowDevUsers?: boolean; // fake users for local testing, never in production
}

export function createApp({ db, puzzleFor = puzzleForDay, now = Date.now, allowDevUsers = false }: Options) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use('/api', requireUser({ allowDevUsers }));

  const today = () => utcDay(new Date(now()));

  /** The attempt as the client may see it. This is the ONLY place the solution is ever sent. */
  function stateOf(a: Attempt, puzzle: PuzzleFile): AttemptState {
    const ended = a.status !== 'playing';
    return {
      status: a.status,
      letters: a.letters,
      revealed: a.revealed,
      assisted: a.assisted,
      elapsedMs: (a.endedAt ?? now()) - a.startedAt,
      ...(ended && { solution: solutionOf(puzzle) }),
    };
  }

  /**
   * Load the player's in-progress attempt for a game action, or reply with an error:
   * 409 if the day rolled over (they have yesterday's puzzle open) or if they've already finished.
   */
  function activeAttempt(req: Request, res: Response): { puzzle: PuzzleFile; attempt: Attempt } | null {
    const puzzle = puzzleFor(today());
    const attempt = getAttempt(db, req.user!.id, today());
    if (req.body?.puzzleId !== puzzle.id || !attempt || attempt.puzzleId !== puzzle.id) {
      res.status(409).json({ error: 'A new puzzle is out. Reload to play it.' });
      return null;
    }
    if (attempt.status !== 'playing') {
      res.status(409).json({ error: "You've already finished today's puzzle.", attempt: stateOf(attempt, puzzle) });
      return null;
    }
    return { puzzle, attempt };
  }

  /**
   * After the letters or reveals change: end the attempt if it's now solved,
   * or if every cell has been revealed (which counts as giving up). Then save.
   */
  function settle(a: Attempt, puzzle: PuzzleFile, res: Response): boolean {
    const solution = solutionOf(puzzle);
    // a revealed cell the player has since typed over no longer counts as revealed
    a.revealed = a.revealed.filter((c) => a.letters[c] === solution[c]);
    const whiteCells = solution.filter(Boolean).length;
    if (a.revealed.length === whiteCells) a.status = 'gaveup';
    else if (solution.every((s, i) => s === a.letters[i])) a.status = 'solved';
    if (a.status !== 'playing') a.endedAt = now(); // the finish time comes from the server's clock

    if (!saveAttempt(db, a)) {
      // another request ended the attempt first (e.g. two tabs): report the real state
      const current = getAttempt(db, a.userId, a.day)!;
      res.status(409).json({ error: "You've already finished today's puzzle.", attempt: stateOf(current, puzzle) });
      return false;
    }
    return true;
  }

  // Today's puzzle and the player's attempt. The first load starts the timer
  // (the clues are visible from this moment, so that's when solving begins).
  app.get('/api/puzzle', (req, res) => {
    const day = today();
    const puzzle = puzzleFor(day);
    const attempt = startAttempt(db, req.user!.id, day, puzzle.id, puzzle.size ** 2, now());
    res.json({ puzzle: toView(puzzle), attempt: stateOf(attempt, puzzle) });
  });

  // Save progress. Solving is detected here, on the server.
  app.post('/api/save', (req, res) => {
    const ctx = activeAttempt(req, res);
    if (!ctx) return;
    const letters = parseLetters(req.body.letters, ctx.puzzle);
    if (!letters) return void res.status(400).json({ error: 'Invalid letters' });
    ctx.attempt.letters = letters;
    if (settle(ctx.attempt, ctx.puzzle, res)) res.json({ attempt: stateOf(ctx.attempt, ctx.puzzle) });
  });

  // Right/wrong for the requested cells, nothing more. Marks the solve as assisted.
  app.post('/api/check', (req, res) => {
    const ctx = activeAttempt(req, res);
    if (!ctx) return;
    const letters = parseLetters(req.body.letters, ctx.puzzle);
    const cells = parseCells(req.body.cells, ctx.puzzle);
    if (!letters || !cells) return void res.status(400).json({ error: 'Invalid request' });
    const solution = solutionOf(ctx.puzzle);
    ctx.attempt.letters = letters;
    ctx.attempt.assisted = true;
    if (settle(ctx.attempt, ctx.puzzle, res)) {
      res.json({ results: cells.map((c) => letters[c] === solution[c]), attempt: stateOf(ctx.attempt, ctx.puzzle) });
    }
  });

  // One letter. Marks the solve as assisted; revealing every cell counts as giving up.
  app.post('/api/reveal', (req, res) => {
    const ctx = activeAttempt(req, res);
    if (!ctx) return;
    const cells = parseCells([req.body.cell], ctx.puzzle);
    if (!cells) return void res.status(400).json({ error: 'Invalid cell' });
    const [cell] = cells;
    const letter = solutionOf(ctx.puzzle)[cell];
    const a = ctx.attempt;
    a.letters[cell] = letter;
    if (!a.revealed.includes(cell)) a.revealed.push(cell);
    a.assisted = true;
    if (settle(a, ctx.puzzle, res)) res.json({ letter, attempt: stateOf(a, ctx.puzzle) });
  });

  // End the attempt. The response includes the solution because the attempt is now over.
  app.post('/api/give-up', (req, res) => {
    const ctx = activeAttempt(req, res);
    if (!ctx) return;
    const a = ctx.attempt;
    a.status = 'gaveup';
    a.endedAt = now();
    if (!saveAttempt(db, a)) return void res.status(409).json({ error: "You've already finished today's puzzle." });
    res.json({ attempt: stateOf(a, ctx.puzzle) });
  });

  return app;
}

// ---- Input validation: never trust what the client sends ----

/** A letters array must match the grid: one entry per cell, each '' or a single A-Z. */
function parseLetters(value: unknown, p: PuzzleFile): string[] | null {
  if (!Array.isArray(value) || value.length !== p.size ** 2) return null;
  if (!value.every((v) => v === '' || (typeof v === 'string' && /^[A-Z]$/.test(v)))) return null;
  return value;
}

/** Cell indexes must be whole numbers inside the grid, and not black squares. */
function parseCells(value: unknown, p: PuzzleFile): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > p.size ** 2) return null;
  const grid = p.grid.join('');
  const ok = value.every((c) => Number.isInteger(c) && c >= 0 && c < p.size ** 2 && grid[c] !== '#');
  return ok ? value : null;
}
