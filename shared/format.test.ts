import { describe, expect, it } from 'vitest';
import { formatCountdown, formatTime, msUntilNextPuzzle, shareText, streak } from './format';

describe('formatting', () => {
  it('formats solve times and countdowns', () => {
    expect(formatTime(67_000)).toBe('1:07');
    expect(formatTime(599_999)).toBe('9:59');
    expect(formatCountdown(5 * 3600_000 + 5 * 60_000 + 45_000)).toBe('05:05:45');
  });

  it('counts down to midnight UTC', () => {
    expect(msUntilNextPuzzle(Date.parse('2026-09-25T23:59:00Z'))).toBe(60_000);
    expect(msUntilNextPuzzle(Date.parse('2026-12-31T12:00:00Z'))).toBe(12 * 3600_000); // across a year end
  });
});

describe('share text', () => {
  const base = { puzzleId: 12, elapsedMs: 67_000, assisted: false, streak: 1 };

  it('is spoiler-free', () => {
    expect(shareText({ ...base, status: 'solved' })).toBe('Mini Crossword #12 — 1:07 ✅');
    expect(shareText({ ...base, status: 'solved', assisted: true })).toBe('Mini Crossword #12 — 1:07 ✅ (assisted)');
    expect(shareText({ ...base, status: 'gaveup', streak: 0 })).toBe('Mini Crossword #12 — gave up 🏳️');
  });

  it('mentions a streak of 2 or more days', () => {
    expect(shareText({ ...base, status: 'solved', streak: 3 })).toBe('Mini Crossword #12 — 1:07 ✅\n🔥 3-day streak');
  });
});

describe('streak', () => {
  it('counts consecutive solved days up to today', () => {
    expect(streak(['2026-09-23', '2026-09-24', '2026-09-25'], '2026-09-25')).toBe(3);
  });

  it('a missed day breaks it', () => {
    expect(streak(['2026-09-22', '2026-09-24', '2026-09-25'], '2026-09-25')).toBe(2);
  });

  it('is not broken yet if today is still unsolved', () => {
    expect(streak(['2026-09-23', '2026-09-24'], '2026-09-25')).toBe(2);
  });

  it('works across month ends', () => {
    expect(streak(['2026-09-30', '2026-10-01'], '2026-10-01')).toBe(2);
  });
});
