// The crossword UI. All the grid rules live in shared/grid.ts; this file just
// keeps the game state, turns input into grid actions, and draws the result.

import * as api from './api';
import {
  afterType, arrow, backspace, buildLayout, clickCell, isFull, selectWord, startCursor, tab, wordAt,
  type ArrowKey, type Cursor, type Layout,
} from '../../shared/grid';
import type { AttemptState, AttemptStatus, PuzzleView } from '../../shared/types';

type Mark = '' | 'wrong' | 'right' | 'revealed';

// ---- Game state ----
let puzzle: PuzzleView;
let layout: Layout;
let letters: string[];
let marks: Mark[]; // result of check / reveal, per cell
let cursor: Cursor;
let status: AttemptStatus = 'playing';
// The server measures time. We remember its last reported elapsed time and when
// we received it, and count up from there between requests.
let clock = { elapsedMs: 0, receivedAt: Date.now() };

// ---- DOM ----
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = $('board');
const kbd = $<HTMLInputElement>('kbd');
const cellEls: HTMLElement[] = [];
const clueEls: HTMLElement[] = []; // one <li> per word, same order as layout.words

async function init() {
  const res = await api.loadPuzzle();
  puzzle = res.puzzle;
  layout = buildLayout(puzzle.size, puzzle.black);
  // Resume where we left off (on any device): letters and reveals come from the server.
  letters = res.attempt.letters;
  marks = letters.map((_, i) => (res.attempt.revealed.includes(i) ? 'revealed' : ''));
  cursor = startCursor(layout);
  cursor = selectWord(layout, letters, layout.wordOf[cursor.dir][cursor.cell]); // first empty cell

  $('title').textContent = `Mini Crossword #${puzzle.id}`;
  $('byline').textContent = `${puzzle.date} · by ${puzzle.author}`;
  buildBoard();
  buildClues();
  applyAttempt(res.attempt);
  render();
  setInterval(renderTimer, 1000);
}

/** Take in the server's view of our attempt: the time, and whether it has ended. */
function applyAttempt(a: AttemptState) {
  clock = { elapsedMs: a.elapsedMs, receivedAt: Date.now() };
  if (a.status !== 'playing' && status === 'playing') finish(a);
}

function buildBoard() {
  board.style.setProperty('--n', String(puzzle.size));
  for (let i = 0; i < puzzle.size ** 2; i++) {
    const el = document.createElement('div');
    el.className = 'cell';
    if (layout.black[i]) el.classList.add('black');
    else {
      el.innerHTML = `<span class="num">${layout.numbers[i] ?? ''}</span><span class="letter"></span>`;
      // pointerdown (not click) so the keyboard pops up in the same gesture on mobile
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        cursor = clickCell(layout, cursor, i);
        focusKeyboard();
        render();
      });
    }
    board.append(el);
    cellEls.push(el);
  }
}

