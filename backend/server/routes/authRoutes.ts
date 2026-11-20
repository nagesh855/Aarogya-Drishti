import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import {
  authenticate,
  buildRealtimeEvent,
  createOrResendOtpChallenge,
  emitOtpRealtimeEvent,
  getActiveChallengeForVoice,
  isSamePhoneNumber,
  normalizePhoneNumber,
  signAuthToken,
  subscribeOtpChallenge,
  verifyOtpChallenge,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import {
  dbStore,
  findUserByIdentifier,
  generateId,
  sanitizeString,
} from '../db/store.js';
import {
  synthesizeSpeechWithGemini,
  transcribeAudioWithGemini,
} from '../services/geminiService.js';
import { broadcastToUser } from '../ws/socketServer.js';
import type { PatientProfile, UserAccount } from '../../../shared/types/index.js';
import {
  getAgeCategory,
  getAgeFromDateOfBirth,
} from '../../../shared/utils/ageClassification.js';
import {
  encryptAadhaarValue,
  getAadhaarEncryptionKey,
} from '../services/aadhaarEncryption.js';
import { withoutAadhaarData } from '../utils/patientProfile.js';

export const authRouter = Router();

type VoiceLanguage = 'en' | 'hi' | 'te';

const authAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const aadhaarPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error('Aadhaar card photo must be a JPG, PNG, or WEBP image.'));
  },
});

const ashaRegistrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
});
const staffLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
});

