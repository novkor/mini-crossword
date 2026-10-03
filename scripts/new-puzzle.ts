// npm run new-puzzle -- [--theme erik | --theme erik,league] [--words LATTE,BEAN] [--size 5|7] [--date YYYY-MM-DD]
//
// Makes the next puzzle file: picks a block pattern, places 1-2 theme words
// (with their ready-made clues from puzzles/_themes.json), fills the rest of the
// grid with common English words, and writes puzzles/<date>.json with the other
// clues set to "TODO". Then write those clues (npm run validate refuses TODOs).

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import wordlists from 'wordlist-english';
import { buildLayout } from '../shared/grid';
import type { PuzzleFile } from '../shared/types';
import { PUZZLE_DIR, puzzleFiles } from '../server/puzzles';

const { values: args } = parseArgs({
  options: { theme: { type: 'string' }, words: { type: 'string' }, size: { type: 'string', default: '5' }, date: { type: 'string' } },
});
const size = Number(args.size);

// Block patterns ('#' = black square), all symmetric like real crosswords.
// ponytail: a fixed handful of patterns; add more here if grids start looking samey.
const PATTERNS: Record<number, string[]> = {
  5: [
    '#..../...../...../...../....#',
    '....#/...../...../...../#....',
    '##.../#..../...../....#/...##',
    '...##/....#/...../#..../##...',
    '#...#/...../...../...../#...#',
  ],
  7: [
    '##...##/#.....#/......./...#.../......./#.....#/##...##',
    '#....##/#....../......./...#.../......./......#/##....#',
  ],
};
if (!PATTERNS[size]) throw new Error('--size must be 5 or 7');

// ---- Words ----
// Tiers 10-35 of the list: everyday words plus some less common ones. (Tiers 10+20 alone are
// too few: a theme word in the middle row often makes the grid impossible to complete.)
const common = new Set(
  [...wordlists['english/10'], ...wordlists['english/20'], ...wordlists['english/35']]
    .filter((w) => /^[a-z]+$/.test(w))
    .map((w) => w.toUpperCase()),
);
// Every existing puzzle file, including unfinished ones with TODO clues (so ids and dates never clash).
const existing: PuzzleFile[] = puzzleFiles().flatMap((f) => {
  try {
    return [JSON.parse(fs.readFileSync(path.join(PUZZLE_DIR, f), 'utf8'))];
  } catch {
    return [];
  }
});
// Don't repeat answers (filler or theme) from earlier puzzles.
const pastAnswers = new Set(existing.flatMap((p) => answersOf(p.grid)));
for (const w of pastAnswers) common.delete(w);
const byLength = new Map<number, string[]>();
for (const w of common) byLength.set(w.length, [...(byLength.get(w.length) ?? []), w]);

// Theme words: from --words, or picked from puzzles/_themes.json.
// A theme is a list of words, or words with ready-made clues: { "ERIK": ["clue", "another clue"] }.
type Theme = string[] | Record<string, string | string[]>;
const themeClues = new Map<string, string[]>(); // word -> clue options
let themeWords: string[] = [];
if (args.words) themeWords = args.words.split(',').map((w) => w.trim().toUpperCase());
else if (args.theme) {
  const themes: Record<string, Theme> = JSON.parse(fs.readFileSync(path.join(PUZZLE_DIR, '_themes.json'), 'utf8'));
  const pools = args.theme.split(',').map((name) => {
    const key = Object.keys(themes).find((k) => k.toLowerCase() === name.trim().toLowerCase());
    if (!key) throw new Error(`No theme "${name}" in puzzles/_themes.json. Known: ${Object.keys(themes).join(', ')}`);
    const theme = themes[key];
    const entries = Array.isArray(theme) ? theme.map((w): [string, string[]] => [w, []]) : Object.entries(theme).map(([w, c]): [string, string[]] => [w, ([] as string[]).concat(c)]);
    for (const [w, c] of entries) themeClues.set(w.toUpperCase(), c);
    const usable = entries.map(([w]) => w.toUpperCase()).filter((w) => w.length >= 3 && w.length <= size && !pastAnswers.has(w));
    if (!usable.length) throw new Error(`Every word in theme "${key}" that fits a ${size}x${size} grid has been used already. Add more words to it.`);
    return shuffle(usable);
  });
  // one theme: two of its words; several themes (--theme erik,league): one word from each
  themeWords = pools.length === 1 ? pools[0].slice(0, 2) : pools.slice(0, 2).map((pool) => pool[0]);
}
if (themeWords.some((w) => !/^[A-Z]{3,}$/.test(w) || w.length > size)) throw new Error(`Theme words must be 3-${size} letters A-Z`);

// ---- Fill ----
// Try both theme words together first; if they can't share a grid, settle for one of them.
const wanted = themeWords;
let grid: string[] | null = null;
for (const words of [wanted, ...wanted.map((w) => [w])]) {
  themeWords = words;
  grid = fill();
  if (grid) break;
}
if (!grid) throw new Error('Could not fill a grid with those theme words. Run it again (it is random), or try other words.');
if (themeWords.length < wanted.length) console.log(`Note: ${wanted.join(' and ')} wouldn't fit together, so only ${themeWords[0]} is used.\n`);

