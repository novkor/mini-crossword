// Who is making this request? Every /api route runs this first and gets req.user.
// The user ID always comes from here (the server), never from the request body.

import type { RequestHandler } from 'express';

export interface User {
  id: string;
  username: string;
  avatar: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function requireUser({ allowDevUsers }: { allowDevUsers: boolean }): RequestHandler {
  return (req, res, next) => {
    // DEV ONLY: "X-Dev-User: alice" signs in as a fake user, so the game can be
    // played in a normal browser tab. Only honoured with --dev AND DEV_FAKE_USER=1.
    const devName = req.get('X-Dev-User');
    if (allowDevUsers && devName) {
      if (!/^[\w-]{1,32}$/.test(devName)) return void res.status(400).json({ error: 'Bad dev user name' });
      req.user = { id: `dev-${devName}`, username: devName, avatar: null };
      return next();
    }

    // Phase 4: verify the Discord access token here.
    res.status(401).json({ error: 'Not signed in' });
  };
}
