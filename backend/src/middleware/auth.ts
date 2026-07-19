import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config.js';

const COOKIE_NAME = 'ftm_session';

export function issueToken(config: AppConfig): string {
  return jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: '7d' });
}

export const cookieName = COOKIE_NAME;

/** Set the session cookie on a successful login. */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // secure is not forced: this app is typically reached over LAN/plain HTTP.
    // Put it behind TLS in production and set FORCE_SECURE_COOKIE if desired.
    secure: process.env.FORCE_SECURE_COOKIE === 'true',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

/**
 * Guard middleware: rejects requests without a valid session cookie. Applied to
 * every mutating/administrative route — this app can start/stop/delete
 * infrastructure and must not be left open.
 */
export function requireAuth(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
      return;
    }
    try {
      jwt.verify(token, config.jwtSecret);
      next();
    } catch {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid session' } });
    }
  };
}
