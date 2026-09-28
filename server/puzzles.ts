// Loading, validating and picking the daily puzzle. Puzzle files never leave the server.

import fs from 'node:fs';
import path from 'node:path';
import { buildLayout } from '../shared/grid';
import type { PuzzleFile } from '../shared/types';

export const PUZZLE_DIR = path.join(import.meta.dirname, '..', 'puzzles');

/** "2026-09-25" for the given moment, in UTC. The daily puzzle switches at 00:00 UTC. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Returns a list of problems; an empty list means the puzzle is valid. */
export function validatePuzzle(p: PuzzleFile, fileName?: string): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(p.id) || p.id < 1) errors.push('id must be a positive whole number');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || isNaN(Date.parse(p.date))) errors.push(`date "${p.date}" must be YYYY-MM-DD`);
  if (fileName && fileName !== `${p.date}.json`) errors.push(`file should be named ${p.date}.json`);
  if (typeof p.author !== 'string' || !p.author) errors.push('author is missing');

  // Grid must be square: `size` rows, each `size` characters of A-Z or '#'.
  if (!Number.isInteger(p.size) || p.size < 3 || p.size > 15) errors.push('size must be between 3 and 15');
  if (!Array.isArray(p.grid) || p.grid.length !== p.size) errors.push(`grid must have ${p.size} rows`);
  p.grid?.forEach((row, r) => {
    if (row.length !== p.size) errors.push(`row ${r + 1} has ${row.length} cells, expected ${p.size}`);
    if (!/^[A-Z#]*$/.test(row)) errors.push(`row ${r + 1} may only contain A-Z and #`);
  });
  if (errors.length) return errors; // the checks below need a well-formed grid

  // Every white cell must belong to at least one word (no isolated letters).
  const layout = buildLayout(p.size, p.grid.join('').split('').map((ch) => ch === '#'));
  layout.black.forEach((black, i) => {
    if (!black && layout.wordOf.across[i] === -1 && layout.wordOf.down[i] === -1) {
      errors.push(`cell at row ${Math.floor(i / p.size) + 1}, column ${(i % p.size) + 1} is not part of any word`);
    }
  });

  // Every numbered word has a clue, and there are no extra clues.
  for (const dir of ['across', 'down'] as const) {
    const expected = layout.words.filter((w) => w.dir === dir).map((w) => String(w.number));
    const actual = Object.keys(p.clues?.[dir] ?? {});
    for (const n of expected) {
      if (!p.clues?.[dir]?.[n]?.trim()) errors.push(`missing clue for ${n}-${dir}`);
    }
    for (const n of actual) {
      if (!expected.includes(n)) errors.push(`extra clue ${n}-${dir}: there is no such word in the grid`);
    }
  }
  return errors;
}

/** Read and validate every puzzle file. Invalid files are skipped (and reported) so one typo can't take the game down. */
export function loadPuzzles(dir = PUZZLE_DIR): PuzzleFile[] {
  const puzzles: PuzzleFile[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as PuzzleFile;
      const errors = validatePuzzle(p, file);
      if (errors.length) console.error(`Skipping ${file}: ${errors.join('; ')}`);
      else puzzles.push(p);
    } catch (e) {
      console.error(`Skipping ${file}: ${(e as Error).message}`);
    }
  }
  return puzzles.sort((a, b) => a.id - b.id);
}

/**
 * The puzzle for a given UTC day: the one dated that day, or else a rerun.
 * Reruns cycle through PAST puzzles only, so a missing day never spoils a future puzzle.
 */
export function pickPuzzle(puzzles: PuzzleFile[], day: string): PuzzleFile {
  const exact = puzzles.find((p) => p.date === day);
  if (exact) return exact;
  const past = puzzles.filter((p) => p.date < day);
  const pool = past.length ? past : puzzles;
  if (!pool.length) throw new Error('No valid puzzles found in /puzzles');
  const dayNumber = Math.floor(Date.parse(day) / 86_400_000); // days since 1970-01-01
  return pool[dayNumber % pool.length];
}

/**
 * The puzzle for a UTC day, read from disk once per day. Caching per day also
 * means the puzzle never changes halfway through a day, even if files are edited.
 */
let cache: { day: string; puzzle: PuzzleFile } | null = null;
export function puzzleForDay(day: string): PuzzleFile {
  if (cache?.day !== day) cache = { day, puzzle: pickPuzzle(loadPuzzles(), day) };
  return cache.puzzle;
}
