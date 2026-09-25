// Helpers for turning a puzzle file into what each side needs.

import type { PuzzleFile, PuzzleView } from './types';

/** The answer letters, row-major; '' for black squares. */
export function solutionOf(p: PuzzleFile): string[] {
  return p.grid.join('').split('').map((ch) => (ch === '#' ? '' : ch.toUpperCase()));
}

/** Strip the answers: only the shape, clues and metadata go to the client. */
export function toView(p: PuzzleFile): PuzzleView {
  return {
    id: p.id,
    date: p.date,
    size: p.size,
    black: p.grid.join('').split('').map((ch) => ch === '#'),
    clues: p.clues,
    author: p.author,
  };
}
