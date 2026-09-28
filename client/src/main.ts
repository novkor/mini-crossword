// The crossword UI. All the grid rules live in shared/grid.ts; this file just
// keeps the game state, turns input into grid actions, and draws the result.

import '@fontsource-variable/inter'; // bundled with the app: Discord's sandbox blocks Google Fonts
import * as api from './api';
import { avatarUrl, inDiscord, shareToChat, signIn } from './discord';
import { fillIcons, icon } from './icons';
import { formatCountdown, formatTime, msUntilNextPuzzle, shareText } from '../../shared/format';
import {
  afterType, arrow, backspace, buildLayout, clickCell, isFull, selectWord, startCursor, tab, wordAt,
  type ArrowKey, type Cursor, type Layout,
} from '../../shared/grid';
import type { AttemptState, AttemptStatus, PuzzleView, User } from '../../shared/types';

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
let ready = false; // true once the page has loaded (so we know if a finish happened "live")

// ---- DOM ----
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = $('board');
const kbd = $<HTMLInputElement>('kbd');
const cellEls: HTMLElement[] = [];
const clueEls: HTMLElement[] = []; // one <li> per word, same order as layout.words
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function init() {
  fillIcons();
  loading(inDiscord ? 'Connecting to Discord…' : 'Loading…');
  api.setSession(await signIn());
  loading("Loading today's puzzle…");
  const res = await api.loadPuzzle();
  renderMe(res.me);
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
  $('tabs').hidden = false;
  applyAttempt(res.attempt);
  if (status !== 'playing') showView('results'); // already done today: results first
  render();
  ready = true;
  hideLoader();
  setInterval(() => (renderTimer(), renderCountdown()), 1000);
}

/** The status line on the loading screen. */
function loading(text: string) {
  $('loader-text').textContent = text;
}

// If loading hangs (server or tunnel down), don't leave the player watching the loader forever.
const slowLoad = setTimeout(() => {
  loading('This is taking longer than usual…');
  $('loader-retry').hidden = false;
}, 12_000);
$('loader-retry').addEventListener('click', () => location.reload());

/** Fade the loading screen out and show the game underneath. */
function hideLoader() {
  clearTimeout(slowLoad);
  document.body.classList.remove('loading');
  $('loader').classList.add('done');
  setTimeout(() => $('loader').remove(), 300);
}

/** The signed-in player's avatar and name, top right. */
function renderMe(me: User) {
  $('me').append(avatarEl(me), Object.assign(document.createElement('span'), { className: 'name', textContent: me.username }));
}

/** A round avatar: the Discord image, or the first letter for dev users. */
function avatarEl(u: User): HTMLElement {
  const url = avatarUrl(u);
  if (url) return Object.assign(document.createElement('img'), { className: 'avatar', src: url, alt: '' });
  return Object.assign(document.createElement('span'), { className: 'avatar initial', textContent: u.username[0].toUpperCase() });
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
    // diagonal position, used to stagger the "solved" wave animation
    el.style.setProperty('--d', String(Math.floor(i / puzzle.size) + (i % puzzle.size)));
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

// ---- Views: Puzzle / Results ----
function showView(view: 'puzzle' | 'results') {
  $('view-puzzle').hidden = view !== 'puzzle';
  $('view-results').hidden = view !== 'results';
  $('tab-puzzle').setAttribute('aria-selected', String(view === 'puzzle'));
  $('tab-results').setAttribute('aria-selected', String(view === 'results'));
  window.scrollTo(0, 0);
}

$('tab-puzzle').addEventListener('click', () => showView('puzzle'));
$('tab-results').addEventListener('click', () => {
  // The server would refuse anyway (403), but say it nicely.
  if (status === 'playing') return toast("Finish today's puzzle to see the results");
  showView('results');
});
$('see-results').addEventListener('click', () => showView('results'));

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

  $('clue-text').innerHTML = `<b>${active.number}${active.dir[0].toUpperCase()}</b><span></span>`;
  $('clue-text').querySelector('span')!.textContent = puzzle.clues[active.dir][active.number];

  const over = status !== 'playing';
  $('tools').hidden = over;
  $('over-bar').hidden = !over;
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

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
}

/** Restart a one-shot CSS animation class on an element. */
function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth; // force a reflow so the animation starts again
  el.classList.add(cls);
}