function buildClues() {
  layout.words.forEach((w, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${w.number}</b><span></span>`;
    // textContent (not innerHTML) for clue text: never inject data as HTML
    li.querySelector('span')!.textContent = puzzle.clues[w.dir][w.number];
    li.addEventListener('click', () => {
      cursor = selectWord(layout, letters, i);
      focusKeyboard();
      render();
    });
    $(w.dir).append(li);
    clueEls.push(li);
  });
}

// ---- Drawing ----
function render() {
  const active = wordAt(layout, cursor);
  const crossIdx = layout.wordOf[cursor.dir === 'across' ? 'down' : 'across'][cursor.cell];

  cellEls.forEach((el, i) => {
    if (layout.black[i]) return;
    el.querySelector('.letter')!.textContent = letters[i];
    el.classList.toggle('sel', i === cursor.cell && status === 'playing');
    el.classList.toggle('word', active.cells.includes(i) && status === 'playing');
    el.classList.toggle('wrong', marks[i] === 'wrong');
    el.classList.toggle('right', marks[i] === 'right');
    el.classList.toggle('revealed', marks[i] === 'revealed');
  });

  clueEls.forEach((li, i) => {
    li.classList.toggle('active', layout.words[i] === active);
    li.classList.toggle('cross', i === crossIdx);
    li.classList.toggle('filled', layout.words[i].cells.every((c) => letters[c]));
  });
  scrollIntoList(clueEls[layout.words.indexOf(active)]);

  $('clue-text').innerHTML = `<b>${active.number}${active.dir[0].toUpperCase()}</b> <span></span>`;
  $('clue-text').querySelector('span')!.textContent = puzzle.clues[active.dir][active.number];

  const over = status !== 'playing';
  $('tools').hidden = over;
  $('done').hidden = !over;
  document.body.classList.toggle('over', over);
  document.body.classList.toggle('solved', status === 'solved');
  renderTimer();
}

// Keep the active clue visible inside its scrollable list without scrolling the whole page.
function scrollIntoList(li: HTMLElement) {
  const ol = li.parentElement!;
  const top = li.offsetTop; // relative to the <ol>, which is position: relative
  if (top < ol.scrollTop || top + li.offsetHeight > ol.scrollTop + ol.clientHeight) {
    ol.scrollTop = top - ol.clientHeight / 3;
  }
}

function renderTimer() {
  const ms = clock.elapsedMs + (status === 'playing' ? Date.now() - clock.receivedAt : 0);
  $('timer').textContent = formatTime(ms);
}

function formatTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
}

// ---- Actions ----
function typeLetter(ch: string) {
  if (status !== 'playing') return;
  const wordWasFull = wordAt(layout, cursor).cells.every((c) => letters[c]);
  if (letters[cursor.cell] !== ch) marks[cursor.cell] = ''; // a changed letter loses its check/reveal mark
  letters[cursor.cell] = ch;
  cursor = afterType(layout, letters, cursor, wordWasFull);
  changed();
}

function erase() {
  if (status !== 'playing') return;
  const res = backspace(layout, letters, cursor);
  // clear the mark on whichever cell got emptied
  for (const c of [cursor.cell, res.cursor.cell]) if (letters[c] !== res.letters[c]) marks[c] = '';
  letters = res.letters;
  cursor = res.cursor;
  changed();
}

/** Called after every edit: redraw and save. */
function changed() {
  render();
  saveSoon();
}

// Saves go out one at a time, always with the latest letters. While a save is
// in flight, further edits just set `dirty`, and one more save follows. This
// keeps saves in order (an old save can never overwrite a newer one).
let saving = false;
let dirty = false;
async function saveSoon() {
  dirty = true;
  if (saving) return;
  saving = true;
  try {
    while (dirty && status === 'playing') {
      dirty = false;
      const sent = letters.slice();
      const { attempt } = await api.save(sent);
      applyAttempt(attempt); // the server decides if this solved it
      if (attempt.status === 'playing' && isFull(layout, sent) && !dirty) {
        toast("Not quite — something's off. Keep going!");
      }
    }
  } finally {
    saving = false;
  }
}

/** The attempt is over (solved or gave up): show the solution and the result. */
function finish(a: AttemptState) {
  status = a.status;
  kbd.blur();
  // on give-up, mark every cell the player didn't have right
  a.solution!.forEach((ch, i) => {
    if (ch && letters[i] !== ch) marks[i] = 'revealed';
  });
  letters = a.solution!.slice();
  const time = formatTime(a.elapsedMs);
  $('done').innerHTML =
    a.status === 'solved'
      ? `<h2>Solved! 🎉</h2><p class="big">${time}</p><p class="muted">${a.assisted ? 'Assisted solve (used check or reveal)' : 'Clean solve, no help'}</p>`
      : `<h2>Better luck tomorrow</h2><p class="muted">Here's the solution.</p>`;
  render();
}

async function runTool(action: string) {
  if (status !== 'playing') return;
  const white = layout.black.flatMap((b, i) => (b ? [] : [i]));

  if (action === 'check-cell' || action === 'check-puzzle') {
    const cells = (action === 'check-cell' ? [cursor.cell] : white).filter((c) => letters[c]);
    if (!cells.length) return toast('Nothing to check yet');
    const sent = letters.slice();
    const { results, attempt } = await api.check(sent, cells);
    // The player may have kept typing while we waited: only mark letters that haven't changed.
    cells.forEach((c, k) => {
      if (letters[c] === sent[c] && marks[c] !== 'revealed') marks[c] = results[k] ? 'right' : 'wrong';
    });
    if (action === 'check-puzzle' && results.every(Boolean)) toast('Everything so far is correct');
    render();
    applyAttempt(attempt);
  } else if (action === 'reveal-cell') {
    const cell = cursor.cell; // remember it: the cursor may move while we wait
    const { letter, attempt } = await api.reveal(cell);
    letters[cell] = letter;
    marks[cell] = 'revealed';
    applyAttempt(attempt); // revealing the last cell may end the attempt
    changed();
  } else if (action === 'clear') {
    // Clears typed letters only. Revealed letters stay, and so do the timer and the "assisted" flag.
    letters = letters.map((l, i) => (marks[i] === 'revealed' ? l : ''));
    marks = marks.map((m) => (m === 'revealed' ? m : ''));
    cursor = selectWord(layout, letters, 0);
    changed();
  } else if (action === 'give-up') {
    const { attempt } = await api.giveUp();
    applyAttempt(attempt);
  }
}

// Buttons with data-confirm need two taps: the first arms them, the second runs.
// (window.confirm() is blocked inside the Discord iframe, so we can't use it.)
$('tools').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  const { action, confirm } = btn.dataset;
  if (confirm && !btn.classList.contains('armed')) {
    const label = btn.textContent;
    btn.classList.add('armed');
    btn.textContent = confirm;
    setTimeout(() => {
      btn.classList.remove('armed');
      btn.textContent = label;
    }, 3000);
    return;
  }
  btn.classList.remove('armed');
  runTool(action!);
});

