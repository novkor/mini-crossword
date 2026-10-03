// The API. All checking and timing happens here. The client only ever gets
// right/wrong per cell, and never the solution until its attempt has ended.

import express, { type Request, type Response } from 'express';
import { solutionOf, toView } from '../shared/puzzle';
import { streak } from '../shared/format';
import type { AttemptState, Leaderboard, LeaderboardEntry, PuzzleFile } from '../shared/types';
import { exchangeCode, requireUser, verifyDiscordToken, type VerifyToken } from './auth';
import {
  deleteAttempt, finishedAttempts, getAttempt, saveAttempt, solvedDays, startAttempt, upsertUser, type Attempt, type DB,
} from './db';
import { puzzleForDay, utcDay } from './puzzles';

interface Options {
  db: DB;
  puzzleFor?: (day: string) => PuzzleFile; // tests pin the puzzle
  now?: () => number; // tests control the clock
  allowDevUsers?: boolean; // fake users for local testing, never in production
  verifyToken?: VerifyToken; // tests fake Discord
}

export function createApp({
  db,
  puzzleFor = puzzleForDay,
  now = Date.now,
  allowDevUsers = false,
  verifyToken = verifyDiscordToken,
}: Options) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  // Step 2 of Discord sign-in: trade the code from authorize() for an access token.
  // This is the only /api route that works without being signed in.
  app.post('/api/token', async (req, res) => {
    const code = req.body?.code;
    if (typeof code !== 'string' || !code) return void res.status(400).json({ error: 'Missing code' });
    const accessToken = await exchangeCode(code).catch(() => null);
    if (!accessToken) return void res.status(401).json({ error: 'Discord sign-in failed' });
    res.json({ access_token: accessToken });
  });

  app.use('/api', requireUser({ allowDevUsers, verifyToken }));

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
    upsertUser(db, req.user!); // keep the leaderboard name and avatar current
    // If today's puzzle was swapped during the day (a puzzle file added for a day that
    // was showing a rerun), an attempt at the old puzzle no longer applies: start fresh.
    const old = getAttempt(db, req.user!.id, day);
    if (old && old.puzzleId !== puzzle.id) deleteAttempt(db, req.user!.id, day);
    const attempt = startAttempt(db, req.user!.id, day, puzzle.id, puzzle.size ** 2, now());
    res.json({ me: req.user, puzzle: toView(puzzle), attempt: stateOf(attempt, puzzle) });
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

  // Today's results. Wordle rules: you only get to see them once your own attempt
  // is over, and that's enforced HERE (403), not just hidden in the UI.
  app.get('/api/leaderboard', (req, res) => {
    const day = today();
    const mine = getAttempt(db, req.user!.id, day);
    if (!mine || mine.status === 'playing') {
      return void res.status(403).json({ error: "Finish today's puzzle to see the leaderboard." });
    }
    let rank = 0;
    const entries: LeaderboardEntry[] = finishedAttempts(db, day, mine.puzzleId).map((r) => ({
      rank: r.status === 'solved' ? ++rank : null,
      user: { id: r.user_id, username: r.username, avatar: r.avatar },
      status: r.status,
      assisted: !!r.assisted,
      timeMs: r.status === 'solved' ? r.time_ms : null,
      isMe: r.user_id === req.user!.id,
    }));
    // giving up today ends the streak
    const currentStreak = mine.status === 'solved' ? streak(solvedDays(db, req.user!.id), day) : 0;
    const body: Leaderboard = { puzzleId: mine.puzzleId, entries, streak: currentStreak };
    res.json(body);
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
