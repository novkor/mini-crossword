// Small pure helpers for times, the share text and streaks (tested in format.test.ts).

import type { AttemptStatus } from './types';

/** 67000 -> "1:07" */
export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 18_345_000 -> "05:05:45" (for the next-puzzle countdown) */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** Milliseconds until the next puzzle: the next 00:00 UTC. */
export function msUntilNextPuzzle(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

/**
 * The spoiler-free result to paste into chat, e.g. "Mini Crossword #12 — 1:07 ✅".
 * No letters, no answers.
 */
export function shareText(p: { puzzleId: number; status: AttemptStatus; elapsedMs: number; assisted: boolean; streak: number }): string {
  const result =
    p.status === 'solved' ? `${formatTime(p.elapsedMs)} ✅${p.assisted ? ' (assisted)' : ''}` : 'gave up 🏳️';
  const streak = p.streak >= 2 ? `\n🔥 ${p.streak}-day streak` : '';
  return `Mini Crossword #${p.puzzleId} — ${result}${streak}`;
}

/**
 * Consecutive days solved, counting back from `today` (UTC "YYYY-MM-DD").
 * `solvedDays` = the days this player solved. If today isn't solved (yet), the
 * streak counts back from yesterday, so it isn't shown as broken before they play.
 */
export function streak(solvedDays: string[], today: string): number {
  const solved = new Set(solvedDays);
  const dayBefore = (day: string) => new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10);
  let day = solved.has(today) ? today : dayBefore(today);
  let count = 0;
  while (solved.has(day)) {
    count++;
    day = dayBefore(day);
  }
  return count;
}
