// Vite settings for the client, used by both `npm run dev` (through the server) and `npm run build`.

import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

const root = path.join(import.meta.dirname, '..');

export default defineConfig(({ mode }) => {
  // Read ONLY the client ID from the root .env. The client secret must never reach the browser.
  const env = loadEnv(mode, root, 'DISCORD_CLIENT_ID');
  return {
    define: {
      'import.meta.env.DISCORD_CLIENT_ID': JSON.stringify(env.DISCORD_CLIENT_ID ?? ''),
    },
    server: {
      // Only let the browser load files it needs. Without this, Vite would
      // serve /puzzles (the answers!) and /server through its /@fs/ route.
      fs: { allow: [import.meta.dirname, path.join(root, 'shared'), path.join(root, 'node_modules')] },
      // Accept requests arriving through a cloudflared quick tunnel (Discord's proxy forwards to it).
      allowedHosts: ['.trycloudflare.com'],
    },
  };
});
