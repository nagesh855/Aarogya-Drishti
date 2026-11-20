import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type OtpDeliveryChannel = 'sms' | 'voice';
export type OtpDeliveryProvider = 'twilio' | 'msg91' | 'realtime_sandbox';

export interface OtpChallengeRecord {
  challengeId: string;
  mobileNormalized: string;
  codeHash: string;
  sandboxCode?: string;
  channel: OtpDeliveryChannel;
  provider: OtpDeliveryProvider;
  expiresAt: number;
  createdAt: number;
  lastSentAt: number;
  attempts: number;
  maxAttempts: number;
  verified: boolean;
}

export interface OtpRealtimeEvent {
  type:
    | 'connected'
    | 'issued'
    | 'resent'
    | 'voice_played'
    | 'attempt_failed'
    | 'verified'
    | 'expired';
  challengeId: string;
  mobileMasked: string;
  channel: OtpDeliveryChannel;
  provider: OtpDeliveryProvider;
  remainingSeconds: number;
  resendCooldownSeconds: number;
  message: string;
  timestamp: string;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const OTP_STORE_FILE = path.join(DATA_DIR, 'otp_challenges.json');
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

const challengesByPhone = new Map<string, OtpChallengeRecord>();
const challengesById = new Map<string, OtpChallengeRecord>();
const sseSubscribers = new Map<string, Set<(event: OtpRealtimeEvent) => void>>();

function ensureOtpStoreLoaded() {
  if (challengesById.size > 0) return;
  try {
    if (!fs.existsSync(OTP_STORE_FILE)) return;
    const raw = fs.readFileSync(OTP_STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as OtpChallengeRecord[];
    const now = Date.now();
    for (const rec of parsed) {
      if (rec.expiresAt > now && !rec.verified) {
        challengesByPhone.set(rec.mobileNormalized, rec);
        challengesById.set(rec.challengeId, rec);
      }
    }
  } catch {
    // ignore corrupt temp cache
  }
}

function persistOtpStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const now = Date.now();
    const active = Array.from(challengesById.values()).filter(
      (r) => r.expiresAt > now && !r.verified
    );
    fs.writeFileSync(OTP_STORE_FILE, JSON.stringify(active, null, 2), 'utf8');
  } catch {
    // ignore disk write issues
  }
}

function hashOtpCode(mobileNormalized: string, code: string): string {
  const secret = process.env.JWT_SECRET || 'aarogya-drishti-otp-salt';
  return crypto.createHash('sha256').update(`${mobileNormalized}:${code}:${secret}`).digest('hex');
}

export function normalizePhoneNumber(input: string): {
  ok: boolean;
  normalized: string;
  last10: string;
  masked: string;
  error?: string;
} {
  const cleaned = input.replace(/[\s\-().]/g, '').trim();
  if (!cleaned) {
    return {
      ok: false,
      normalized: '',
      last10: '',
      masked: '',
      error: 'Please enter a mobile phone number.',
    };
  }

  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (!/^[0-9]+$/.test(digits)) {
    return {
      ok: false,
      normalized: '',
      last10: '',
      masked: '',
      error: 'Phone number must contain only digits (and optional + country code).',
    };
  }

  // Strip leading 0 for local 11-digit format (e.g. 09876543210 -> 9876543210)
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Default 10-digit Indian mobile numbers to +91
  let normalized = '';
  if (digits.length === 10) {
    normalized = `+91${digits}`;
  } else if (digits.length >= 11 && digits.length <= 15) {
    normalized = `+${digits}`;
  } else {
    return {
      ok: false,
      normalized: '',
      last10: '',
      masked: '',
      error: 'Please enter a valid 10-digit mobile number or E.164 number with country code.',
    };
  }

  const last10 = normalized.slice(-10);
  const masked = `${normalized.slice(0, 3)}••••${normalized.slice(-4)}`;
  return { ok: true, normalized, last10, masked };
}

export function isSamePhoneNumber(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = normalizePhoneNumber(a);
  const nb = normalizePhoneNumber(b);
  if (!na.ok || !nb.ok) return a.trim() === b.trim();
  if (na.normalized === nb.normalized) return true;
  // Also handle legacy accounts stored as 10 digits vs +91 + 10 digits
  return na.last10 === nb.last10 && (na.normalized === `+91${na.last10}` || nb.normalized === `+91${nb.last10}`);
}

