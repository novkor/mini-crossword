import { describe, expect, it } from 'vitest';
import type { PuzzleFile } from '../shared/types';
import { loadPuzzles, pickPuzzle, puzzleFiles, validatePuzzle } from './puzzles';

const puzzles = loadPuzzles();
const P1 = puzzles[0]; // #DARE / RELAY / ABOVE / TUNES / EGGS#
const clone = (p: PuzzleFile): PuzzleFile => JSON.parse(JSON.stringify(p));

describe('validator', () => {
  it('accepts all shipped puzzles', () => {
    // every file in /puzzles loads (loadPuzzles skips invalid ones), and numbers run 1, 2, 3... by date
    expect(puzzles).toHaveLength(puzzleFiles().length);
    for (const p of puzzles) expect(validatePuzzle(p)).toEqual([]);
    const byDate = [...puzzles].sort((a, b) => a.date.localeCompare(b.date));
    expect(byDate.map((p) => p.id)).toEqual(byDate.map((_, i) => i + 1));
  });

  it('rejects a grid that is not square', () => {
    const p = clone(P1);
    p.grid[2] = 'ABOV';
    expect(validatePuzzle(p).join()).toMatch(/row 3 has 4 cells/);
  });

  it('rejects bad characters', () => {
    const p = clone(P1);
    p.grid[1] = 'relay';
    expect(validatePuzzle(p).join()).toMatch(/only contain A-Z/);
  });

  it('reports missing and extra clues', () => {
    const p = clone(P1);
    delete p.clues.down['3'];
    p.clues.across['9'] = 'No such word';
    const errors = validatePuzzle(p).join('\n');
    expect(errors).toMatch(/missing clue for 3-down/);
    expect(errors).toMatch(/extra clue 9-across/);
  });

  it('rejects a white cell that belongs to no word', () => {
    const p = clone(P1);
    p.grid = ['A#AAA', '##AAA', 'AAAAA', 'AAAAA', 'AAAAA'];
    expect(validatePuzzle(p).join()).toMatch(/row 1, column 1 is not part of any word/);
  });

  it('rejects clues that are still TODO (from npm run new-puzzle)', () => {
    const p = clone(P1);
    p.clues.across['5'] = 'TODO';
    expect(validatePuzzle(p).join()).toMatch(/5-across is still TODO/);
  });

  it('checks the file name matches the date', () => {
    expect(validatePuzzle(P1, 'wrong.json').join()).toMatch(/2026-09-25\.json/);
  });
});

describe('daily rotation', () => {
  it('picks the puzzle dated today', () => {
    expect(pickPuzzle(puzzles, '2026-09-27').id).toBe(3);
  });

  it('falls back to a rerun of a past puzzle, never a future one', () => {
    // after the last puzzle: reruns come from the past
    expect(pickPuzzle(puzzles, '2026-12-01').date < '2026-12-01').toBe(true);
    // a missing day in the middle: only puzzles dated before it are eligible, never #5-#7
    const withGap = puzzles.filter((p) => p.date !== '2026-09-28');
    expect(pickPuzzle(withGap, '2026-09-28').date < '2026-09-28').toBe(true);
  });

  it('cycles through different puzzles on consecutive days', () => {
    const ids = ['2027-01-01', '2027-01-02', '2027-01-03'].map((d) => pickPuzzle(puzzles, d).id);
    expect(new Set(ids).size).toBe(3);
  });
});
