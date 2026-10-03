// npm run validate: checks every puzzle file and exits with an error if any is broken.

import fs from 'node:fs';
import path from 'node:path';
import { PUZZLE_DIR, puzzleFiles, validatePuzzle } from '../server/puzzles';
import type { PuzzleFile } from '../shared/types';

let failed = false;
const seenIds = new Map<number, string>();

for (const file of puzzleFiles()) {
  let errors: string[];
  try {
    const p = JSON.parse(fs.readFileSync(path.join(PUZZLE_DIR, file), 'utf8')) as PuzzleFile;
    errors = validatePuzzle(p, file);
    if (seenIds.has(p.id)) errors.push(`id ${p.id} is already used by ${seenIds.get(p.id)}`);
    seenIds.set(p.id, file);
  } catch (e) {
    errors = [`not valid JSON: ${(e as Error).message}`];
  }
  if (errors.length) failed = true;
  console.log(errors.length ? `✗ ${file}\n    ${errors.join('\n    ')}` : `✓ ${file}`);
}

// (Two files can't share a date: the file name is the date, and validatePuzzle checks it matches.)
process.exit(failed ? 1 : 0);
