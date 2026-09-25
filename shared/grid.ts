// Pure crossword logic: numbering, words and cursor movement.
// No DOM here, so everything is easy to unit test (see grid.test.ts).
//
// Cells are identified by a single index: cell = row * size + col.
// Letters are a string[] of the same length; '' means empty.

import type { Dir } from './types';

export interface Word {
  number: number; // the clue number
  dir: Dir;
  cells: number[]; // cell indexes, in reading order
}

export interface Layout {
  size: number;
  black: boolean[];
  numbers: (number | null)[]; // the small number printed in a cell's corner
  words: Word[]; // every across word (in clue order), then every down word
  wordOf: Record<Dir, number[]>; // wordOf.across[cell] = index into `words`, or -1
}

/** Where the player is: one cell plus the direction they're typing in. */
export interface Cursor {
  cell: number;
  dir: Dir;
}

/**
 * Compute clue numbers and words from the black squares, the standard way:
 * scanning row by row, a cell gets the next number if it starts an across
 * word or a down word (a run of 2+ white cells).
 */
export function buildLayout(size: number, black: boolean[]): Layout {
  const open = (r: number, c: number) => r >= 0 && c >= 0 && r < size && c < size && !black[r * size + c];
  const numbers: (number | null)[] = Array(size * size).fill(null);
  const across: Word[] = [];
  const down: Word[] = [];
  let n = 0;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!open(r, c)) continue;
      const startsAcross = !open(r, c - 1) && open(r, c + 1);
      const startsDown = !open(r - 1, c) && open(r + 1, c);
      if (!startsAcross && !startsDown) continue;
      numbers[r * size + c] = ++n;
      if (startsAcross) {
        const cells = [];
        for (let k = c; open(r, k); k++) cells.push(r * size + k);
        across.push({ number: n, dir: 'across', cells });
      }
      if (startsDown) {
        const cells = [];
        for (let k = r; open(k, c); k++) cells.push(k * size + c);
        down.push({ number: n, dir: 'down', cells });
      }
    }
  }

  const words = [...across, ...down];
  const wordOf = { across: Array(size * size).fill(-1), down: Array(size * size).fill(-1) };
  words.forEach((w, i) => w.cells.forEach((cell) => (wordOf[w.dir][cell] = i)));
  return { size, black, numbers, words, wordOf };
}

const other = (dir: Dir): Dir => (dir === 'across' ? 'down' : 'across');

/** The word the cursor is in (every white cell belongs to at least one word). */
export function wordAt(layout: Layout, cur: Cursor): Word {
  return layout.words[layout.wordOf[cur.dir][cur.cell]];
}

/** Keep the direction if the cell has a word that way, otherwise flip it. */
function fixDir(layout: Layout, cell: number, dir: Dir): Cursor {
  return { cell, dir: layout.wordOf[dir][cell] !== -1 ? dir : other(dir) };
}

/** The first white cell, in the across direction: where the game starts. */
export function startCursor(layout: Layout): Cursor {
  return { cell: layout.words[0].cells[0], dir: layout.words[0].dir };
}

/** Clicking a cell selects it; clicking the selected cell again toggles across/down. */
export function clickCell(layout: Layout, cur: Cursor, cell: number): Cursor {
  if (layout.black[cell]) return cur;
  if (cell === cur.cell) return fixDir(layout, cell, other(cur.dir));
  return fixDir(layout, cell, cur.dir);
}

/** Select a whole word (e.g. from the clue list): go to its first empty cell, or its first cell if full. */
export function selectWord(layout: Layout, letters: string[], wordIndex: number): Cursor {
  const w = layout.words[wordIndex];
  return { cell: w.cells.find((c) => !letters[c]) ?? w.cells[0], dir: w.dir };
}

/** Tab / Shift+Tab: jump to the next / previous clue, wrapping around. */
export function tab(layout: Layout, letters: string[], cur: Cursor, backwards = false): Cursor {
  const count = layout.words.length;
  const i = layout.wordOf[cur.dir][cur.cell];
  return selectWord(layout, letters, (i + (backwards ? -1 : 1) + count) % count);
}

/**
 * Where the cursor goes after typing a letter.
 * - Overwriting inside an already-full word: step to the next cell (stop at the end).
 * - Otherwise: the next empty cell in this word (wrapping to its start).
 * - If that letter completed the word: jump to the next word that still has gaps.
 */
export function afterType(layout: Layout, letters: string[], cur: Cursor, wordWasFull: boolean): Cursor {
  const word = wordAt(layout, cur);
  const pos = word.cells.indexOf(cur.cell);
  if (wordWasFull) return { ...cur, cell: word.cells[Math.min(pos + 1, word.cells.length - 1)] };

  const rest = [...word.cells.slice(pos + 1), ...word.cells.slice(0, pos)];
  const empty = rest.find((c) => !letters[c]);
  if (empty !== undefined) return { ...cur, cell: empty };

  // Word complete: look for the next word (in clue order) with an empty cell.
  const count = layout.words.length;
  const start = layout.wordOf[cur.dir][cur.cell];
  for (let k = 1; k < count; k++) {
    const i = (start + k) % count;
    if (layout.words[i].cells.some((c) => !letters[c])) return selectWord(layout, letters, i);
  }
  return cur; // the whole grid is full
}

/**
 * Backspace: if the cell has a letter, clear it and stay.
 * If it's already empty, move back one cell in the word and clear that one.
 */
export function backspace(layout: Layout, letters: string[], cur: Cursor): { letters: string[]; cursor: Cursor } {
  const out = letters.slice();
  if (out[cur.cell]) {
    out[cur.cell] = '';
    return { letters: out, cursor: cur };
  }
  const word = wordAt(layout, cur);
  const pos = word.cells.indexOf(cur.cell);
  const cell = word.cells[Math.max(pos - 1, 0)];
  out[cell] = '';
  return { letters: out, cursor: { ...cur, cell } };
}

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/**
 * Arrow keys. Pressing an arrow across the current direction first just turns
 * the cursor (like the NYT mini); otherwise it moves, skipping black squares.
 */
export function arrow(layout: Layout, cur: Cursor, key: ArrowKey): Cursor {
  const dir: Dir = key === 'ArrowLeft' || key === 'ArrowRight' ? 'across' : 'down';
  if (dir !== cur.dir && layout.wordOf[dir][cur.cell] !== -1) return { ...cur, dir };

  const { size } = layout;
  const [dr, dc] = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[key];
  let r = Math.floor(cur.cell / size) + dr;
  let c = (cur.cell % size) + dc;
  for (; r >= 0 && c >= 0 && r < size && c < size; r += dr, c += dc) {
    if (!layout.black[r * size + c]) return fixDir(layout, r * size + c, cur.dir);
  }
  return cur; // hit the edge
}

/** True when every white cell has a letter. */
export function isFull(layout: Layout, letters: string[]): boolean {
  return layout.black.every((b, i) => b || !!letters[i]);
}
