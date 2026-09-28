// Who is making this request? Every /api route (except /api/token) runs
// requireUser first and gets req.user. The user ID always comes from Discord
// (or, in dev, from the fake-user header); never from the request body.

import type { RequestHandler } from 'express';
import type { User } from '../shared/types';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Looks up the user an access token belongs to; null if the token is invalid. */
export type VerifyToken = (token: string) => Promise<User | null>;

/**
 * Exchange the one-time code from discordSdk.commands.authorize() for an access token.
 * This must happen on the server because it needs the client secret.
 * (Activities don't use a redirect_uri here.)
 */
export async function exchangeCode(code: string): Promise<string | null> {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
    }),
  });
  if (!res.ok) {
    // "invalid_client" = wrong client ID/secret in .env; "invalid_grant" = bad or already-used code
    console.error(`Discord token exchange failed (${res.status}): ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

/**
 * Ask Discord who owns this access token. Results are cached for 5 minutes so
 * we don't call Discord on every keystroke-save (and hit its rate limits).
 */
const cache = new Map<string, { user: User | null; expires: number }>();
export const verifyDiscordToken: VerifyToken = async (token) => {
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.expires > now) return hit.user;

  const res = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 401) throw new Error(`Discord answered ${res.status}`); // e.g. rate limited: not the player's fault
  const me = res.ok ? ((await res.json()) as { id: string; username: string; global_name?: string | null; avatar: string | null }) : null;
  const user = me && { id: me.id, username: me.global_name || me.username, avatar: me.avatar };

  // ponytail: a Map with an O(n) sweep per miss; plenty for one server. Use an LRU or Redis if it ever grows huge.
  for (const [key, value] of cache) if (value.expires <= now) cache.delete(key);
  cache.set(token, { user, expires: now + 5 * 60_000 });
  return user;
};

export function requireUser({ allowDevUsers, verifyToken }: { allowDevUsers: boolean; verifyToken: VerifyToken }): RequestHandler {
  return async (req, res, next) => {
    // DEV ONLY: "X-Dev-User: alice" signs in as a fake user, so the game can be
    // played in a normal browser tab. Only honoured with --dev AND DEV_FAKE_USER=1.
    const devName = req.get('X-Dev-User');
    if (allowDevUsers && devName) {
      if (!/^[\w-]{1,32}$/.test(devName)) return void res.status(400).json({ error: 'Bad dev user name' });
      req.user = { id: `dev-${devName}`, username: devName, avatar: null };
      return next();
    }

    // The real thing: "Authorization: Bearer <Discord access token>"
    const token = req.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return void res.status(401).json({ error: 'Not signed in' });
    try {
      const user = await verifyToken(token);
      if (!user) return void res.status(401).json({ error: 'Your Discord sign-in expired. Reopen the Activity.' });
      req.user = user;
      next();
    } catch (e) {
      console.error('Token check failed:', (e as Error).message);
      res.status(503).json({ error: "Couldn't reach Discord. Try again in a moment." });
    }
  };
}
