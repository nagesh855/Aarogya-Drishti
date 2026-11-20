import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { UserRole } from '../../../shared/types/index.js';
import { dbStore } from '../db/store.js';

const JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET !== 'CHANGE_ME_IN_PRODUCTION'
    ? process.env.JWT_SECRET
    : 'aarogya-drishti-dev-jwt-secret-key-2026';

export interface AuthTokenPayload {
  userId: string;
  role: UserRole;
  hospitalId?: string;
  doctorId?: string;
  ashaWorkerId?: string;
  patientId?: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthTokenPayload;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}

export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const rawToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : queryToken;

  if (!rawToken) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  try {
    const decoded = verifyAuthToken(rawToken);
    const user = dbStore.getState().users.find((u) => u.id === decoded.userId);
    if (!user || !user.active) {
      res.status(401).json({ error: 'Account is inactive or no longer exists.' });
      return;
    }

    // If hospital manager or doctor, ensure their hospital is still active (unless admin)
    if (
      (user.role === 'hospital_manager' || user.role === 'doctor' || user.role === 'asha_worker') &&
      user.hospitalId
    ) {
      const hosp = dbStore.getState().hospitals.find((h) => h.id === user.hospitalId);
      if (!hosp || !hosp.active) {
        res.status(403).json({ error: 'Your assigned hospital account is currently deactivated.' });
        return;
      }
    }

    req.auth = {
      userId: user.id,
      role: user.role,
      hospitalId: user.hospitalId,
      doctorId: user.doctorId,
      ashaWorkerId: user.ashaWorkerId,
      patientId: user.patientId,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired or invalid token. Please sign in again.' });
  }
}

export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        error: `Access denied. This action requires ${allowedRoles.join(' or ')} permissions.`,
      });
      return;
    }
    next();
  };
}

export {
  normalizePhoneNumber,
  isSamePhoneNumber,
  createOrResendOtpChallenge,
  verifyOtpChallenge,
  getActiveChallengeForVoice,
  subscribeOtpChallenge,
  emitOtpRealtimeEvent,
  buildRealtimeEvent,
} from '../services/otpService.js';