export function buildRealtimeEvent(
  rec: OtpChallengeRecord,
  type: OtpRealtimeEvent['type'],
  message: string
): OtpRealtimeEvent {
  const now = Date.now();
  const remainingSeconds = Math.max(0, Math.ceil((rec.expiresAt - now) / 1000));
  const resendCooldownSeconds = Math.max(
    0,
    Math.ceil((rec.lastSentAt + RESEND_COOLDOWN_MS - now) / 1000)
  );
  const masked = `${rec.mobileNormalized.slice(0, 3)}••••${rec.mobileNormalized.slice(-4)}`;
  return {
    type,
    challengeId: rec.challengeId,
    mobileMasked: masked,
    channel: rec.channel,
    provider: rec.provider,
    remainingSeconds,
    resendCooldownSeconds,
    message,
    timestamp: new Date().toISOString(),
  };
}

export function emitOtpRealtimeEvent(
  challengeId: string,
  event: OtpRealtimeEvent
): void {
  const listeners = sseSubscribers.get(challengeId);
  if (!listeners) return;
  for (const cb of listeners) {
    try {
      cb(event);
    } catch {
      // ignore subscriber failure
    }
  }
}

export function subscribeOtpChallenge(
  challengeId: string,
  cb: (event: OtpRealtimeEvent) => void
): () => void {
  ensureOtpStoreLoaded();
  let set = sseSubscribers.get(challengeId);
  if (!set) {
    set = new Set();
    sseSubscribers.set(challengeId, set);
  }
  set.add(cb);

  const rec = challengesById.get(challengeId);
  if (rec) {
    cb(
      buildRealtimeEvent(
        rec,
        rec.expiresAt <= Date.now() ? 'expired' : 'connected',
        rec.expiresAt <= Date.now()
          ? 'Verification code expired. Request a new code.'
          : 'Connected to real-time OTP delivery channel.'
      )
    );
  }

  return () => {
    const current = sseSubscribers.get(challengeId);
    if (current) {
      current.delete(cb);
      if (current.size === 0) sseSubscribers.delete(challengeId);
    }
  };
}

