import { describe, expect, it } from 'vitest';
import { afterType, arrow, backspace, buildLayout, clickCell, isFull, selectWord, tab, wordAt } from './grid';

// Build a layout from rows like "##..." ('#' = black).
const layoutOf = (rows: string[]) => buildLayout(rows.length, rows.join('').split('').map((ch) => ch === '#'));

// ##BOW / #CUBE / THREE / EASY# / APT##
const L = layoutOf(['##...', '#....', '.....', '....#', '...##']);
const empty = () => Array(25).fill('');

describe('numbering', () => {
  it('numbers cells that start a word, row by row', () => {
    // prettier-ignore
    expect(L.numbers).toEqual([
      null, null, 1, 2, 3,
      null, 4, null, null, null,
      5, null, null, null, null,
      6, null, null, null, null,
      7, null, null, null, null,
    ]);
  });

  it('builds across words then down words with the right cells', () => {
    const summary = L.words.map((w) => `${w.number}${w.dir[0]}:${w.cells.length}`);
    expect(summary).toEqual(['1a:3', '4a:4', '5a:5', '6a:4', '7a:3', '1d:5', '2d:4', '3d:3', '4d:4', '5d:3']);
    expect(L.words.find((w) => w.number === 1 && w.dir === 'down')!.cells).toEqual([2, 7, 12, 17, 22]);
  });

  it('works for a 7x7 grid and skips 1-letter runs', () => {
    const big = layoutOf(['...#...', '.......', '.......', '###.###', '.......', '.......', '...#...']);
    expect(big.numbers[0]).toBe(1);
    expect(big.numbers[4]).toBe(4); // 1,2,3 across the first three columns, then 4
    // the middle cell of row 3 is only part of a down word
    expect(big.wordOf.across[3 * 7 + 3]).toBe(-1);
    expect(big.wordOf.down[3 * 7 + 3]).not.toBe(-1);
  });
});

describe('selection', () => {
  it('clicking the selected cell toggles direction', () => {
    const cur = { cell: 12, dir: 'across' as const };
    expect(clickCell(L, cur, 12)).toEqual({ cell: 12, dir: 'down' });
    expect(clickCell(L, cur, 13)).toEqual({ cell: 13, dir: 'across' });
  });

  it('clicking a black square does nothing', () => {
    const cur = { cell: 12, dir: 'across' as const };
    expect(clickCell(L, cur, 0)).toBe(cur);
  });

  it('won\'t toggle into a direction that has no word', () => {
    // 7x7: the center cell of row 3 only has a down word
    const big = layoutOf(['...#...', '.......', '.......', '###.###', '.......', '.......', '...#...']);
    expect(clickCell(big, { cell: 0, dir: 'across' }, 24)).toEqual({ cell: 24, dir: 'down' });
    expect(clickCell(big, { cell: 24, dir: 'down' }, 24)).toEqual({ cell: 24, dir: 'down' });
  });
});

describe('typing', () => {
  it('advances to the next empty cell in the word, skipping filled ones', () => {
    const letters = empty();
    letters[10] = 'T';
    letters[12] = 'R'; // THREE: T _ R _ _
    const cur = afterType(L, letters, { cell: 10, dir: 'across' }, false);
    expect(cur.cell).toBe(11);
    letters[11] = 'H';
    expect(afterType(L, letters, { cell: 11, dir: 'across' }, false).cell).toBe(13);
  });

  it('wraps to an earlier gap in the same word', () => {
    const letters = empty();
    for (const c of [11, 12, 13, 14]) letters[c] = 'X';
    expect(afterType(L, letters, { cell: 14, dir: 'across' }, false).cell).toBe(10);
  });

  it('jumps to the next unfinished word when a word is completed', () => {
    const letters = empty();
    for (const c of [2, 3, 4]) letters[c] = 'X'; // 1-across complete
    expect(afterType(L, letters, { cell: 4, dir: 'across' }, false)).toEqual({ cell: 6, dir: 'across' });
  });

  it('just steps forward when overwriting a full word', () => {
    const letters = empty();
    for (const c of [2, 3, 4]) letters[c] = 'X';
    expect(afterType(L, letters, { cell: 2, dir: 'across' }, true).cell).toBe(3);
    expect(afterType(L, letters, { cell: 4, dir: 'across' }, true).cell).toBe(4);
  });

  it('backspace clears the cell, or moves back and clears when empty', () => {
    const letters = empty();
    letters[10] = 'T';
    letters[11] = 'H';
    const a = backspace(L, letters, { cell: 11, dir: 'across' });
    expect(a.letters[11]).toBe('');
    expect(a.cursor.cell).toBe(11);
    const b = backspace(L, a.letters, a.cursor);
    expect(b.letters[10]).toBe('');
    expect(b.cursor.cell).toBe(10);
  });
});

describe('navigation', () => {
  it('arrow across the current direction turns first, then moves', () => {
    const cur = { cell: 12, dir: 'across' as const };
    expect(arrow(L, cur, 'ArrowDown')).toEqual({ cell: 12, dir: 'down' });
    expect(arrow(L, { cell: 12, dir: 'down' }, 'ArrowDown')).toEqual({ cell: 17, dir: 'down' });
    expect(arrow(L, cur, 'ArrowRight')).toEqual({ cell: 13, dir: 'across' });
  });

  it('arrows skip black squares and stop at the edge', () => {
    // row 1 is "#....": from cell 6 going left hits the black square then the edge
    expect(arrow(L, { cell: 6, dir: 'across' }, 'ArrowLeft').cell).toBe(6);
    // column 4 is "...##": going down from cell 14 skips nothing and stops
    expect(arrow(L, { cell: 14, dir: 'down' }, 'ArrowDown').cell).toBe(14);
    // column 3 is "....#" from row 0: down from row 3 stops
    expect(arrow(L, { cell: 18, dir: 'down' }, 'ArrowDown').cell).toBe(18);
  });

  it('tab and shift+tab cycle through clues in order', () => {
    const letters = empty();
    const last = { cell: 20, dir: 'down' as const }; // 5-down is the last word
    expect(wordAt(L, last).number).toBe(5);
    expect(tab(L, letters, last)).toEqual({ cell: 2, dir: 'across' }); // wraps to 1-across
    expect(tab(L, letters, { cell: 2, dir: 'across' }, true)).toEqual({ cell: 10, dir: 'down' });
  });

  it('selecting a word goes to its first empty cell', () => {
    const letters = empty();
    letters[10] = 'T';
    expect(selectWord(L, letters, 2)).toEqual({ cell: 11, dir: 'across' });
  });
});

describe('completion', () => {
  it('isFull only when every white cell has a letter', () => {
    const letters = empty();
    L.black.forEach((b, i) => !b && (letters[i] = 'A'));
    expect(isFull(L, letters)).toBe(true);
    letters[12] = '';
    expect(isFull(L, letters)).toBe(false);
  });
});