// ---- Keyboard ----
function focusKeyboard() {
  if (status !== 'playing') return;
  kbd.focus({ preventScroll: true });
  resetKbd();
}

// The hidden input always holds one space. On phones, pressing backspace deletes
// it (an `input` event we can see) even though the cell looks empty.
function resetKbd() {
  kbd.value = ' ';
  kbd.setSelectionRange(1, 1);
}

function move(to: Cursor) {
  cursor = to;
  render();
}

document.addEventListener('keydown', (e) => {
  if (status !== 'playing' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLTextAreaElement) return; // e.g. the share box later

  if (/^[a-zA-Z]$/.test(e.key)) typeLetter(e.key.toUpperCase());
  else if (e.key === 'Backspace' || e.key === 'Delete') erase();
  else if (e.key.startsWith('Arrow')) move(arrow(layout, cursor, e.key as ArrowKey));
  else if (e.key === 'Tab' || e.key === 'Enter') move(tab(layout, letters, cursor, e.shiftKey));
  else if (e.key === ' ') move(clickCell(layout, cursor, cursor.cell)); // space toggles direction
  else return; // anything else: let the browser handle it (and the input event below)
  e.preventDefault();
});

// Mobile keyboards often send keydown with key "Unidentified", so we also read
// whatever actually landed in the hidden input.
kbd.addEventListener('input', () => {
  const value = kbd.value;
  if (value === '') erase();
  for (const ch of value.replace(/[^a-z]/gi, '')) typeLetter(ch.toUpperCase());
  resetKbd();
});

$('prev-clue').addEventListener('click', () => (move(tab(layout, letters, cursor, true)), focusKeyboard()));
$('next-clue').addEventListener('click', () => (move(tab(layout, letters, cursor)), focusKeyboard()));
$('clue-text').addEventListener('click', () => (move(clickCell(layout, cursor, cursor.cell)), focusKeyboard()));

// Any failed server call (network down, a new puzzle at midnight...) shows up as a toast.
// If the server says we've already finished (e.g. solved in another tab), show that.
window.addEventListener('unhandledrejection', (e) => {
  toast(e.reason?.message ?? 'Something went wrong');
  if (e.reason instanceof api.ApiError && e.reason.data.attempt) applyAttempt(e.reason.data.attempt);
});

init();
