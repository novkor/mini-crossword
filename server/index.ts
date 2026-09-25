// Server entry point. One process serves both the API and the game page:
// - `npm run dev`   (--dev): Vite runs inside Express, with hot reload
// - `npm start`            : serves the built files from client/dist
// Production is the default; dev-only behaviour needs the explicit --dev flag.

import express from 'express';
import fs from 'node:fs';
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

const app = createApp({ db: openDb(), allowDevUsers });

if (dev) {
  const { createServer } = await import('vite');
  const root = path.join(clientDir, '..');
  const vite = await createServer({
    root: clientDir,
    appType: 'spa',
    server: {
      middlewareMode: true,
      // Only let the browser load files it needs. Without this, Vite would
      // serve /puzzles (the answers!) and /server through its /@fs/ route.
      fs: { allow: [clientDir, path.join(root, 'shared'), path.join(root, 'node_modules')] },
    },
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(clientDir, 'dist')));
}

// Express 5 hands listen errors (like "port already in use") to this callback instead of crashing.
app.listen(port, (err) => {
  if (err) {
    console.error(`Could not start on port ${port}: ${err.message}. Is another server (npm run dev?) already running?`);
    process.exit(1);
  }
  console.log(`Mini Crossword on http://localhost:${port}${dev ? ' (dev)' : ''}`);
});
