import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Lock,
  Mic,
  PhoneCall,
  RefreshCw,
  Smartphone,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { apiRequest, setStoredToken } from '../utils/api.js';
import { useLocalization } from '../i18n.js';
import type { UserRole } from '../../../shared/types/index.js';
import { getAgeFromDateOfBirth } from '../../../shared/utils/ageClassification.js';

export interface AuthSessionUser {
  id: string;
  role: UserRole;
  identifier: string;
  name: string;
  email?: string;
  mobile?: string;
  hospitalId?: string;
  doctorId?: string;
  patientId?: string;
  mustChangePassword: boolean;
}

interface AuthModalProps {
  initialRole?: UserRole;
  onClose: () => void;
  onAuthenticated: (token: string, user: AuthSessionUser) => void;
}

interface OtpRequestResponse {
  message: string;
  challengeId: string;
  normalizedMobile: string;
  expiresAt: number;
  resendCooldownSeconds: number;
  deliveryProvider: 'twilio' | 'msg91' | 'realtime_sandbox';
  channel: 'sms' | 'voice';
  demoOtp?: string;
  voiceAudioBase64?: string;
  voiceMimeType?: string;
  voiceError?: string;
}

interface OtpRealtimeStatus {
  type: string;
  message: string;
  provider: string;
  remainingSeconds: number;
  resendCooldownSeconds: number;
}

function isVoiceLanguage(value: string): value is 'en' | 'hi' | 'te' {
  return value === 'en' || value === 'hi' || value === 'te';
}

type PatientAuthMode = 'login' | 'register';

interface PatientRegistrationDetails {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  email: string;
  address: string;
  state: string;
  district: string;
  mandal: string;
  village: string;
  pincode: string;
}

const EMPTY_REGISTRATION: PatientRegistrationDetails = {
  fullName: '',
  dateOfBirth: '',
  gender: '',
  bloodGroup: '',
  email: '',
  address: '',
  state: '',
  district: '',
  mandal: '',
  village: '',
  pincode: '',
};