async function dispatchExternalSmsIfConfigured(
  mobileNormalized: string,
  code: string,
  expiryMinutes: number
): Promise<{ provider: OtpDeliveryProvider; warning?: string }> {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const twilioToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const twilioFrom = process.env.TWILIO_FROM_NUMBER?.trim();

  if (twilioSid && twilioToken && twilioFrom) {
    const body = new URLSearchParams({
      To: mobileNormalized,
      From: twilioFrom,
      Body: `Aarogya Drishti: Your 6-digit verification code is ${code}. Valid for ${expiryMinutes} minutes. Do not share this code.`,
    });
    const authHeader = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }
    );
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Twilio SMS dispatch failed (${resp.status}): ${errText.slice(0, 140)}`);
    }
    return { provider: 'twilio' };
  }

  const msg91Key = process.env.MSG91_AUTH_KEY?.trim();
  const msg91Template = process.env.MSG91_TEMPLATE_ID?.trim();
  if (msg91Key && msg91Template) {
    const mobileDigits = mobileNormalized.replace(/^\+/, '');
    const resp = await fetch('https://control.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: {
        authkey: msg91Key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: msg91Template,
        mobile: mobileDigits,
        otp: code,
        otp_expiry: expiryMinutes,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`MSG91 SMS dispatch failed (${resp.status}): ${errText.slice(0, 140)}`);
    }
    return { provider: 'msg91' };
  }

  return { provider: 'realtime_sandbox' };
}

export async function createOrResendOtpChallenge(params: {
  mobileInput: string;
  expiryMinutes?: number;
  channel?: OtpDeliveryChannel;
  isResend?: boolean;
}): Promise<{
  ok: boolean;
  error?: string;
  cooldownRemainingSeconds?: number;
  record?: OtpChallengeRecord;
  code?: string;
}> {
  ensureOtpStoreLoaded();
  const norm = normalizePhoneNumber(params.mobileInput);
  if (!norm.ok) {
    return { ok: false, error: norm.error };
  }

  const now = Date.now();
  const existing = challengesByPhone.get(norm.normalized);
  if (existing && !existing.verified && existing.expiresAt > now) {
    const elapsedSinceLastSend = now - existing.lastSentAt;
    if (elapsedSinceLastSend < RESEND_COOLDOWN_MS) {
      const cooldownRemainingSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsedSinceLastSend) / 1000);
      return {
        ok: false,
        cooldownRemainingSeconds,
        error: `Please wait ${cooldownRemainingSeconds}s before requesting another OTP.`,
      };
    }
  }

  const expiryMinutes = params.expiryMinutes || 5;
  const channel: OtpDeliveryChannel = params.channel === 'voice' ? 'voice' : 'sms';
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = now + expiryMinutes * 60 * 1000;

  let provider: OtpDeliveryProvider = 'realtime_sandbox';
  if (channel === 'sms') {
    const smsRes = await dispatchExternalSmsIfConfigured(norm.normalized, code, expiryMinutes);
    provider = smsRes.provider;
  }

  // Clean previous record for this mobile
  if (existing) {
    challengesById.delete(existing.challengeId);
  }

  const challengeId = `otp_${crypto.randomBytes(8).toString('hex')}`;
  const record: OtpChallengeRecord = {
    challengeId,
    mobileNormalized: norm.normalized,
    codeHash: hashOtpCode(norm.normalized, code),
    // Keep sandbox code in challenge record so Gemini Voice OTP can speak it aloud cleanly
    sandboxCode: code,
    channel,
    provider,
    expiresAt,
    createdAt: now,
    lastSentAt: now,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    verified: false,
  };

  challengesByPhone.set(norm.normalized, record);
  challengesById.set(challengeId, record);
  persistOtpStore();

  emitOtpRealtimeEvent(
    challengeId,
    buildRealtimeEvent(
      record,
      params.isResend ? 'resent' : 'issued',
      provider === 'realtime_sandbox'
        ? channel === 'voice'
          ? 'OTP ready for Gemini AI Voice Call delivery.'
          : 'OTP issued in real-time sandbox & ready for Gemini Voice Call.'
        : `OTP dispatched via ${provider.toUpperCase()} SMS.`
    )
  );

  return { ok: true, record, code };
}

export function getActiveChallengeForVoice(
  mobileInput: string,
  challengeId?: string
): { ok: boolean; error?: string; record?: OtpChallengeRecord; code?: string } {
  ensureOtpStoreLoaded();
  const norm = normalizePhoneNumber(mobileInput);
  if (!norm.ok) return { ok: false, error: norm.error };

  const record = challengeId
    ? challengesById.get(challengeId)
    : challengesByPhone.get(norm.normalized);

  if (!record || record.mobileNormalized !== norm.normalized) {
    return { ok: false, error: 'No active OTP challenge found for this phone number.' };
  }
  if (record.verified) {
    return { ok: false, error: 'This OTP has already been verified.' };
  }
  if (Date.now() > record.expiresAt) {
    emitOtpRealtimeEvent(
      record.challengeId,
      buildRealtimeEvent(record, 'expired', 'Verification code expired.')
    );
    return { ok: false, error: 'OTP has expired. Please request a new OTP.' };
  }
  if (!record.sandboxCode) {
    return { ok: false, error: 'Voice readout unavailable for this OTP session.' };
  }
  return { ok: true, record, code: record.sandboxCode };
}

export function verifyOtpChallenge(
  mobileInput: string,
  codeInput: string,
  challengeId?: string
): {
  ok: boolean;
  error?: string;
  normalizedMobile?: string;
  challengeId?: string;
} {
  ensureOtpStoreLoaded();
  const norm = normalizePhoneNumber(mobileInput);
  if (!norm.ok) {
    return { ok: false, error: norm.error };
  }

  const record = challengeId
    ? challengesById.get(challengeId)
    : challengesByPhone.get(norm.normalized);

  if (!record || record.mobileNormalized !== norm.normalized) {
    return {
      ok: false,
      error: 'No OTP requested for this mobile number. Please request a new OTP.',
    };
  }

  if (Date.now() > record.expiresAt) {
    emitOtpRealtimeEvent(
      record.challengeId,
      buildRealtimeEvent(record, 'expired', 'OTP expired before verification.')
    );
    challengesByPhone.delete(record.mobileNormalized);
    challengesById.delete(record.challengeId);
    persistOtpStore();
    return { ok: false, error: 'OTP has expired. Please request a new OTP.' };
  }

  if (record.attempts >= record.maxAttempts) {
    challengesByPhone.delete(record.mobileNormalized);
    challengesById.delete(record.challengeId);
    persistOtpStore();
    return { ok: false, error: 'Too many invalid OTP attempts. Please request a new OTP.' };
  }

  const candidate = codeInput.replace(/\D/g, '');
  const expectedHash = hashOtpCode(record.mobileNormalized, candidate);
  if (candidate.length !== 6 || record.codeHash !== expectedHash) {
    record.attempts += 1;
    persistOtpStore();
    const remaining = record.maxAttempts - record.attempts;
    emitOtpRealtimeEvent(
      record.challengeId,
      buildRealtimeEvent(
        record,
        'attempt_failed',
        `Incorrect code entered. ${remaining} attempts remaining.`
      )
    );
    return {
      ok: false,
      error: `Invalid 6-digit OTP. ${remaining} attempts remaining.`,
    };
  }

  record.verified = true;
  emitOtpRealtimeEvent(
    record.challengeId,
    buildRealtimeEvent(record, 'verified', 'Phone number verified in real time.')
  );
  challengesByPhone.delete(record.mobileNormalized);
  challengesById.delete(record.challengeId);
  persistOtpStore();

  return {
    ok: true,
    normalizedMobile: record.mobileNormalized,
    challengeId: record.challengeId,
  };
}
