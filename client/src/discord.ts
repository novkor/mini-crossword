// Signing in. Inside Discord we use the Embedded App SDK; in a normal browser
// tab (local development) we fall back to a fake user, which the server only
// accepts when it runs with --dev and DEV_FAKE_USER=1.

import { DiscordSDK } from '@discord/embedded-app-sdk';
import type { User } from '../../shared/types';

/** How api.ts proves who we are on every request. */
export type Session = { token: string } | { devUser: string };

// Discord always opens an Activity with ?frame_id=... in the URL.
const params = new URLSearchParams(location.search);
export const inDiscord = params.has('frame_id');

let sdk: DiscordSDK | null = null; // set once signed in inside Discord

export async function signIn(): Promise<Session> {
  if (!inDiscord) return { devUser: params.get('user') ?? 'player1' }; // e.g. http://localhost:3000/?user=alice

  const clientId = import.meta.env.DISCORD_CLIENT_ID;
  sdk = new DiscordSDK(clientId);
  await sdk.ready(); // wait for the Discord client to be ready to talk to us

  // 1. Ask the player for permission (just "identify": who they are). Returns a one-time code.
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  // 2. Our server swaps the code for an access token (it holds the client secret).
  //    A relative URL goes through Discord's proxy to our server via the "/" URL mapping.
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error('Discord sign-in failed. Try reopening the Activity.');
  const { access_token } = await res.json();

  // 3. Tell the Discord client we're signed in. The server checks this same token on every request.
  await sdk.commands.authenticate({ access_token });
  return { token: access_token };
}

/**
 * Inside Discord: open Discord's own share dialog, which posts `message` plus a
 * link to the Activity into any chat. Returns false outside Discord.
 */
export async function shareToChat(message: string): Promise<boolean> {
  if (!sdk) return false;
  const { success } = await sdk.commands.shareLink({ message });
  return success;
}

// Inside Discord, pages may only load from our own proxied domain, so avatars
// go through the "/discord-cdn" URL mapping to cdn.discordapp.com (see README).
const CDN = inDiscord ? '/discord-cdn' : 'https://cdn.discordapp.com';

/** The user's avatar image, or null for dev users (who get an initial instead). */
export function avatarUrl(u: User): string | null {
  if (u.id.startsWith('dev-')) return null;
  if (u.avatar) return `${CDN}/avatars/${u.id}/${u.avatar}.png?size=64`;
  // no custom avatar: Discord's default one, picked from the user ID
  return `${CDN}/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
}
