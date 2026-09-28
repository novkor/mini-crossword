// API tests, focused on the privacy and fairness rules:
// the solution never leaks early, timing is server-side, one attempt per day, players are isolated.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { solutionOf } from '../shared/puzzle';
import type { User } from '../shared/types';
import { createApp } from './app';
import type { VerifyToken } from './auth';
import { openDb } from './db';
import { loadPuzzles } from './puzzles';

const [P1, P2] = loadPuzzles(); // P1: #DARE / RELAY / ABOVE / TUNES / EGGS#
const SOLUTION = solutionOf(P1);
const ANSWER_WORDS = ['DARE', 'RELAY', 'ABOVE', 'TUNES', 'EGGS', 'DEBUG', 'ALONG', 'RAVES', 'EYES', 'RATE'];
const WHITE = SOLUTION.flatMap((s, i) => (s ? [i] : []));
const empty = () => Array(25).fill('');

let t = 0; // the test controls the server's clock
let server: Server;
let base = '';

// A fake Discord: two valid tokens, anything else is invalid, "down" means Discord is unreachable.
const fakeDiscord: VerifyToken = async (token) => {
  if (token === 'down') throw new Error('Discord answered 500');
  const users: Record<string, User> = {
    'token-alice': { id: '111', username: 'Alice', avatar: 'abc' },
    'token-bob': { id: '222', username: 'Bob', avatar: null },
  };
  return users[token] ?? null;
};

