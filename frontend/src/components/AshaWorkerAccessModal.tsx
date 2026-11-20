import { useEffect, useState, type FormEvent } from 'react';
import { Building2, Lock, MapPin, Phone, ShieldCheck, UserPlus, X } from 'lucide-react';
import { apiRequest, setStoredToken } from '../utils/api.js';
import type { AuthSessionUser } from './AuthModal.js';

interface AshaWorkerAccessModalProps {
  onClose: () => void;
  onAuthenticated: (token: string, user: AuthSessionUser) => void;
}

interface HospitalOption {
  id: string;
  name: string;
  city: string;
  state: string;
}

interface RegistrationForm {
  fullName: string;
  mobile: string;
  officialId: string;
  village: string;
  mandal: string;
  hospitalId: string;
  address: string;
  password: string;
  confirmPassword: string;
}

const EMPTY_FORM: RegistrationForm = {
  fullName: '',
  mobile: '',
  officialId: '',
  village: '',
  mandal: '',
  hospitalId: '',
  address: '',
  password: '',
  confirmPassword: '',
};

export function AshaWorkerAccessModal({
  onClose,
  onAuthenticated,
}: AshaWorkerAccessModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState(EMPTY_FORM);
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [loadingHospitals, setLoadingHospitals] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ hospitals: HospitalOption[] }>('/api/patient/discover')
      .then((result) => setHospitals(result.hospitals || []))
      .catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load PHC/Hospital options.'
        );
      })
      .finally(() => setLoadingHospitals(false));
  }, []);

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiRequest<{ message: string }>('/api/auth/asha/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName: form.fullName,
          mobile: form.mobile,
          officialId: form.officialId,
          village: form.village,
          mandal: form.mandal,
          hospitalId: form.hospitalId,
          address: form.address,
          password: form.password,
        }),
      });
      setSuccess(result.message);
      setForm({ ...EMPTY_FORM, officialId: form.officialId });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to submit registration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const result = await apiRequest<{ token: string; user: AuthSessionUser }>(
        '/api/auth/staff/login',
        {
          method: 'POST',
          body: JSON.stringify({
            identifier: form.officialId,
            password: form.password,
            role: 'asha_worker',
          }),
        }
      );
      setStoredToken(result.token);
      onAuthenticated(result.token, result.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClassName =
    'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0A192F]/55 p-4 backdrop-blur-xs">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-gray-200/80 bg-white shadow-2xl">
        <header className="ad-grad-teal relative flex items-center justify-between overflow-hidden px-6 py-4 text-white">
          <div className="ad-banner-grid pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative z-10">
            <h2 className="font-display text-lg font-bold">ASHA Worker Access</h2>
            <p className="text-xs text-white/80">
              Separate worker registration and sign-in; approval is required before access.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ASHA Worker Access"
            className="relative z-10 cursor-pointer rounded-full p-2 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-5 sm:p-6">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {([
              ['login', 'ASHA Worker Sign In'],
              ['register', 'Register as ASHA Worker'],
            ] as const).map(([nextMode, label]) => (
              <button
                key={nextMode}
                type="button"
                onClick={() => {
                  setMode(nextMode);
                  setError(null);
                  setSuccess(null);
                }}
                className={`min-h-10 rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
                  mode === nextMode
                    ? 'bg-white text-teal-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
          {success && (
            <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              {success}
            </div>
          )}

          {mode === 'register' ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="flex items-start gap-2 rounded-xl border border-teal-100 bg-teal-50 p-3 text-xs leading-relaxed text-teal-950">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Your account stays inactive until a Hospital Manager reviews and approves your official ASHA ID and assignment.
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">
                  Full name
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    autoComplete="name"
                    value={form.fullName}
                    onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                    className={inputClassName}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Mobile number
                  <input
                    required
                    type="tel"
                    maxLength={32}
                    autoComplete="tel"
                    value={form.mobile}
                    onChange={(event) => setForm({ ...form, mobile: event.target.value })}
                    className={inputClassName}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Official ASHA ID
                  <input
                    required
                    minLength={3}
                    maxLength={60}
                    autoComplete="username"
                    value={form.officialId}
                    onChange={(event) => setForm({ ...form, officialId: event.target.value })}
                    className={inputClassName}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  PHC / Hospital
                  <select
                    required
                    value={form.hospitalId}
                    disabled={loadingHospitals || hospitals.length === 0}
                    onChange={(event) => setForm({ ...form, hospitalId: event.target.value })}
                    className={inputClassName}
                  >
                    <option value="">
                      {loadingHospitals ? 'Loading PHC/Hospitals…' : 'Select PHC / Hospital'}
                    </option>
                    {hospitals.map((hospital) => (
                      <option key={hospital.id} value={hospital.id}>
                        {hospital.name} · {hospital.city}, {hospital.state}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Village
                  <input
                    required
                    maxLength={100}
                    value={form.village}
                    onChange={(event) => setForm({ ...form, village: event.target.value })}
                    className={inputClassName}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Mandal
                  <input
                    required
                    maxLength={100}
                    value={form.mandal}
                    onChange={(event) => setForm({ ...form, mandal: event.target.value })}
                    className={inputClassName}
                  />
                </label>
              </div>
              <label className="block text-xs font-semibold text-slate-700">
                Address
                <textarea
                  required
                  maxLength={300}
                  rows={2}
                  autoComplete="street-address"
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                  className={inputClassName}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">
                  Password (12–72 characters)
                  <input
                    required
                    type="password"
                    minLength={12}
                    maxLength={72}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    className={inputClassName}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Confirm password
                  <input
                    required
                    type="password"
                    minLength={12}
                    maxLength={72}
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    onChange={(event) =>
                      setForm({ ...form, confirmPassword: event.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={submitting || loadingHospitals || hospitals.length === 0}
                className="ad-btn-teal inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                <UserPlus className="h-4 w-4" />
                {submitting ? 'Submitting registration…' : 'Submit for approval'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="mx-auto max-w-md space-y-4">
              <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                <span>Only approved ASHA Workers can sign in. Use the Official ASHA ID and password you registered.</span>
              </div>
              <label className="block text-xs font-semibold text-slate-700">
                Official ASHA ID
                <input
                  required
                  maxLength={60}
                  autoComplete="username"
                  value={form.officialId}
                  onChange={(event) => setForm({ ...form, officialId: event.target.value })}
                  className={inputClassName}
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Password
                <input
                  required
                  type="password"
                  maxLength={72}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  className={inputClassName}
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="ad-btn-teal inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Phone className="h-4 w-4" />
                {submitting ? 'Signing in…' : 'Sign in to ASHA Dashboard'}
              </button>
            </form>
          )}
        </div>
        <footer className="flex items-center justify-center gap-2 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          Patient access remains separate from the shared Sign In dialog.
          <Building2 className="h-3.5 w-3.5" />
        </footer>
      </div>
    </div>
  );
}