// ---- Actions ----
function typeLetter(ch: string) {
  if (status !== 'playing') return;
  const wordWasFull = wordAt(layout, cursor).cells.every((c) => letters[c]);
  if (letters[cursor.cell] !== ch) marks[cursor.cell] = ''; // a changed letter loses its check/reveal mark
  letters[cursor.cell] = ch;
  replay(cellEls[cursor.cell], 'pop');
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

// ---- Finishing and the Results view ----
let result: AttemptState; // our ended attempt
let currentStreak = 0;

/** The attempt is over (solved or gave up): show the solution and unlock the results. */
function finish(a: AttemptState) {
  status = a.status;
  result = a;
  kbd.blur();
  // on give-up, mark every cell the player didn't have right
  a.solution!.forEach((ch, i) => {
    if (ch && letters[i] !== ch) marks[i] = 'revealed';
  });
  letters = a.solution!.slice();

  $('results-icon').innerHTML = icon('trophy');
  $('tab-results').removeAttribute('aria-disabled');
  $('over-text').textContent = a.status === 'solved' ? `Solved in ${formatTime(a.elapsedMs)}` : 'You gave up on this one';
  buildResults();
  render();
  loadLeaderboard();
  setInterval(loadLeaderboard, 30_000); // friends finishing later show up without reopening

  if (!ready) return; // page load: init() opens the results view
  if (a.status === 'solved') {
    // a little wave across the grid, then over to the results
    replay(board, 'celebrate');
    setTimeout(() => showView('results'), reducedMotion ? 0 : 1100);
  } else {
    toast('Results unlocked'); // stay on the grid so they can read the solution
  }
}

function buildResults() {
  const solved = result.status === 'solved';
  $('view-results').innerHTML = `
    <section class="card result-card">
      <div class="result-badge ${solved ? 'ok' : 'gaveup'}">${icon(solved ? 'check' : 'flag')}</div>
      <h2>${solved ? 'Solved!' : 'Better luck tomorrow'}</h2>
      ${solved ? `<p class="big">${formatTime(result.elapsedMs)}</p>` : ''}
      <p class="muted">${solved ? (result.assisted ? 'Assisted (used check or reveal)' : 'Clean solve, no help') : 'The solution is on the Puzzle tab.'}</p>
      <span class="chip streak" id="streak" hidden></span>
      <div class="share">
        <pre id="share-text" aria-label="Your result"></pre>
        <div class="share-buttons">
          ${inDiscord ? `<button id="share-chat" class="primary">${icon('send')}Share to chat</button>` : ''}
          <button id="copy">${icon('copy')}Copy</button>
        </div>
      </div>
      <p class="next" id="next"></p>
    </section>
    <section class="card board-card">
      <div class="card-head"><h3>Today's leaderboard</h3><span class="muted" id="player-count"></span></div>
      <ol class="leaderboard" id="leaderboard"><li class="muted">Loading…</li></ol>
      <p class="muted hint" id="lonely" hidden>You're the first to finish today. Share your result to challenge your friends!</p>
    </section>`;
  $('copy').addEventListener('click', copyResult);
  $('share-chat')?.addEventListener('click', () => shareToChat(myShareText()));
  renderStreak();
  renderCountdown();
}

const myShareText = () => shareText({ puzzleId: puzzle.id, ...result, streak: currentStreak });

function renderStreak() {
  const chip = $('streak');
  chip.hidden = currentStreak < 2;
  chip.innerHTML = `${icon('flame')}${currentStreak}-day streak`;
  $('share-text').textContent = myShareText();
}

async function loadLeaderboard() {
  const data = await api.leaderboard();
  currentStreak = data.streak;
  renderStreak();
  $('player-count').textContent = `${data.entries.length} ${data.entries.length === 1 ? 'player' : 'players'}`;
  $('lonely').hidden = data.entries.length > 1;
  $('leaderboard').replaceChildren(
    ...data.entries.map((e) => {
      const li = document.createElement('li');
      li.classList.toggle('mine', e.isMe);
      if (e.rank && e.rank <= 3) li.dataset.medal = String(e.rank); // gold / silver / bronze
      li.innerHTML = `<span class="rank"></span><span class="name"></span><span class="time"></span>`;
      // usernames are chosen by players: always textContent, never innerHTML
      li.querySelector('.rank')!.textContent = e.rank ? String(e.rank) : '–';
      li.querySelector('.rank')!.after(avatarEl(e.user));
      const name = li.querySelector('.name')!;
      name.textContent = e.user.username + (e.isMe ? ' (you)' : '');
      if (e.assisted) name.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: 'assisted' }));
      li.querySelector('.time')!.textContent = e.timeMs === null ? 'gave up' : formatTime(e.timeMs);
      li.querySelector('.time')!.classList.toggle('muted', e.timeMs === null);
      return li;
    }),
  );
}

/** Copy the share text. Discord's frame may block the Clipboard API, so there's an old-school fallback. */
async function copyResult() {
  const text = myShareText();
  let ok = await navigator.clipboard?.writeText(text).then(() => true, () => false);
  if (!ok) {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    ok = document.execCommand('copy');
    ta.remove();
  }
  toast(ok ? 'Copied! Paste it in chat.' : "Couldn't copy: select the text above and copy it.");
}

/** "Next puzzle in 05:12:33", switching to a reload button at midnight UTC. */
function renderCountdown() {
  const next = document.getElementById('next');
  if (!next) return;
  const ms = msUntilNextPuzzle(Date.now());
  if (ms > 1000) {
    next.innerHTML = `${icon('clock')}Next puzzle in <b>${formatCountdown(ms)}</b>`;
  } else if (!next.querySelector('button')) {
    next.innerHTML = '<button class="primary">Play the new puzzle</button>';
    next.querySelector('button')!.addEventListener('click', () => location.reload());
  }
}

// ---- Tool buttons ----
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
  if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return; // let buttons work

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

// If we can't sign in or load the puzzle there's no game to show: say what went wrong instead.
init().catch((e: Error) => {
  const msg = e instanceof api.ApiError && e.status === 401 ? 'Please open Mini Crossword from Discord.' : e.message;
  const p = Object.assign(document.createElement('p'), { className: 'fatal', textContent: msg });
  $('view-puzzle').replaceChildren(p);
  hideLoader();
});
