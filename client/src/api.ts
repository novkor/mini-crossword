// Talks to our server. The answers and the timer live only on the server: we
// send letters, it replies with right/wrong and the state of our attempt.

import type { AttemptState, Leaderboard, PuzzleView, User } from '../../shared/types';
import type { Session } from './discord';

let puzzleId = 0; // sent with every request so the server can spot a midnight rollover
let auth: Record<string, string> = {}; // the header that proves who we are

export function setSession(s: Session) {
  auth = 'token' in s ? { Authorization: `Bearer ${s.token}` } : { 'X-Dev-User': s.devUser };
}

/** Thrown when the server answers with an error. `data.attempt` is set when we've already finished. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public data: { attempt?: AttemptState }) {
    super(message);
  }
}

async function call<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...auth, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify({ puzzleId, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data);
  return data as T;
}

type WithAttempt<T = {}> = T & { attempt: AttemptState };

/** Today's puzzle plus our attempt. The first load of the day starts the (server-side) timer. */
export async function loadPuzzle() {
  const res = await call<WithAttempt<{ me: User; puzzle: PuzzleView }>>('/puzzle');
  puzzleId = res.puzzle.id;
  return res;
}

/** Save progress. The server decides whether it's solved. */
export const save = (letters: string[]) => call<WithAttempt>('/save', { letters });

/** Right/wrong for each requested cell. */
export const check = (letters: string[], cells: number[]) => call<WithAttempt<{ results: boolean[] }>>('/check', { letters, cells });

export const reveal = (cell: number) => call<WithAttempt<{ letter: string }>>('/reveal', { cell });

/** Ends the attempt; the reply includes the solution. */
export const giveUp = () => call<WithAttempt>('/give-up', {});

/** Today's results. The server answers 403 until our own attempt has ended. */
export const leaderboard = () => call<Leaderboard>('/leaderboard');