// Puzzle numbers run in date order: one more than the latest puzzle dated before this one.
// (So re-making a deleted day gets its old number back.)
const date = args.date ?? nextFreeDate();
const id = Math.max(0, ...existing.filter((p) => p.date < date).map((p) => p.id)) + 1;
const clash = existing.find((p) => p.id === id);
if (clash) throw new Error(`Puzzle #${id} already exists (${clash.date}). Puzzles must be added in date order.`);
const layout = buildLayout(size, grid.join('').split('').map((c) => c === '#'));
const clues = { across: {} as Record<string, string>, down: {} as Record<string, string> };
for (const w of layout.words) {
  // theme words get one of their ready-made clues; everything else waits for a human
  const word = w.cells.map((c) => grid.join('')[c]).join('');
  clues[w.dir][w.number] = shuffle(themeClues.get(word) ?? [])[0] ?? 'TODO';
}
const puzzle: PuzzleFile = { id, date, size, grid, clues, author: 'Claude' };
const file = path.join(PUZZLE_DIR, `${date}.json`);
if (fs.existsSync(file)) throw new Error(`${file} already exists`);
fs.writeFileSync(file, JSON.stringify(puzzle, null, 2) + '\n');

console.log(`Created puzzles/${date}.json (#${id})\n\n  ${grid.join('\n  ')}\n`);
for (const w of layout.words) {
  const word = w.cells.map((c) => grid.join('')[c]).join('');
  console.log(`  ${w.number}-${w.dir.padEnd(6)} ${word}${themeWords.includes(word) ? '  (theme)' : ''}`);
}
console.log('\nNext: replace every "TODO" with a clue, then run: npm run validate');

// ---------------------------------------------------------------------------

/** Try patterns (in random order) until one fills. Returns the rows, or null. */
function fill(): string[] | null {
  for (const pattern of shuffle(PATTERNS[size])) {
    const rows = pattern.split('/');
    const black = rows.join('').split('').map((c) => c === '#');
    const slots = buildLayout(size, black).words.map((w) => w.cells);
    // try a few different placements of the theme words in this pattern
    // with theme words, try several placements; without, one search per pattern is enough
    for (let attempt = 0; attempt < (themeWords.length ? 20 : 1); attempt++) {
      const cells: (string | null)[] = black.map(() => null);
      const used = new Set<string>();
      if (!placeTheme(slots, cells, used)) break; // no slot of the right length in this pattern
      let budget = 20_000; // search steps before giving up on this placement
      if (search(slots, cells, used, () => --budget > 0)) {
        return rows.map((row, r) => [...row].map((ch, c) => (ch === '#' ? '#' : cells[r * size + c])).join(''));
      }
    }
  }
  return null;
}

/** Put each theme word into a random slot of its length, without clashing letters. */
function placeTheme(slots: number[][], cells: (string | null)[], used: Set<string>): boolean {
  for (const word of themeWords) {
    const fits = shuffle(slots.filter((s) => s.length === word.length && s.every((c, i) => cells[c] === null || cells[c] === word[i])));
    if (!fits.length) return false;
    fits[0].forEach((c, i) => (cells[c] = word[i]));
    used.add(word);
  }
  return true;
}

/** Classic crossword backtracking: always fill the slot with the fewest candidates next. */
function search(slots: number[][], cells: (string | null)[], used: Set<string>, ok: () => boolean): boolean {
  if (!ok()) return false;
  let best: number[] | null = null;
  let bestCands: string[] = [];
  for (const slot of slots) {
    const pattern = slot.map((c) => cells[c]);
    if (pattern.every((x) => x !== null)) {
      const word = pattern.join('');
      if (!common.has(word) && !themeWords.includes(word)) return false; // a crossing made a non-word
      continue;
    }
    const cands = (byLength.get(slot.length) ?? []).filter((w) => !used.has(w) && pattern.every((x, i) => x === null || x === w[i]));
    if (!cands.length) return false;
    if (!best || cands.length < bestCands.length) [best, bestCands] = [slot, cands];
  }
  if (!best) {
    // complete: make sure no word appears twice
    const words = slots.map((s) => s.map((c) => cells[c]).join(''));
    return new Set(words).size === words.length;
  }
  for (const word of shuffle(bestCands)) {
    const before = best.map((c) => cells[c]);
    best.forEach((c, i) => (cells[c] = word[i]));
    used.add(word);
    if (search(slots, cells, used, ok)) return true;
    used.delete(word);
    best.forEach((c, i) => (cells[c] = before[i]));
  }
  return false;
}

function answersOf(rows: string[]): string[] {
  const n = rows.length;
  const black = rows.join('').split('').map((c) => c === '#');
  return buildLayout(n, black).words.map((w) => w.cells.map((c) => rows.join('')[c]).join(''));
}

/** The day after the latest puzzle, or tomorrow if that's already past. (Never today: it may already be in play.) */
function nextFreeDate(): string {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const latest = existing.map((p) => p.date).sort().at(-1);
  const afterLatest = latest && new Date(Date.parse(latest) + 86_400_000).toISOString().slice(0, 10);
  return afterLatest && afterLatest > tomorrow ? afterLatest : tomorrow;
}

function shuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
