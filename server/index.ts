// Server entry point. One process serves both the API and the game page:
// - `npm run dev`   (--dev): Vite runs inside Express, with hot reload
// - `npm start`            : serves the built files from client/dist
// Production is the default; dev-only behaviour needs the explicit --dev flag.

import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createApp } from './app';
import { openDb } from './db';

if (fs.existsSync('.env')) process.loadEnvFile('.env'); // built into Node, no dotenv needed

const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT) || 3000;
const clientDir = path.join(import.meta.dirname, '..', 'client');

// Fake dev users need BOTH the --dev flag and DEV_FAKE_USER=1, so production can't enable them by accident.
const allowDevUsers = dev && process.env.DEV_FAKE_USER === '1';
if (allowDevUsers) console.warn('⚠ DEV_FAKE_USER is on: anyone can sign in as any fake user. Never use this in production.');
if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
  console.warn('⚠ DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET missing from .env: Discord sign-in will fail.');
}

const app = createApp({ db: openDb(), allowDevUsers });
const server = http.createServer(app);

if (dev) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: clientDir, // settings in client/vite.config.ts are picked up from here
    appType: 'spa',
    // Run hot reload over the same port as everything else, so it also works
    // through the tunnel and Discord's proxy (which only forward this one port).
    server: { middlewareMode: true, ws: { server } },
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(clientDir, 'dist')));
}

server.on('error', (err) => {
  console.error(`Could not start on port ${port}: ${err.message}. Is another server (npm run dev?) already running?`);
  process.exit(1);
});
server.listen(port, () => console.log(`Mini Crossword on http://localhost:${port}${dev ? ' (dev)' : ''}`));