async function start(allowDevUsers = true) {
  // a fresh in-memory database per test; P1 on 25 Sep, P2 on 26 Sep
  const app = createApp({
    db: openDb(':memory:'),
    now: () => t,
    puzzleFor: (day) => (day === '2026-09-26' ? P2 : P1),
    allowDevUsers,
    verifyToken: fakeDiscord,
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
}

beforeEach(async () => {
  t = Date.parse('2026-09-25T12:00:00Z');
  await start();
});
afterEach(() => server.close());

/** A client signed in as the given dev user. `raw` returns the Response, the others the parsed JSON. */
function as(user: string) {
  const headers = { 'X-Dev-User': user, 'Content-Type': 'application/json' };
  const raw = (path: string, body?: object) =>
    fetch(base + path, body ? { method: 'POST', headers, body: JSON.stringify({ puzzleId: 1, ...body }) } : { headers });
  return {
    raw,
    get: async (path: string) => (await raw(path)).json(),
    post: async (path: string, body: object = {}) => (await raw(path, body)).json(),
  };
}

describe('sign-in', () => {
  it('rejects requests with no user', async () => {
    expect((await fetch(`${base}/puzzle`)).status).toBe(401);
  });

  it('ignores the dev user header unless dev users are allowed', async () => {
    server.close();
    await start(false);
    expect((await as('alice').raw('/puzzle')).status).toBe(401);
  });
});

describe('Discord sign-in', () => {
  const withToken = (token: string, path: string, body?: object) =>
    fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify({ puzzleId: 1, ...body }),
    });

  it('identifies the player from their Discord access token', async () => {
    server.close();
    await start(false); // production mode
    const res = await (await withToken('token-alice', '/puzzle')).json();
    expect(res.me).toEqual({ id: '111', username: 'Alice', avatar: 'abc' });
  });

  it('rejects an invalid token, and says so when Discord is down', async () => {
    expect((await withToken('forged', '/puzzle')).status).toBe(401);
    expect((await withToken('down', '/puzzle')).status).toBe(503);
  });

  it('never trusts a user ID sent by the client', async () => {
    await withToken('token-alice', '/puzzle');
    await withToken('token-bob', '/puzzle');
    // alice tries to save into bob's attempt by naming him in the body
    const letters = empty();
    letters[1] = 'Z';
    await withToken('token-alice', '/save', { letters, userId: '222', user: { id: '222' } });
    const bob = await (await withToken('token-bob', '/puzzle')).json();
    expect(bob.attempt.letters).toEqual(empty());
    const alice = await (await withToken('token-alice', '/puzzle')).json();
    expect(alice.attempt.letters[1]).toBe('Z');
  });

  it('the token exchange needs a code', async () => {
    const res = await fetch(`${base}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(400);
  });
});

describe('the solution never reaches the client before the attempt ends', () => {
  it('not in the puzzle response', async () => {
    const res = await as('alice').raw('/puzzle');
    const text = await res.text();
    for (const word of ANSWER_WORDS) expect(text.toUpperCase()).not.toContain(word);
    expect(JSON.parse(text).attempt).not.toHaveProperty('solution');
  });

  it('not in save, check or reveal responses while playing', async () => {
    const alice = as('alice');
    await alice.get('/puzzle');
    const letters = empty();
    letters[1] = 'D';
    for (const res of [
      await alice.post('/save', { letters }),
      await alice.post('/check', { letters, cells: [1, 2] }),
      await alice.post('/reveal', { cell: 3 }),
    ]) {
      expect(res.attempt.status).toBe('playing');
      expect(res.attempt).not.toHaveProperty('solution');
    }
  });

  it('check only says right or wrong', async () => {
    const alice = as('alice');
    await alice.get('/puzzle');
    const letters = empty();
    letters[1] = 'D';
    letters[2] = 'X';
    const res = await alice.post('/check', { letters, cells: [1, 2] });
    expect(res.results).toEqual([true, false]);
  });

  it('is sent once the player gives up', async () => {
    const alice = as('alice');
    await alice.get('/puzzle');
    const res = await alice.post('/give-up');
    expect(res.attempt.status).toBe('gaveup');
    expect(res.attempt.solution).toEqual(SOLUTION);
  });
});

describe('one attempt per day', () => {
  it('a solved attempt cannot be changed or restarted', async () => {
    const alice = as('alice');
    await alice.get('/puzzle');
    expect((await alice.post('/save', { letters: SOLUTION })).attempt.status).toBe('solved');

    for (const [path, body] of [
      ['/save', { letters: empty() }],
      ['/check', { letters: SOLUTION, cells: [1] }],
      ['/reveal', { cell: 1 }],
      ['/give-up', {}],
    ] as const) {
      expect((await alice.raw(path, body)).status).toBe(409);
    }
    // reloading shows the finished attempt instead of starting a new one
    const again = await alice.get('/puzzle');
    expect(again.attempt.status).toBe('solved');
    expect(again.attempt.letters).toEqual(SOLUTION);
  });

  it('giving up is final too', async () => {
    const alice = as('alice');
    await alice.get('/puzzle');
    await alice.post('/give-up');
    expect((await alice.raw('/save', { letters: SOLUTION })).status).toBe(409);
    expect((await alice.get('/puzzle')).attempt.status).toBe('gaveup');
  });

  it('revealing every cell counts as giving up', async () => {
    const alice = as('alice');
    await alice.get('/puzzle');
    let res;
    for (const cell of WHITE) res = await alice.post('/reveal', { cell });
    expect(res.attempt.status).toBe('gaveup');
  });

  it('a revealed cell typed over no longer counts as revealed', async () => {
    const alice = as('alice');
    await alice.get('/puzzle');
    const { attempt } = await alice.post('/reveal', { cell: 1 });
    expect(attempt.revealed).toEqual([1]);
    const letters = attempt.letters.slice();
    letters[1] = 'Q';
    expect((await alice.post('/save', { letters })).attempt.revealed).toEqual([]);
  });

  it('check and reveal mark the solve as assisted, for good', async () => {
    const alice = as('alice');
    await alice.get('/puzzle');
    await alice.post('/check', { letters: empty(), cells: [1] });
    const res = await alice.post('/save', { letters: SOLUTION });
    expect(res.attempt).toMatchObject({ status: 'solved', assisted: true });
  });
});

describe('progress is saved per player', () => {
  it('reloading resumes the same letters, and players never see each other', async () => {
    const alice = as('alice');
    const bob = as('bob');
    await alice.get('/puzzle');
    await bob.get('/puzzle');
    const letters = empty();
    letters[1] = 'D';
    await alice.post('/save', { letters });

    expect((await alice.get('/puzzle')).attempt.letters[1]).toBe('D');
    expect((await bob.get('/puzzle')).attempt.letters).toEqual(empty());

    // alice finishing doesn't end bob's attempt or show bob the solution
    await alice.post('/give-up');
    const bobs = await bob.get('/puzzle');
    expect(bobs.attempt.status).toBe('playing');
    expect(bobs.attempt).not.toHaveProperty('solution');
  });
});

describe('timing is measured on the server', () => {
  it('starts at first load, ends at the verified solve, and ignores client times', async () => {
    const alice = as('alice');
    await alice.get('/puzzle'); // timer starts now
    t += 30_000;
    await alice.get('/puzzle'); // reloading does not restart it
    t += 37_000;
    const res = await alice.post('/save', { letters: SOLUTION, elapsedMs: 1, startedAt: t, endedAt: t });
    expect(res.attempt.elapsedMs).toBe(67_000);

    t += 60_000; // the time is frozen once finished
    expect((await alice.get('/puzzle')).attempt.elapsedMs).toBe(67_000);
  });
});

describe('the daily switch at midnight UTC', () => {
  it("rejects moves for yesterday's puzzle and starts a fresh attempt today", async () => {
    const alice = as('alice');
    t = Date.parse('2026-09-25T23:59:00Z');
    await alice.get('/puzzle');
    t = Date.parse('2026-09-26T00:00:01Z');
    expect((await alice.raw('/save', { letters: empty() })).status).toBe(409);

    const today = await alice.get('/puzzle');
    expect(today.puzzle.id).toBe(P2.id);
    expect(today.attempt).toMatchObject({ status: 'playing', elapsedMs: 0 });
  });
});

describe('leaderboard', () => {
  /** Load the puzzle at `startAt`, then finish at `endAt`: solve (optionally with a check first) or give up. */
  async function finish(user: string, how: 'solve' | 'assisted' | 'gaveup', seconds: number) {
    const c = as(user);
    await c.get('/puzzle');
    t += seconds * 1000;
    if (how === 'assisted') await c.post('/check', { letters: empty(), cells: [1] });
    if (how === 'gaveup') await c.post('/give-up');
    else await c.post('/save', { letters: SOLUTION });
    t -= seconds * 1000; // everyone "starts" at the same moment in this test
  }

  it('is 403 until your own attempt has ended', async () => {
    await finish('bob', 'solve', 60);
    const alice = as('alice');
    expect((await alice.raw('/leaderboard')).status).toBe(403); // never loaded the puzzle
    await alice.get('/puzzle');
    expect((await alice.raw('/leaderboard')).status).toBe(403); // still playing
    await alice.post('/give-up');
    expect((await alice.raw('/leaderboard')).status).toBe(200); // done (even by giving up)
  });

  it('ranks unassisted solves first, then assisted, then give-ups; never shows players still playing', async () => {
    await finish('slow', 'solve', 90);
    await finish('helped', 'assisted', 30); // fastest, but assisted
    await finish('quitter', 'gaveup', 10);
    await finish('fast', 'solve', 45);
    await as('stillplaying').get('/puzzle');

    const res = await as('fast').raw('/leaderboard');
    const text = await res.text();
    const board = JSON.parse(text);
    expect(
      board.entries.map((e: any) => [e.rank, e.user.username, e.timeMs, e.assisted, e.status, e.isMe]),
    ).toEqual([
      [1, 'fast', 45_000, false, 'solved', true],
      [2, 'slow', 90_000, false, 'solved', false],
      [3, 'helped', 30_000, true, 'solved', false],
      [null, 'quitter', null, false, 'gaveup', false],
    ]);
    // no grids: none of the answers appear anywhere in the response
    for (const word of ANSWER_WORDS) expect(text.toUpperCase()).not.toContain(word);
  });

  it('shows the streak of consecutive solved days, and giving up resets it', async () => {
    await finish('alice', 'solve', 60);
    await finish('bob', 'gaveup', 5);
    expect((await as('alice').get('/leaderboard')).streak).toBe(1);
    expect((await as('bob').get('/leaderboard')).streak).toBe(0);

    t = Date.parse('2026-09-26T12:00:00Z'); // the next day: puzzle #2
    const alice = as('alice');
    expect((await alice.get('/puzzle')).puzzle.id).toBe(P2.id);
    await alice.raw('/save', { puzzleId: P2.id, letters: solutionOf(P2) });
    expect((await alice.get('/leaderboard')).streak).toBe(2);
  });
});

describe('input validation', () => {
  it('rejects malformed requests', async () => {
    const alice = as('alice');
    await alice.get('/puzzle');
    expect((await alice.raw('/save', { letters: ['A'] })).status).toBe(400);
    expect((await alice.raw('/save', { letters: Array(25).fill('ab') })).status).toBe(400);
    expect((await alice.raw('/reveal', { cell: 0 })).status).toBe(400); // black square
    expect((await alice.raw('/reveal', { cell: 99 })).status).toBe(400);
    expect((await alice.raw('/check', { letters: empty(), cells: ['1'] })).status).toBe(400);
  });

  it('refuses to act before the puzzle was loaded', async () => {
    expect((await as('carol').raw('/save', { letters: empty() })).status).toBe(409);
  });
});