export function AuthModal({
  initialRole = 'patient',
  onClose,
  onAuthenticated,
}: AuthModalProps) {
  const { language: appLanguage } = useLocalization();
  const [role, setRole] = useState<UserRole>(
    initialRole === 'asha_worker' ? 'patient' : initialRole
  );
  const [patientAuthMode, setPatientAuthMode] = useState<PatientAuthMode>('login');
  const [registration, setRegistration] =
    useState<PatientRegistrationDetails>(EMPTY_REGISTRATION);
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [aadhaarPhoto, setAadhaarPhoto] = useState<File | null>(null);
  const [aadhaarConsent, setAadhaarConsent] = useState(false);

  // Patient Real-Time OTP state
  const [mobile, setMobile] = useState('');
  const [normalizedMobile, setNormalizedMobile] = useState('');
  const [deliveryChannel, setDeliveryChannel] = useState<'sms' | 'voice'>('sms');
  const [voiceLanguage, setVoiceLanguage] = useState<'en' | 'hi' | 'te'>(() => appLanguage);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const [deliveryProvider, setDeliveryProvider] = useState<string>('realtime_sandbox');
  const [demoOtpNotice, setDemoOtpNotice] = useState<string | null>(null);
  const [realtimeStatusMsg, setRealtimeStatusMsg] = useState<string | null>(null);

  // Gemini Voice OTP & Spoken Digit Dictation state
  const [voiceOtpLoading, setVoiceOtpLoading] = useState(false);
  const [voiceOtpPlaying, setVoiceOtpPlaying] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'phone' | 'otp' | null>(null);
  const [transcribingMode, setTranscribingMode] = useState<'phone' | 'otp' | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Staff login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopVoiceAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setVoiceOtpPlaying(false);
  };

  const closeSse = () => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopVoiceAudio();
      closeSse();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, []);

  // Countdown tick for expiry and resend cooldown
  useEffect(() => {
    if (!otpSent || !expiresAt) return;
    const interval = window.setInterval(() => {
      const rem = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemainingSeconds(rem);
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [otpSent, expiresAt]);

  // Connect real-time SSE stream for OTP status updates
  useEffect(() => {
    closeSse();
    if (!otpSent || !challengeId) return;

    const es = new EventSource(
      `/api/auth/patient/otp-stream/${encodeURIComponent(challengeId)}`
    );
    sseRef.current = es;

    es.addEventListener('otp', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as OtpRealtimeStatus;
        setRealtimeStatusMsg(data.message);
        if (typeof data.remainingSeconds === 'number') {
          setRemainingSeconds(data.remainingSeconds);
        }
        if (typeof data.resendCooldownSeconds === 'number') {
          setResendCooldown(data.resendCooldownSeconds);
        }
      } catch {
        // ignore malformed event
      }
    });

    es.onerror = () => {
      // keep form usable even if SSE reconnects
    };

    return () => {
      es.close();
    };
  }, [otpSent, challengeId]);

  const playBase64Audio = async (base64: string, mimeType = 'audio/wav') => {
    stopVoiceAudio();
    const audio = new Audio(`data:${mimeType};base64,${base64}`);
    audioRef.current = audio;
    audio.onended = () => {
      setVoiceOtpPlaying(false);
      audioRef.current = null;
    };
    audio.onerror = () => {
      setVoiceOtpPlaying(false);
      setError('Unable to play synthesized OTP voice audio.');
    };
    setVoiceOtpPlaying(true);
    await audio.play();
  };

  const handleRoleSwitch = (nextRole: UserRole) => {
    setRole(nextRole);
    setAadhaarNumber('');
    setAadhaarPhoto(null);
    setAadhaarConsent(false);
    setError(null);
    setDemoOtpNotice(null);
    setOtpSent(false);
    setOtp('');
    setChallengeId('');
    setRealtimeStatusMsg(null);
    stopVoiceAudio();
  };

  const applyOtpResponse = (res: OtpRequestResponse) => {
    setOtpSent(true);
    setChallengeId(res.challengeId);
    setNormalizedMobile(res.normalizedMobile);
    setExpiresAt(res.expiresAt);
    setRemainingSeconds(Math.max(0, Math.ceil((res.expiresAt - Date.now()) / 1000)));
    setResendCooldown(res.resendCooldownSeconds || 30);
    setDeliveryProvider(res.deliveryProvider);
    setRealtimeStatusMsg(res.message);

    if (res.demoOtp) {
      setDemoOtpNotice(
        `Real-Time Sandbox OTP for ${res.normalizedMobile}: ${res.demoOtp}`
      );
    } else {
      setDemoOtpNotice(null);
    }

    if (res.voiceError) {
      setError(res.voiceError);
    } else if (res.voiceAudioBase64) {
      void playBase64Audio(res.voiceAudioBase64, res.voiceMimeType || 'audio/wav');
    }
  };

  const handleRequestOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (
      patientAuthMode === 'register' &&
      (Boolean(aadhaarNumber) !== Boolean(aadhaarPhoto) ||
        (Boolean(aadhaarNumber || aadhaarPhoto) && !aadhaarConsent))
    ) {
      setError(
        aadhaarNumber || aadhaarPhoto
          ? aadhaarNumber && aadhaarPhoto
            ? 'Please consent to encrypt and store the Aadhaar details you provided.'
            : 'Please provide both your Aadhaar number and card photo.'
          : ''
      );
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest<OtpRequestResponse>('/api/auth/patient/request-otp', {
        method: 'POST',
        body: JSON.stringify({
          mobile,
          channel: deliveryChannel,
          language: voiceLanguage,
        }),
      });
      applyOtpResponse(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async (overrideChannel?: 'sms' | 'voice') => {
    if (resendCooldown > 0) return;
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<OtpRequestResponse>('/api/auth/patient/resend-otp', {
        method: 'POST',
        body: JSON.stringify({
          mobile: normalizedMobile || mobile,
          channel: overrideChannel || deliveryChannel,
          language: voiceLanguage,
        }),
      });
      applyOtpResponse(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handlePlayVoiceOtp = async () => {
    if (voiceOtpPlaying) {
      stopVoiceAudio();
      return;
    }
    setError(null);
    setVoiceOtpLoading(true);
    try {
      const res = await apiRequest<{ audioBase64: string; mimeType: string }>(
        '/api/auth/patient/voice-otp',
        {
          method: 'POST',
          body: JSON.stringify({
            mobile: normalizedMobile || mobile,
            challengeId,
            language: voiceLanguage,
          }),
        }
      );
      await playBase64Audio(res.audioBase64, res.mimeType || 'audio/wav');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to play Gemini Voice OTP.');
    } finally {
      setVoiceOtpLoading(false);
    }
  };

  const toggleVoiceDictation = async (mode: 'phone' | 'otp') => {
    if (recordingMode === mode) {
      recorderRef.current?.stop();
      setRecordingMode(null);
      return;
    }

    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size === 0) return;
        setTranscribingMode(mode);
        try {
          const fd = new FormData();
          fd.append('audio', blob, `voice_${mode}.webm`);
          fd.append('mode', mode);
          const res = await apiRequest<{ transcript: string; digits: string }>(
            '/api/auth/patient/voice-input',
            { method: 'POST', body: fd }
          );
          if (!res.digits) {
            setError('Could not detect spoken digits clearly. Please try again.');
          } else if (mode === 'phone') {
            setMobile(res.digits);
          } else {
            setOtp(res.digits.slice(0, 6));
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Voice transcription failed.');
        } finally {
          setTranscribingMode(null);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecordingMode(mode);
    } catch {
      setError('Microphone permission denied. Please type digits manually.');
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = new FormData();
      body.append('mobile', normalizedMobile || mobile);
      body.append('otp', otp);
      body.append('challengeId', challengeId);
      body.append('mode', patientAuthMode);
      body.append('registrationConsent', String(registrationConsent));
      if (patientAuthMode === 'register') {
        body.append('registration', JSON.stringify(registration));
        if (aadhaarNumber && aadhaarPhoto) {
          body.append('aadhaarNumber', aadhaarNumber);
          body.append('aadhaarConsent', String(aadhaarConsent));
          body.append('aadhaarPhoto', aadhaarPhoto);
        }
      }
      const res = await apiRequest<{ token: string; user: AuthSessionUser }>(
        '/api/auth/patient/verify-otp',
        {
          method: 'POST',
          body,
        }
      );
      stopVoiceAudio();
      closeSse();
      setStoredToken(res.token);
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleStaffLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthSessionUser }>(
        '/api/auth/staff/login',
        {
          method: 'POST',
          body: JSON.stringify({ identifier, password, role }),
        }
      );
      setStoredToken(res.token);
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const fillSampleCreds = (sampleRole: UserRole) => {
    setError(null);
    if (sampleRole === 'admin') {
      setIdentifier('admin@aarogyadrishti.org');
      setPassword('Admin@123');
    } else if (sampleRole === 'hospital_manager') {
      setIdentifier('HOSP-1001');
      setPassword('Manager@123');
    } else if (sampleRole === 'doctor') {
      setIdentifier('DOC-2001');
      setPassword('Doctor@123');
    }
  };

  const formattedCountdown = `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(
    remainingSeconds % 60
  ).padStart(2, '0')}`;
  const today = new Date();
  const maxDateOfBirth = new Date(
    today.getTime() - today.getTimezoneOffset() * 60_000
  )
    .toISOString()
    .slice(0, 10);
  const hasAadhaarDetails = Boolean(aadhaarNumber || aadhaarPhoto);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A192F]/55 backdrop-blur-xs p-4">
      <div className="bg-white border border-gray-200/80 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="ad-grad-teal relative overflow-hidden flex items-center justify-between px-6 py-4 text-white">
          <div className="ad-banner-grid absolute inset-0 pointer-events-none opacity-60" />
          <div className="relative z-10">
            <h2 className="text-lg font-bold font-display">
              {role === 'patient' && patientAuthMode === 'register'
                ? 'Register a Patient Account'
                : 'Sign in to Aarogya Drishti'}
            </h2>
            <p className="text-xs text-white/80">
              {role === 'patient' && patientAuthMode === 'register'
                ? 'Complete the form to create your patient account.'
                : 'Select your account role to continue'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopVoiceAudio();
              closeSse();
              onClose();
            }}
            aria-label="Close sign in dialog"
            className="relative z-10 p-2 text-white/80 hover:text-white rounded-full hover:bg-white/15 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Role Selector Tabs */}
        <div className="px-6 pt-4">
          <div className="grid grid-cols-4 gap-1 p-1 bg-[#FBFBFA] rounded-full border border-gray-200">
            {(
              [
                ['patient', 'Patient'],
                ['doctor', 'Doctor'],
                ['hospital_manager', 'Manager'],
                ['admin', 'Admin'],
              ] as Array<[UserRole, string]>
            ).map(([r, label]) => (
              <button
                key={r}
                type="button"
                onClick={() => handleRoleSwitch(r)}
                className={`py-2 px-2 text-xs font-semibold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                  role === r
                    ? 'ad-btn-teal text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
              {error}
            </div>
          )}

          {role === 'patient' ? (
            <>
              {!otpSent && (
                <div className="grid grid-cols-2 gap-1 p-1 mb-4 bg-slate-100 rounded-xl">
                  {([
                    ['login', 'Existing Patient'],
                    ['register', 'New Patient Registration'],
                  ] as Array<[PatientAuthMode, string]>).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setPatientAuthMode(mode);
                        setError(null);
                        setRegistrationConsent(false);
                        if (mode === 'login') {
                          setAadhaarNumber('');
                          setAadhaarPhoto(null);
                          setAadhaarConsent(false);
                        }
                      }}
                      className={`min-h-10 rounded-lg px-2 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                        patientAuthMode === mode
                          ? 'bg-white text-teal-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {!otpSent ? (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <Smartphone className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>
                    {patientAuthMode === 'register'
                      ? 'Register a new patient account after verifying this phone number with OTP.'
                      : 'Sign in to your existing patient account using a one-time phone code.'}{' '}
                    OTP is available by SMS or <strong>Gemini AI Voice Call</strong>. 10-digit numbers default to +91.
                  </span>
                </div>

                {patientAuthMode === 'register' && (
                  <>
                    <div>
                      <label htmlFor="registration-full-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Full Name
                      </label>
                      <input
                        id="registration-full-name"
                        type="text"
                        required
                        minLength={2}
                        maxLength={100}
                        autoComplete="name"
                        value={registration.fullName}
                        onChange={(event) =>
                          setRegistration({ ...registration, fullName: event.target.value })
                        }
                        placeholder="Enter your full name"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="registration-date-of-birth" className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Date of Birth
                        </label>
                        <input
                          id="registration-date-of-birth"
                          type="date"
                          required
                          max={maxDateOfBirth}
                          autoComplete="bday"
                          value={registration.dateOfBirth}
                          onChange={(event) =>
                            setRegistration({
                              ...registration,
                              dateOfBirth: event.target.value,
                            })
                          }
                          className="w-full min-w-0 px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      </div>
                      <div>
                        <label htmlFor="registration-age" className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Age
                        </label>
                        <input
                          id="registration-age"
                          type="text"
                          readOnly
                          value={
                            registration.dateOfBirth
                              ? getAgeFromDateOfBirth(registration.dateOfBirth) ?? ''
                              : ''
                          }
                          placeholder="Calculated from date of birth"
                          className="w-full min-w-0 px-3 py-2.5 text-sm border border-slate-200 bg-slate-50 text-slate-600 rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="registration-gender" className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Gender
                        </label>
                        <select
                          id="registration-gender"
                          required
                          value={registration.gender}
                          onChange={(event) =>
                            setRegistration({ ...registration, gender: event.target.value })
                          }
                          className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        >
                          <option value="">Select gender</option>
                          <option value="female">Female</option>
                          <option value="male">Male</option>
                          <option value="other">Other</option>
                          <option value="prefer_not_to_say">Prefer not to say</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="registration-blood-group" className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Blood Group
                        </label>
                        <select
                          id="registration-blood-group"
                          required
                          value={registration.bloodGroup}
                          onChange={(event) =>
                            setRegistration({ ...registration, bloodGroup: event.target.value })
                          }
                          className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        >
                          <option value="">Select blood group</option>
                          {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => (
                            <option key={group} value={group}>{group}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="registration-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Email
                      </label>
                      <input
                        id="registration-email"
                        type="email"
                        required
                        maxLength={254}
                        autoComplete="email"
                        value={registration.email}
                        onChange={(event) =>
                          setRegistration({ ...registration, email: event.target.value })
                        }
                        placeholder="name@example.com"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <div>
                      <label htmlFor="registration-address" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Address
                      </label>
                      <textarea
                        id="registration-address"
                        required
                        maxLength={300}
                        rows={2}
                        autoComplete="street-address"
                        value={registration.address}
                        onChange={(event) =>
                          setRegistration({ ...registration, address: event.target.value })
                        }
                        placeholder="House number, street, locality"
                        className="w-full resize-y px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {([
                        ['state', 'State', 'address-level1'],
                        ['district', 'District', 'address-level2'],
                        ['mandal', 'Mandal', 'address-level3'],
                        ['village', 'Village / City', 'address-level2'],
                      ] as Array<[keyof PatientRegistrationDetails, string, string]>).map(
                        ([field, label, autocomplete]) => (
                          <div key={field}>
                            <label htmlFor={`registration-${field}`} className="block text-xs font-semibold text-slate-700 mb-1.5">
                              {label}
                            </label>
                            <input
                              id={`registration-${field}`}
                              type="text"
                              required
                              maxLength={100}
                              autoComplete={autocomplete}
                              value={registration[field]}
                              onChange={(event) =>
                                setRegistration({ ...registration, [field]: event.target.value })
                              }
                              className="w-full min-w-0 px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                            />
                          </div>
                        )
                      )}
                    </div>

                    <div>
                      <label htmlFor="registration-pincode" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        PIN Code
                      </label>
                      <input
                        id="registration-pincode"
                        type="text"
                        inputMode="numeric"
                        pattern="[1-9][0-9]{5}"
                        maxLength={6}
                        required
                        autoComplete="postal-code"
                        value={registration.pincode}
                        onChange={(event) =>
                          setRegistration({
                            ...registration,
                            pincode: event.target.value.replace(/\D/g, '').slice(0, 6),
                          })
                        }
                        placeholder="6-digit PIN code"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
                      <input
                        type="checkbox"
                        required
                        checked={registrationConsent}
                        onChange={(event) => setRegistrationConsent(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700"
                      />
                      <span>
                        I agree to provide these details to create and manage my patient account.
                      </span>
                    </label>
                  </>
                )}

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label htmlFor="patient-mobile" className="block text-xs font-semibold text-slate-700">
                      Mobile Number
                    </label>
                    <button
                      type="button"
                      disabled={transcribingMode === 'phone'}
                      onClick={() => void toggleVoiceDictation('phone')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md border cursor-pointer ${
                        recordingMode === 'phone'
                          ? 'bg-red-50 border-red-300 text-red-700'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {recordingMode === 'phone' ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          Stop
                        </>
                      ) : (
                        <>
                          <Mic className="w-3 h-3 text-teal-700" />
                          {transcribingMode === 'phone' ? 'Listening...' : 'Speak Number'}
                        </>
                      )}
                    </button>
                  </div>
                  <input
                    id="patient-mobile"
                    type="tel"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    autoComplete="tel"
                    placeholder="e.g. 9876543210 or +919876543210"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                {patientAuthMode === 'register' && (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs leading-relaxed text-slate-600">
                      Aadhaar details are optional, encrypted before storage, and not required to use your patient account.
                    </p>
                    <div>
                      <label htmlFor="registration-aadhaar-number" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Aadhaar Number (optional)
                      </label>
                      <input
                        id="registration-aadhaar-number"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        pattern="[0-9]{12}"
                        maxLength={12}
                        required={Boolean(aadhaarPhoto)}
                        value={aadhaarNumber}
                        onChange={(event) =>
                          setAadhaarNumber(event.target.value.replace(/\D/g, '').slice(0, 12))
                        }
                        aria-describedby="registration-aadhaar-help"
                        placeholder="Enter 12-digit Aadhaar number"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                      <p id="registration-aadhaar-help" className="mt-1 text-[11px] text-slate-500">
                        Aadhaar is not verified automatically.
                      </p>
                    </div>
                    <div>
                      <label htmlFor="registration-aadhaar-photo" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Aadhaar Card Photo (optional)
                      </label>
                      <input
                        id="registration-aadhaar-photo"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        required={Boolean(aadhaarNumber)}
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          if (file && file.size > 3 * 1024 * 1024) {
                            setError('Aadhaar card photo must be 3 MB or smaller.');
                            event.target.value = '';
                            setAadhaarPhoto(null);
                            return;
                          }
                          setError(null);
                          setAadhaarPhoto(file);
                        }}
                        className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-teal-800 file:shadow-sm hover:file:bg-teal-50"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Upload a JPG, PNG, or WEBP image up to 3 MB.
                      </p>
                    </div>
                    {hasAadhaarDetails && (
                      <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
                        <input
                          type="checkbox"
                          required
                          checked={aadhaarConsent}
                          onChange={(event) => setAadhaarConsent(event.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700"
                        />
                        <span>
                          I consent to encrypt and store the Aadhaar number and card photo I provided with my account.
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {/* OTP Delivery Channel & Voice Language */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDeliveryChannel('sms')}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg border cursor-pointer ${
                      deliveryChannel === 'sms'
                        ? 'bg-teal-50 border-teal-300 text-teal-900'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    Real-Time SMS OTP
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryChannel('voice')}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg border cursor-pointer ${
                      deliveryChannel === 'voice'
                        ? 'bg-teal-50 border-teal-300 text-teal-900'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    Gemini AI Voice Call
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Voice OTP Language:</span>
                  <div className="inline-flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setVoiceLanguage('en')}
                      className={`px-2.5 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                        voiceLanguage === 'en'
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      English
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoiceLanguage('hi')}
                      className={`px-2.5 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                        voiceLanguage === 'hi'
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Hindi (Hinglish)
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoiceLanguage('te')}
                      className={`px-2.5 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                        voiceLanguage === 'te'
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Telugu
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="ad-btn-teal w-full py-2.5 px-4 text-sm font-semibold text-white disabled:opacity-60 rounded-full transition-all cursor-pointer"
                >
                  {loading
                    ? deliveryChannel === 'voice'
                      ? 'Generating Gemini Voice OTP...'
                      : 'Sending Real-Time OTP...'
                    : deliveryChannel === 'voice'
                    ? 'Receive 6-Digit Gemini Voice OTP'
                    : 'Send 6-Digit OTP'}
                </button>
              </form>
              ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">
                      {normalizedMobile || mobile} ·{' '}
                      <span className="text-teal-700">
                        {deliveryProvider === 'realtime_sandbox'
                          ? 'Live Stream'
                          : deliveryProvider.toUpperCase()}
                      </span>
                    </p>
                    {realtimeStatusMsg && (
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {realtimeStatusMsg}
                      </p>
                    )}
                  </div>
                  <span className="font-mono font-bold text-slate-900 tabular-nums shrink-0">
                    {formattedCountdown}
                  </span>
                </div>

                {demoOtpNotice && (
                  <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-xs font-medium text-teal-900">
                    {demoOtpNotice}
                  </div>
                )}

                {/* Gemini AI Voice OTP Call Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-teal-200 bg-teal-50/50">
                  <div className="flex items-center gap-2 text-xs text-teal-950 font-medium">
                    <PhoneCall className="w-4 h-4 text-teal-700 shrink-0" />
                    <span>Hear OTP via Gemini AI Voice</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Voice OTP language"
                      value={voiceLanguage}
                      onChange={(e) => {
                        if (isVoiceLanguage(e.currentTarget.value)) {
                          setVoiceLanguage(e.currentTarget.value);
                        }
                      }}
                      className="px-2 py-1 text-[11px] border border-teal-200 rounded bg-white text-slate-800"
                    >
                      <option value="en">EN</option>
                      <option value="hi">HI</option>
                      <option value="te">TE</option>
                    </select>
                    <button
                      type="button"
                      disabled={voiceOtpLoading}
                      onClick={() => void handlePlayVoiceOtp()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      {voiceOtpPlaying ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          Stop Call
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3.5 h-3.5" />
                          {voiceOtpLoading ? 'Calling...' : 'Play Voice OTP'}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Enter 6-Digit OTP
                    </label>
                    <button
                      type="button"
                      disabled={transcribingMode === 'otp'}
                      onClick={() => void toggleVoiceDictation('otp')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md border cursor-pointer ${
                        recordingMode === 'otp'
                          ? 'bg-red-50 border-red-300 text-red-700'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {recordingMode === 'otp' ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          Stop
                        </>
                      ) : (
                        <>
                          <Mic className="w-3 h-3 text-teal-700" />
                          {transcribingMode === 'otp' ? 'Listening...' : 'Speak OTP'}
                        </>
                      )}
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit OTP"
                    className="w-full px-3.5 py-2.5 text-sm font-mono tracking-widest border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
                  />
                </div>

                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    disabled={resendCooldown > 0 || loading}
                    onClick={() => void handleResendOtp()}
                    className="inline-flex items-center gap-1.5 font-semibold text-teal-700 hover:underline disabled:text-slate-400 disabled:no-underline cursor-pointer tabular-nums"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      stopVoiceAudio();
                      closeSse();
                      setOtpSent(false);
                      setOtp('');
                      setChallengeId('');
                      setDemoOtpNotice(null);
                      setRealtimeStatusMsg(null);
                    }}
                    className="font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Change Number
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading || remainingSeconds === 0}
                  className="ad-btn-teal w-full py-2.5 px-4 text-sm font-semibold text-white disabled:opacity-60 rounded-full transition-all cursor-pointer"
                >
                  {loading ? 'Verifying...' : 'Verify & Access Dashboard'}
                </button>
              </form>
              )}
            </>
          ) : (
            <form onSubmit={handleStaffLogin} className="space-y-4">
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                <span className="text-slate-600 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-teal-700" />
                  {role === 'admin'
                    ? 'Platform Administrator Credentials'
                    : role === 'hospital_manager'
                    ? 'Enter Hospital ID (e.g. HOSP-1001)'
                    : role === 'asha_worker'
                    ? 'Enter ASHA Worker ID (issued by your manager)'
                    : 'Enter Doctor ID (e.g. DOC-2001)'}
                </span>
                {role !== 'asha_worker' && (
                  <button
                    type="button"
                    onClick={() => fillSampleCreds(role)}
                    className="font-semibold text-teal-700 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    Use Test Account
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {role === 'admin'
                    ? 'Admin Email'
                    : role === 'hospital_manager'
                    ? 'Hospital ID or Manager Email'
                    : role === 'asha_worker'
                    ? 'ASHA Worker ID'
                    : 'Doctor ID or Email'}
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={
                    role === 'admin'
                      ? 'admin@aarogyadrishti.org'
                      : role === 'hospital_manager'
                      ? 'HOSP-1001'
                      : role === 'asha_worker'
                      ? 'ASHA-1001'
                      : 'DOC-2001'
                  }
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="ad-btn-teal w-full py-2.5 px-4 text-sm font-semibold text-white disabled:opacity-60 rounded-full transition-all cursor-pointer"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