function getAadhaarPhotoMimeType(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function getVoiceLanguage(value: unknown): VoiceLanguage {
  return value === 'hi' || value === 'te' ? value : 'en';
}

function formatOtpForVoice(code: string, language: VoiceLanguage): string {
  const spaced = code.split('').join('. ');
  if (language === 'hi') {
    return `Aarogya Drishti suraksha OTP code hai: ${spaced}. Phir se suniye: ${spaced}. Yeh code paanch minute tak manya hai.`;
  }
  if (language === 'te') {
    return `ఆరోగ్య దృష్టి ధృవీకరణ OTP కోడ్: ${spaced}. మళ్లీ చెబుతున్నాను: ${spaced}. ఈ కోడ్ ఐదు నిమిషాల వరకు చెల్లుబాటు అవుతుంది.`;
  }
  return `Your Aarogya Drishti verification code is: ${spaced}. Repeating: ${spaced}. This code is valid for five minutes.`;
}

// Separate ASHA Worker registration; new accounts remain inactive until hospital review.
authRouter.post('/asha/register', ashaRegistrationLimiter, (req, res) => {
  const state = dbStore.getState();
  const fullName = sanitizeString(req.body?.fullName, 120);
  const mobileInput = sanitizeString(req.body?.mobile, 32);
  const mobile = normalizePhoneNumber(mobileInput);
  const officialId = sanitizeString(req.body?.officialId, 60).toUpperCase();
  const village = sanitizeString(req.body?.village, 100);
  const mandal = sanitizeString(req.body?.mandal, 100);
  const address = sanitizeString(req.body?.address, 300);
  const hospitalId = sanitizeString(req.body?.hospitalId, 80);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const hospital = state.hospitals.find((item) => item.id === hospitalId && item.active);

  if (
    fullName.length < 2 ||
    !mobile.ok ||
    !/^[A-Z0-9][A-Z0-9/-]{2,59}$/.test(officialId) ||
    !village ||
    !mandal ||
    !address ||
    !hospital ||
    password.length < 12 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    res.status(400).json({
      error: 'Complete all ASHA registration fields, choose an active PHC/Hospital, and use a password of 12 to 72 bytes.',
    });
    return;
  }

  const priorWorker = state.ashaWorkers.find(
    (worker) => worker.officialId?.toLocaleUpperCase() === officialId
  );
  if (priorWorker) {
    const priorUser = state.users.find((user) => user.id === priorWorker.userId);
    if (
      priorWorker.verificationStatus !== 'rejected' ||
      !priorUser ||
      priorUser.role !== 'asha_worker' ||
      !isSamePhoneNumber(priorUser.mobile, mobile.normalized) ||
      state.users.some(
        (user) =>
          user.id !== priorUser.id &&
          isSamePhoneNumber(user.mobile, mobile.normalized)
      )
    ) {
      res.status(409).json({
        error: 'An account with this Official ASHA ID or mobile number already exists.',
      });
      return;
    }

    const now = new Date().toISOString();
    priorWorker.hospitalId = hospitalId;
    priorWorker.fullName = fullName;
    priorWorker.phone = mobile.normalized;
    priorWorker.village = village;
    priorWorker.mandal = mandal;
    priorWorker.address = address;
    priorWorker.verificationStatus = 'pending';
    priorWorker.reviewedAt = undefined;
    priorWorker.reviewedByUserId = undefined;
    priorWorker.rejectionReason = undefined;
    priorWorker.active = false;
    priorWorker.updatedAt = now;
    priorUser.name = fullName;
    priorUser.mobile = mobile.normalized;
    priorUser.passwordHash = bcrypt.hashSync(password, 12);
    priorUser.hospitalId = hospitalId;
    priorUser.active = false;

    dbStore.addAuditLog({
      actorUserId: priorUser.id,
      actorRole: 'asha_worker',
      actorName: fullName,
      action: 'ASHA_WORKER_REGISTRATION_RESUBMITTED',
      targetType: 'asha_worker',
      targetId: priorWorker.id,
      hospitalId,
      metadata: { officialId, village, mandal },
    });
    for (const manager of state.users.filter(
      (item) => item.role === 'hospital_manager' && item.hospitalId === hospitalId && item.active
    )) {
      dbStore.createNotification(
        {
          userId: manager.id,
          title: 'ASHA Worker Registration Requires Review',
          message: `${fullName} resubmitted an ASHA Worker registration for ${village}, ${mandal}.`,
          category: 'account',
          relatedId: priorWorker.id,
        },
        broadcastToUser
      );
      broadcastToUser(manager.id, { type: 'asha-update' });
    }
    res.status(202).json({
      message: 'Updated ASHA Worker registration submitted and is waiting for hospital verification.',
    });
    return;
  }

  const duplicateOfficialId = state.ashaWorkers.some(
    (worker) => worker.officialId?.toLocaleUpperCase() === officialId
  );
  const duplicateAccount = state.users.some(
    (user) =>
      user.identifier.toLocaleUpperCase() === officialId ||
      isSamePhoneNumber(user.mobile, mobile.normalized)
  );
  if (duplicateOfficialId || duplicateAccount) {
    res.status(409).json({
      error: 'An account with this Official ASHA ID or mobile number already exists.',
    });
    return;
  }

  const now = new Date().toISOString();
  const userId = generateId('usr_asha');
  const ashaWorkerId = generateId('asha');
  const user: UserAccount = {
    id: userId,
    role: 'asha_worker',
    identifier: officialId,
    name: fullName,
    mobile: mobile.normalized,
    passwordHash: bcrypt.hashSync(password, 12),
    hospitalId,
    ashaWorkerId,
    active: false,
    mustChangePassword: false,
    createdAt: now,
  };
  const worker = {
    id: ashaWorkerId,
    userId,
    hospitalId,
    fullName,
    phone: mobile.normalized,
    officialId,
    village,
    mandal,
    address,
    verificationStatus: 'pending' as const,
    active: false,
    createdAt: now,
    updatedAt: now,
  };
  state.users.push(user);
  state.ashaWorkers.push(worker);

  dbStore.addAuditLog({
    actorUserId: userId,
    actorRole: 'asha_worker',
    actorName: fullName,
    action: 'ASHA_WORKER_REGISTRATION_SUBMITTED',
    targetType: 'asha_worker',
    targetId: worker.id,
    hospitalId,
    metadata: { officialId, village, mandal },
  });
  for (const manager of state.users.filter(
    (item) => item.role === 'hospital_manager' && item.hospitalId === hospitalId && item.active
  )) {
    dbStore.createNotification(
      {
        userId: manager.id,
        title: 'ASHA Worker Registration Requires Review',
        message: `${fullName} submitted an ASHA Worker registration for ${village}, ${mandal}.`,
        category: 'account',
        relatedId: worker.id,
      },
      broadcastToUser
    );
    broadcastToUser(manager.id, { type: 'asha-update' });
  }

  res.status(202).json({
    message: 'ASHA Worker registration submitted and is waiting for hospital verification.',
  });
});

// Staff login (Admin, Hospital Manager, Doctor, ASHA Worker)
authRouter.post('/staff/login', staffLoginLimiter, (req, res) => {
  const identifier = sanitizeString(req.body?.identifier, 120);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const expectedRole = sanitizeString(req.body?.role, 30);

  if (!identifier || !password) {
    res.status(400).json({ error: 'ID/Email and password are required.' });
    return;
  }

  const user = findUserByIdentifier(identifier);
  if (!user || user.role === 'patient') {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  if (expectedRole && user.role !== expectedRole) {
    res.status(403).json({
      error: `This account belongs to the ${user.role.replace('_', ' ')} role. Please select the matching portal.`,
    });
    return;
  }

  if (!user.active) {
    if (user.role === 'asha_worker') {
      const worker = dbStore.getState().ashaWorkers.find((item) => item.userId === user.id);
      if (worker?.verificationStatus === 'pending') {
        res.status(403).json({ error: 'Your ASHA Worker registration is awaiting hospital approval.' });
        return;
      }
      if (worker?.verificationStatus === 'rejected') {
        res.status(403).json({
          error: `Your ASHA Worker registration was not approved: ${worker.rejectionReason || 'Please contact your hospital.'} You may submit updated registration details.`,
        });
        return;
      }
    }
    res.status(403).json({ error: 'This account has been deactivated by an administrator.' });
    return;
  }

  if (!user.passwordHash || !bcrypt.compareSync(password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  if (
    (user.role === 'hospital_manager' || user.role === 'doctor' || user.role === 'asha_worker') &&
    user.hospitalId
  ) {
    const hosp = dbStore.getState().hospitals.find((h) => h.id === user.hospitalId);
    if (!hosp || !hosp.active) {
      res.status(403).json({ error: 'Assigned hospital is currently inactive.' });
      return;
    }
  }

  user.lastLoginAt = new Date().toISOString();
  dbStore.addAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    actorName: user.name,
    action: 'STAFF_LOGIN',
    targetType: 'user',
    targetId: user.id,
    hospitalId: user.hospitalId,
  });

  const token = signAuthToken({
    userId: user.id,
    role: user.role,
    hospitalId: user.hospitalId,
    doctorId: user.doctorId,
    ashaWorkerId: user.ashaWorkerId,
  });

  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      identifier: user.identifier,
      name: user.name,
      email: user.email,
      hospitalId: user.hospitalId,
      doctorId: user.doctorId,
      ashaWorkerId: user.ashaWorkerId,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

// Patient Real-Time OTP Request (SMS / Gemini AI Voice Call)
authRouter.post('/patient/request-otp', async (req, res) => {
  const rawMobile = sanitizeString(req.body?.mobile, 24);
  const channel = req.body?.channel === 'voice' ? 'voice' : 'sms';
  const language = getVoiceLanguage(req.body?.language);
  const expiryMinutes = dbStore.getState().settings.otpExpiryMinutes || 5;

  try {
    const result = await createOrResendOtpChallenge({
      mobileInput: rawMobile,
      expiryMinutes,
      channel,
      isResend: false,
    });

    if (!result.ok || !result.record || !result.code) {
      res.status(result.cooldownRemainingSeconds ? 429 : 400).json({
        error: result.error || 'Unable to issue OTP.',
        cooldownRemainingSeconds: result.cooldownRemainingSeconds,
      });
      return;
    }

    const rec = result.record;

    // Notify existing patient inbox in real time if registered
    const existingUser = dbStore
      .getState()
      .users.find((u) => u.role === 'patient' && isSamePhoneNumber(u.mobile, rec.mobileNormalized));
    if (existingUser) {
      dbStore.createNotification(
        {
          userId: existingUser.id,
          title: channel === 'voice' ? 'Gemini Voice OTP Requested' : 'Login OTP Issued',
          message: `A 6-digit verification code was issued for ${rec.mobileNormalized}.`,
          category: 'otp',
        },
        broadcastToUser
      );
    }

    let voiceAudioBase64: string | undefined;
    let voiceMimeType: string | undefined;
    let voiceError: string | undefined;

    if (channel === 'voice') {
      try {
        const spoken = await synthesizeSpeechWithGemini(
          formatOtpForVoice(result.code, language),
          'Kore',
          'Calm, clear automated healthcare verification voice enunciating digits slowly'
        );
        voiceAudioBase64 = spoken.audioBase64;
        voiceMimeType = spoken.mimeType;
        emitOtpRealtimeEvent(
          rec.challengeId,
          buildRealtimeEvent(rec, 'voice_played', 'Gemini AI Voice OTP synthesized and ready.')
        );
      } catch (err) {
        voiceError = err instanceof Error ? err.message : 'Unable to generate voice call audio.';
      }
    }

    res.json({
      message:
        rec.provider === 'realtime_sandbox'
          ? `Verification code generated for ${rec.mobileNormalized}. Valid for ${expiryMinutes} minutes.`
          : `Verification code sent via ${rec.provider.toUpperCase()} SMS to ${rec.mobileNormalized}.`,
      challengeId: rec.challengeId,
      normalizedMobile: rec.mobileNormalized,
      expiresAt: rec.expiresAt,
      resendCooldownSeconds: 30,
      deliveryProvider: rec.provider,
      channel: rec.channel,
      ...(rec.provider === 'realtime_sandbox' ? { demoOtp: result.code } : {}),
      ...(voiceAudioBase64 ? { voiceAudioBase64, voiceMimeType } : {}),
      ...(voiceError ? { voiceError } : {}),
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to dispatch OTP.',
    });
  }
});

// Patient Real-Time OTP Resend (SMS or Gemini Voice)
authRouter.post('/patient/resend-otp', async (req, res) => {
  const rawMobile = sanitizeString(req.body?.mobile, 24);
  const channel = req.body?.channel === 'voice' ? 'voice' : 'sms';
  const language = getVoiceLanguage(req.body?.language);
  const expiryMinutes = dbStore.getState().settings.otpExpiryMinutes || 5;

  try {
    const result = await createOrResendOtpChallenge({
      mobileInput: rawMobile,
      expiryMinutes,
      channel,
      isResend: true,
    });

    if (!result.ok || !result.record || !result.code) {
      res.status(result.cooldownRemainingSeconds ? 429 : 400).json({
        error: result.error || 'Unable to resend OTP.',
        cooldownRemainingSeconds: result.cooldownRemainingSeconds,
      });
      return;
    }

    const rec = result.record;
    let voiceAudioBase64: string | undefined;
    let voiceMimeType: string | undefined;

    if (channel === 'voice') {
      try {
        const spoken = await synthesizeSpeechWithGemini(
          formatOtpForVoice(result.code, language),
          'Kore',
          'Calm, clear automated healthcare verification voice enunciating digits slowly'
        );
        voiceAudioBase64 = spoken.audioBase64;
        voiceMimeType = spoken.mimeType;
      } catch {
        // client can retry via /voice-otp
      }
    }

    res.json({
      message: `New OTP sent to ${rec.mobileNormalized}.`,
      challengeId: rec.challengeId,
      normalizedMobile: rec.mobileNormalized,
      expiresAt: rec.expiresAt,
      resendCooldownSeconds: 30,
      deliveryProvider: rec.provider,
      channel: rec.channel,
      ...(rec.provider === 'realtime_sandbox' ? { demoOtp: result.code } : {}),
      ...(voiceAudioBase64 ? { voiceAudioBase64, voiceMimeType } : {}),
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Unable to resend OTP.',
    });
  }
});

// Real-Time SSE Stream for Live OTP Challenge Status
authRouter.get('/patient/otp-stream/:challengeId', (req, res) => {
  const challengeId = sanitizeString(req.params.challengeId, 64);
  if (!challengeId) {
    res.status(400).json({ error: 'Challenge ID required.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (payload: unknown) => {
    res.write(`event: otp\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const unsubscribe = subscribeOtpChallenge(challengeId, sendEvent);
  const keepalive = setInterval(() => {
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    unsubscribe();
    res.end();
  });
});

// Deliver Active Phone OTP via Gemini AI Voice (TTS)
authRouter.post('/patient/voice-otp', async (req, res) => {
  const rawMobile = sanitizeString(req.body?.mobile, 24);
  const challengeId = sanitizeString(req.body?.challengeId, 64);
  const language = getVoiceLanguage(req.body?.language);

  const active = getActiveChallengeForVoice(rawMobile, challengeId || undefined);
  if (!active.ok || !active.record || !active.code) {
    res.status(400).json({ error: active.error || 'No active OTP challenge found.' });
    return;
  }

  try {
    const spoken = await synthesizeSpeechWithGemini(
      formatOtpForVoice(active.code, language),
      'Kore',
      'Calm, clear automated healthcare verification voice enunciating each digit clearly'
    );

    emitOtpRealtimeEvent(
      active.record.challengeId,
      buildRealtimeEvent(
        active.record,
        'voice_played',
        `Gemini AI Voice Call delivered spoken OTP (${language.toUpperCase()}).`
      )
    );

    res.json({
      challengeId: active.record.challengeId,
      audioBase64: spoken.audioBase64,
      mimeType: spoken.mimeType,
      language,
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Unable to generate Gemini Voice OTP.',
    });
  }
});

// Spoken Phone Number or 6-Digit OTP Input via Gemini Audio Transcription
authRouter.post('/patient/voice-input', authAudioUpload.single('audio'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Please provide recorded audio.' });
    return;
  }
  const mode = req.body?.mode === 'otp' ? 'otp' : 'phone';
  try {
    const prompt =
      mode === 'otp'
        ? 'The speaker is reading a 6-digit verification code aloud. Transcribe only the exact digits spoken.'
        : 'The speaker is reading a mobile phone number aloud. Transcribe the exact digits spoken (with + country code if stated).';
    const transcript = await transcribeAudioWithGemini(
      req.file.buffer.toString('base64'),
      req.file.mimetype || 'audio/webm',
      prompt
    );
    const digitsOnly = transcript.replace(/[^\d+]/g, '');
    const digits = mode === 'otp' ? transcript.replace(/\D/g, '').slice(0, 6) : digitsOnly;
    res.json({ transcript, digits });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Unable to transcribe spoken digits.',
    });
  }
});

// Patient OTP Verify & Account Creation/Login
authRouter.post('/patient/verify-otp', aadhaarPhotoUpload.single('aadhaarPhoto'), (req, res) => {
  const rawMobile = sanitizeString(req.body?.mobile, 24);
  const otp = sanitizeString(req.body?.otp, 12);
  const challengeId = sanitizeString(req.body?.challengeId, 64);
  const mode = req.body?.mode === 'register' ? 'register' : 'login';
  if (mode === 'login' && (req.file || req.body?.aadhaarNumber)) {
    res.status(400).json({ error: 'Aadhaar details can only be submitted during patient registration.' });
    return;
  }
  let decodedRegistration: unknown = req.body?.registration;
  if (typeof decodedRegistration === 'string') {
    try {
      decodedRegistration = JSON.parse(decodedRegistration);
    } catch {
      decodedRegistration = {};
    }
  }
  const registrationBody =
    decodedRegistration &&
    typeof decodedRegistration === 'object' &&
    !Array.isArray(decodedRegistration)
      ? decodedRegistration as Record<string, unknown>
      : {};
  const registrationConsent =
    req.body?.registrationConsent === true || req.body?.registrationConsent === 'true';

  if (!rawMobile || !otp) {
    res.status(400).json({ error: 'Mobile number and OTP are required.' });
    return;
  }

  const rawAadhaarNumber = req.body?.aadhaarNumber;
  const aadhaarNumber =
    typeof rawAadhaarNumber === 'string' ? rawAadhaarNumber.trim() : '';
  const hasAadhaarNumber =
    rawAadhaarNumber !== undefined &&
    rawAadhaarNumber !== null &&
    (typeof rawAadhaarNumber !== 'string' || aadhaarNumber.length > 0);
  const hasAadhaarData =
    mode === 'register' && (hasAadhaarNumber || Boolean(req.file));
  const aadhaarConsent =
    req.body?.aadhaarConsent === true || req.body?.aadhaarConsent === 'true';
  if (
    mode === 'register' &&
    hasAadhaarData &&
    (!hasAadhaarNumber || !/^\d{12}$/.test(aadhaarNumber) || !req.file || !aadhaarConsent)
  ) {
    res.status(400).json({
      error: 'Provide both a valid 12-digit Aadhaar number and card photo, and accept the Aadhaar consent.',
    });
    return;
  }

  const aadhaarPhotoMimeType = req.file ? getAadhaarPhotoMimeType(req.file.buffer) : null;
  if (mode === 'register' && req.file && aadhaarPhotoMimeType !== req.file.mimetype) {
    res.status(400).json({ error: 'Aadhaar card photo content does not match its file type.' });
    return;
  }
  const aadhaarEncryptionKey = hasAadhaarData ? getAadhaarEncryptionKey() : null;
  if (hasAadhaarData && !aadhaarEncryptionKey) {
    res.status(503).json({
      error: 'Secure Aadhaar storage is not configured. Set a 32-byte AADHAAR_ENCRYPTION_KEY on the server.',
    });
    return;
  }

  const registration = {
    fullName: sanitizeString(registrationBody.fullName, 100),
    dateOfBirth: sanitizeString(registrationBody.dateOfBirth, 10),
    gender: sanitizeString(registrationBody.gender, 30),
    bloodGroup: sanitizeString(registrationBody.bloodGroup, 3),
    email: sanitizeString(registrationBody.email, 254).toLowerCase(),
    address: sanitizeString(registrationBody.address, 300),
    state: sanitizeString(registrationBody.state, 100),
    district: sanitizeString(registrationBody.district, 100),
    mandal: sanitizeString(registrationBody.mandal, 100),
    village: sanitizeString(registrationBody.village, 100),
    pincode: sanitizeString(registrationBody.pincode, 6),
  };
  const calculatedAge =
    mode === 'register' ? getAgeFromDateOfBirth(registration.dateOfBirth) : null;
  const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
  const validBloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

  if (
    mode === 'register' &&
    (!registration.fullName ||
      registration.fullName.length < 2 ||
      calculatedAge === null ||
      !validGenders.includes(registration.gender) ||
      !validBloodGroups.includes(registration.bloodGroup) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registration.email) ||
      !registration.address ||
      !registration.state ||
      !registration.district ||
      !registration.mandal ||
      !registration.village ||
      !/^[1-9]\d{5}$/.test(registration.pincode) ||
      !registrationConsent)
  ) {
    res.status(400).json({ error: 'Complete all registration fields and accept the registration consent.' });
    return;
  }

  const check = verifyOtpChallenge(rawMobile, otp, challengeId || undefined);
  if (!check.ok || !check.normalizedMobile) {
    res.status(401).json({ error: check.error || 'OTP verification failed.' });
    return;
  }

  const normalizedMobile = check.normalizedMobile;
  const state = dbStore.getState();
  let user = state.users.find(
    (u) => u.role === 'patient' && isSamePhoneNumber(u.mobile, normalizedMobile)
  );
  let patient = state.patients.find((p) => isSamePhoneNumber(p.mobile, normalizedMobile));
  const now = new Date().toISOString();

  if (mode === 'register') {
    if (user || patient) {
      res.status(409).json({ error: 'This phone number is already registered. Choose Existing Patient to sign in.' });
      return;
    }
    if (state.users.some((existing) => existing.email?.toLowerCase() === registration.email)) {
      res.status(409).json({ error: 'This email address is already associated with an account.' });
      return;
    }

    const userId = generateId('usr_pat');
    const patientId = generateId('pat');
    const ageCategory = getAgeCategory(calculatedAge!);

    user = {
      id: userId,
      role: 'patient',
      identifier: normalizedMobile,
      name: registration.fullName,
      email: registration.email,
      mobile: normalizedMobile,
      patientId,
      active: true,
      mustChangePassword: false,
      createdAt: now,
      lastLoginAt: now,
    } as UserAccount;

    patient = {
      id: patientId,
      userId,
      fullName: registration.fullName,
      mobile: normalizedMobile,
      email: registration.email,
      age: calculatedAge!,
      dateOfBirth: registration.dateOfBirth,
      ageCategory: ageCategory ?? undefined,
      gender: registration.gender as PatientProfile['gender'],
      bloodGroup: registration.bloodGroup,
      address: registration.address,
      state: registration.state,
      district: registration.district,
      mandal: registration.mandal,
      city: registration.village,
      village: registration.village,
      pincode: registration.pincode,
      ...(hasAadhaarData && req.file && aadhaarEncryptionKey
        ? {
            aadhaarLastFourEncrypted: encryptAadhaarValue(
              aadhaarNumber.slice(-4),
              aadhaarEncryptionKey
            ),
            aadhaarNumberEncrypted: encryptAadhaarValue(aadhaarNumber, aadhaarEncryptionKey),
            aadhaarCardPhotoEncrypted: encryptAadhaarValue(req.file.buffer, aadhaarEncryptionKey),
            aadhaarConsentGivenAt: now,
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    };

    state.users.push(user);
    state.patients.push(patient);
    dbStore.createNotification(
      {
        userId: user.id,
        title: 'Welcome to Aarogya Drishti',
        message:
          'Your phone-verified oral health screening account is active. You can use AI Screening or Gemini Voice Guide anytime.',
        category: 'account',
      },
      broadcastToUser
    );
  } else {
    if (!user || !patient) {
      res.status(404).json({ error: 'No patient account was found for this phone number. Choose New Patient Registration.' });
      return;
    }
    if (!user.active) {
      res.status(403).json({ error: 'Patient account is deactivated.' });
      return;
    }
    user.mobile = normalizedMobile;
    user.identifier = normalizedMobile;
    patient.mobile = normalizedMobile;
    patient.updatedAt = now;
    user.lastLoginAt = now;
  }

  dbStore.addAuditLog({
    actorUserId: user.id,
    actorRole: 'patient',
    actorName: user.name,
    action: mode === 'register' ? 'PATIENT_REGISTER' : 'PATIENT_OTP_LOGIN',
    targetType: 'patient',
    targetId: patient.id,
    metadata: {
      mobileNormalized: normalizedMobile,
    },
  });

  const token = signAuthToken({
    userId: user.id,
    role: 'patient',
    patientId: patient.id,
  });

  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      identifier: user.identifier,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      patientId: patient.id,
      mustChangePassword: false,
    },
    patient: withoutAadhaarData(patient),
  });
});

// Change password (for staff accounts)
authRouter.post('/change-password', authenticate, (req: AuthenticatedRequest, res) => {
  const currentPassword =
    typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters.' });
    return;
  }

  const user = dbStore.getState().users.find((u) => u.id === req.auth!.userId);
  if (!user || user.role === 'patient') {
    res.status(400).json({ error: 'Password change is only applicable to staff accounts.' });
    return;
  }

  if (user.passwordHash && !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  user.mustChangePassword = false;
  dbStore.addAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    actorName: user.name,
    action: 'PASSWORD_CHANGED',
    targetType: 'user',
    targetId: user.id,
    hospitalId: user.hospitalId,
  });

  res.json({ message: 'Password updated successfully.' });
});

// Current session user profile
authRouter.get('/me', authenticate, (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const user = state.users.find((u) => u.id === req.auth!.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const unreadNotifications = state.notifications.filter(
    (n) => n.userId === user.id && !n.read
  ).length;

  let profile: unknown = null;
  if (user.role === 'patient') {
    profile = state.patients.find((p) => p.id === user.patientId) || null;
  } else if (user.role === 'doctor') {
    profile = state.doctors.find((d) => d.id === user.doctorId) || null;
  } else if (user.role === 'hospital_manager') {
    profile = state.hospitals.find((h) => h.id === user.hospitalId) || null;
  } else if (user.role === 'asha_worker') {
    profile = state.ashaWorkers.find((w) => w.id === user.ashaWorkerId) || null;
  }

  res.json({
    user: {
      id: user.id,
      role: user.role,
      identifier: user.identifier,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      hospitalId: user.hospitalId,
      doctorId: user.doctorId,
      ashaWorkerId: user.ashaWorkerId,
      patientId: user.patientId,
      mustChangePassword: user.mustChangePassword,
    },
    profile,
    unreadNotifications,
  });
});
