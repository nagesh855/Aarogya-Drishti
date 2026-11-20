import { useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  MapPin,
  Package,
  Phone,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { apiRequest } from '../../utils/api.js';
import type {
  AshaFollowup,
  AshaFollowupOutcome,
  AshaFollowupType,
  AshaWorker,
} from '../../../../shared/types/index.js';
import type { WsSignalMessage } from '../../hooks/useWebSocket.js';
import { SignatureCard } from '../ui/SignatureCard.js';

interface AshaPatientRow {
  id: string;
  fullName: string;
  mobile: string;
  village: string;
  mandal: string;
  age?: number;
  aadhaarMasked?: string;
  clinicalRecordsConsent: boolean;
  screeningCount: number;
  latestScreeningId?: string;
  latestScreeningStatus?: string;
  latestScreeningAt?: string;
  latestRiskCategory?: string;
  screeningRecords: Array<{
    id: string;
    reportCode: string;
    createdAt: string;
    status: string;
    reportedRegion: string;
    riskCategory: string;
    symptoms: string[];
    symptomDuration: string;
    patientReportedSymptoms: string;
  }>;
  healthRecords: Array<{
    id: string;
    date: string;
    specialistName: string;
    hospitalName: string;
    clinicalObservations: string;
    consultationNotes: string;
    prescription: string;
    recommendations: string;
    referralRecommended: boolean;
    referralDetails: string;
    followUpDate: string;
    followUpInstructions: string;
  }>;
  latestAppointmentId?: string;
  latestAppointmentStatus?: string;
  latestAppointmentDate?: string;
  referrals: Array<{
    id: string;
    appointmentCode: string;
    hospitalName: string;
    date: string;
    status: string;
    reason: string;
  }>;
  latestFollowupDate: string;
}

interface AshaDashboardProps {
  activeTab: string;
  onChangeTab: (tab: string) => void;
  lastSignalMessage: WsSignalMessage | null;
}

const OUTCOME_LABELS: Record<AshaFollowupOutcome, string> = {
  education_provided: 'Health education provided',
  referred_to_doctor: 'Referred to a doctor',
  follow_up_required: 'Follow-up needed',
};

const FOLLOWUP_TYPE_LABELS: Record<AshaFollowupType, string> = {
  visit: 'Follow-up visit',
  screening_reminder: 'Screening reminder',
  appointment_followup: 'Appointment follow-up',
};

const SYMPTOM_LABELS: Record<string, string> = {
  whitePatches: 'White patches',
  redPatches: 'Red patches',
  nonHealingUlcers: 'Non-healing ulcers',
  unusualGrowthsOrLumps: 'Unusual growths or lumps',
  difficultyOpeningMouth: 'Difficulty opening mouth',
  difficultySwallowing: 'Difficulty swallowing',
  painWhileChewing: 'Pain while chewing',
  bleedingInsideMouth: 'Bleeding inside mouth',
  persistentPainOrNumbness: 'Persistent pain or numbness',
  voiceChangeOrNeckSwelling: 'Voice change or neck swelling',
};

export function AshaDashboard({ activeTab, onChangeTab, lastSignalMessage }: AshaDashboardProps) {
  const [worker, setWorker] = useState<AshaWorker | null>(null);
  const [hospitalName, setHospitalName] = useState('');
  const [patients, setPatients] = useState<AshaPatientRow[]>([]);
  const [followups, setFollowups] = useState<Array<AshaFollowup & { patientName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState<AshaPatientRow | null>(null);
  const [followupType, setFollowupType] = useState<AshaFollowupType>('visit');
  const [outcome, setOutcome] = useState<AshaFollowupOutcome>('education_provided');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [followUpDate, setFollowUpDate] = useState('');
  const [notes, setNotes] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [recordPatientId, setRecordPatientId] = useState('');
  const [referralPatientId, setReferralPatientId] = useState('');
  const [referralReason, setReferralReason] = useState('');
  const [savingReferral, setSavingReferral] = useState(false);
  const [savingInventory, setSavingInventory] = useState(false);
  const [medikitCount, setMedikitCount] = useState(0);
  const [biopsyReferralKitCount, setBiopsyReferralKitCount] = useState(0);
  const [dutyStatus, setDutyStatus] = useState<'active' | 'on_field'>('active');

  const loadData = async () => {
    setLoading(true);
    try {
      const [me, patientResult, followupResult] = await Promise.all([
        apiRequest<{ worker: AshaWorker; hospitalName: string }>('/api/asha/me'),
        apiRequest<{ patients: AshaPatientRow[] }>('/api/asha/patients'),
        apiRequest<{ followups: Array<AshaFollowup & { patientName: string }> }>('/api/asha/followups'),
      ]);
      setWorker(me.worker);
      setHospitalName(me.hospitalName);
      setDutyStatus(me.worker.dutyStatus || 'active');
      setMedikitCount(me.worker.medikitCount || 0);
      setBiopsyReferralKitCount(me.worker.biopsyReferralKitCount || 0);
      setPatients(patientResult.patients);
      setFollowups(followupResult.followups);
      setSelectedPatient((current) =>
        current ? patientResult.patients.find((patient) => patient.id === current.id) || null : null
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to load ASHA Worker data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (lastSignalMessage?.type === 'asha-update') void loadData();
  }, [lastSignalMessage]);

  const saveFollowup = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPatient) return;
    setFeedback(null);
    try {
      await apiRequest(`/api/asha/patients/${selectedPatient.id}/followups`, {
        method: 'POST',
        body: JSON.stringify({
          type: followupType,
          outcome,
          visitDate,
          followUpDate,
          notes,
          screeningId: followupType === 'screening_reminder' ? selectedPatient.latestScreeningId : undefined,
          appointmentId:
            followupType === 'appointment_followup' ? selectedPatient.latestAppointmentId : undefined,
        }),
      });
      setNotes('');
      setFollowUpDate('');
      setFollowupType('visit');
      setFeedback(`Follow-up saved for ${selectedPatient.fullName}.`);
      await loadData();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to save follow-up.');
    }
  };

  const updateDutyStatus = async (status: 'active' | 'on_field') => {
    setFeedback(null);
    try {
      await apiRequest('/api/asha/me/duty-status', {
        method: 'PATCH',
        body: JSON.stringify({ dutyStatus: status }),
      });
      setDutyStatus(status);
      setFeedback(`Your status is now ${status === 'on_field' ? 'On field' : 'Active'}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to update your status.');
    }
  };

  const saveInventory = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    setSavingInventory(true);
    try {
      await apiRequest('/api/asha/me/inventory', {
        method: 'PATCH',
        body: JSON.stringify({ medikitCount, biopsyReferralKitCount }),
      });
      setFeedback('Kit inventory updated.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to update kit inventory.');
    } finally {
      setSavingInventory(false);
    }
  };

  const createReferral = async (event: FormEvent) => {
    event.preventDefault();
    if (!referralPatientId) return;
    setFeedback(null);
    setSavingReferral(true);
    try {
      await apiRequest(`/api/asha/patients/${referralPatientId}/referrals`, {
        method: 'POST',
        body: JSON.stringify({ reason: referralReason }),
      });
      setReferralReason('');
      setReferralPatientId('');
      setFeedback('Hospital referral submitted. The patient and hospital have been notified.');
      await loadData();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to submit hospital referral.');
    } finally {
      setSavingReferral(false);
    }
  };

  const referralRows = patients.flatMap((patient) =>
    patient.referrals.map((referral) => ({ ...referral, patientName: patient.fullName }))
  );
  const today = new Date().toISOString().slice(0, 10);
  const openReferralCount = referralRows.filter((referral) =>
    ['pending', 'accepted'].includes(referral.status)
  ).length;
  const dueFollowupCount = patients.filter(
    (patient) => patient.latestFollowupDate && patient.latestFollowupDate <= today
  ).length;

  return (
    <div className="space-y-6">
      {worker && (
        <SignatureCard
          variant="teal"
          topRightBadge={!worker.active ? 'Inactive' : dutyStatus === 'on_field' ? 'On field' : 'Active'}
          icon={<MapPin className="w-6 h-6" />}
          pillLabel="Assigned village"
          title={`ASHA Worker · ${worker.fullName}`}
          meta={`${hospitalName} · ${worker.phone} · ${worker.village}, ${worker.mandal || 'Mandal not set'}`}
          tags={[
            ...(worker.officialId ? [`ASHA ID: ${worker.officialId}`] : []),
            `Status: ${!worker.active ? 'Inactive' : dutyStatus === 'on_field' ? 'On field' : 'Active'}`,
          ]}
          metrics={[
            { value: patients.length, label: 'Consented patients' },
            { value: openReferralCount, label: 'Open referrals' },
            { value: dueFollowupCount, label: 'Follow-ups due' },
          ]}
        />
      )}

      {feedback && (
        <div role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
          {feedback}
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <SignatureCard
            variant="navy"
            icon={<ClipboardList className="w-6 h-6" />}
            pillLabel="Community follow-up"
            title="Village care overview"
            meta="Manage consented patient records, screening reminders, hospital referrals, and follow-up visits. ASHA Workers provide awareness and referral support, not diagnosis or treatment."
            footer={{
              label: 'Assigned patient list',
              value: `${patients.length} consented patient${patients.length === 1 ? '' : 's'}`,
              ctaLabel: 'View Patients',
              onCtaClick: () => onChangeTab('patients'),
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <article className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Duty status</p>
              <label className="mt-2 block text-sm font-semibold text-gray-900">
                Current status
                <select
                  value={!worker?.active ? 'inactive' : dutyStatus}
                  disabled={!worker?.active}
                  onChange={(event) =>
                    void updateDutyStatus(event.target.value as 'active' | 'on_field')
                  }
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2"
                >
                  <option value="active">Active</option>
                  <option value="on_field">On field</option>
                  {!worker?.active && <option value="inactive">Inactive (manager controlled)</option>}
                </select>
              </label>
            </article>
            <button
              type="button"
              onClick={() => onChangeTab('referrals')}
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left transition hover:bg-amber-100"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Hospital referrals</p>
              <p className="mt-2 text-2xl font-bold text-amber-950">{openReferralCount}</p>
              <p className="text-xs text-amber-900">Pending or accepted</p>
            </button>
            <button
              type="button"
              onClick={() => onChangeTab('followups')}
              className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-left transition hover:bg-teal-100"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Follow-up tracking</p>
              <p className="mt-2 text-2xl font-bold text-teal-950">{dueFollowupCount}</p>
              <p className="text-xs text-teal-900">Due or overdue</p>
            </button>
          </div>
        </div>
      )}

      {activeTab === 'patients' && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900">
            Patients in {worker?.village || 'your village'}, {worker?.mandal || 'your mandal'}
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading village patients…</p>
          ) : patients.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              No patients have consented to village follow-up yet.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {patients.map((patient) => (
                <SignatureCard
                  key={patient.id}
                  variant="teal"
                  topRightBadge={patient.village}
                  icon={<Users className="w-5 h-5" />}
                  pillLabel={`${patient.screeningCount} screening${patient.screeningCount === 1 ? '' : 's'}`}
                  title={patient.fullName}
                  meta={
                    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{patient.mobile}</span>
                      <span>Age {patient.age ?? '—'}</span>
                      <span>{patient.village}, {patient.mandal}</span>
                    </span>
                  }
                  tags={[
                    `Screening: ${patient.latestRiskCategory || patient.latestScreeningStatus || 'None'}`,
                    `Referral: ${patient.referrals[0]?.status || 'None'}`,
                    patient.latestFollowupDate
                      ? `Follow-up: ${patient.latestFollowupDate <= today ? 'Due' : 'Scheduled'} · ${patient.latestFollowupDate}`
                      : 'Follow-up: Not scheduled',
                  ]}
                  footer={{
                    label: 'Patient follow-up',
                    value: patient.latestFollowupDate
                      ? `Next visit ${patient.latestFollowupDate}`
                      : patient.latestAppointmentStatus
                      ? `Appointment ${patient.latestAppointmentStatus}`
                      : 'No activity recorded',
                    ctaLabel: 'Record Visit',
                    onCtaClick: () => {
                      setSelectedPatient(patient);
                      setFeedback(null);
                    },
                  }}
                >
                    <p className="text-xs text-gray-600">
                      Aadhaar: {patient.aadhaarMasked || 'Not shared'}
                    </p>
                    {!patient.clinicalRecordsConsent && (
                      <p className="text-xs text-amber-800">
                        Detailed symptoms and specialist records are not shared by this patient.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setRecordPatientId(patient.id)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        View patient record
                      </button>
                      {patient.clinicalRecordsConsent && (
                        <button
                          type="button"
                          onClick={() => {
                            setReferralPatientId(patient.id);
                            onChangeTab('referrals');
                          }}
                          className="rounded-lg border border-teal-200 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50"
                        >
                          Refer to hospital
                        </button>
                      )}
                    </div>
                </SignatureCard>
              ))}
            </div>
          )}
          {recordPatientId && (() => {
            const patient = patients.find((item) => item.id === recordPatientId);
            if (!patient) return null;
            return (
              <section className="space-y-4 rounded-2xl border border-teal-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{patient.fullName} · Age {patient.age ?? '—'}</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      {patient.village}, {patient.mandal} · {patient.mobile} · Aadhaar {patient.aadhaarMasked || 'not shared'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRecordPatientId('')}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700"
                  >
                    Close record
                  </button>
                </div>
                {!patient.clinicalRecordsConsent ? (
                  <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    This patient has not consented to share screening symptoms or specialist records. Only basic follow-up status is available.
                  </p>
                ) : (
                  <>
                    <div>
                      <h4 className="font-semibold text-gray-900">Oral disease screening</h4>
                      {patient.screeningRecords.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-500">No screening records are available.</p>
                      ) : (
                        <div className="mt-2 space-y-3">
                          {patient.screeningRecords.map((screening) => (
                            <article key={screening.id} className="rounded-xl border border-gray-200 p-3">
                              <div className="flex flex-wrap justify-between gap-2 text-sm">
                                <span className="font-semibold">{screening.reportCode} · {screening.riskCategory || screening.status}</span>
                                <span className="text-xs text-gray-500">{new Date(screening.createdAt).toLocaleDateString()}</span>
                              </div>
                              {screening.reportedRegion && <p className="mt-1 text-xs text-gray-600">Region: {screening.reportedRegion}</p>}
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {screening.symptoms.length > 0
                                  ? screening.symptoms.map((symptom) => (
                                      <span key={symptom} className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-900">
                                        {SYMPTOM_LABELS[symptom] || symptom}
                                      </span>
                                    ))
                                  : <span className="text-xs text-gray-500">No symptoms reported</span>}
                              </div>
                              {screening.symptomDuration && (
                                <p className="mt-2 text-xs text-gray-600">Duration: {screening.symptomDuration}</p>
                              )}
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">Specialist health records &amp; prescriptions</h4>
                      {patient.healthRecords.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-500">No specialist records shared with this ASHA Worker.</p>
                      ) : (
                        <div className="mt-2 space-y-3">
                          {patient.healthRecords.map((record) => (
                            <article key={record.id} className="rounded-xl border border-gray-200 p-3">
                              <p className="font-semibold text-gray-900">{record.specialistName}</p>
                              <p className="text-xs text-gray-500">{record.hospitalName} · {new Date(record.date).toLocaleDateString()}</p>
                              {record.clinicalObservations && <p className="mt-2 text-sm text-gray-700">{record.clinicalObservations}</p>}
                              {record.consultationNotes && <p className="mt-1 text-sm text-gray-700">{record.consultationNotes}</p>}
                              {record.prescription && (
                                <div className="mt-2 rounded-lg bg-sky-50 p-3">
                                  <p className="text-xs font-bold uppercase text-sky-900">Specialist prescription</p>
                                  <p className="mt-1 whitespace-pre-wrap text-sm text-sky-950">{record.prescription}</p>
                                </div>
                              )}
                              {record.recommendations && <p className="mt-2 text-sm text-gray-700"><strong>Recommendations:</strong> {record.recommendations}</p>}
                              {record.referralRecommended && <p className="mt-1 text-sm text-amber-800"><strong>Referral:</strong> {record.referralDetails || 'Specialist referral recommended'}</p>}
                              {record.followUpDate && <p className="mt-1 text-xs text-gray-600">Specialist follow-up: {record.followUpDate} {record.followUpInstructions}</p>}
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">Hospital referral status</h4>
                      {patient.referrals.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-500">No ASHA referrals recorded.</p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {patient.referrals.map((referral) => (
                            <article key={referral.id} className="rounded-xl border border-gray-200 p-3">
                              <p className="font-semibold text-gray-900">{referral.hospitalName}</p>
                              <p className="mt-1 text-xs text-gray-600">
                                {referral.appointmentCode} · {referral.date} · {referral.status}
                              </p>
                              {referral.reason && <p className="mt-1 text-sm text-gray-700">{referral.reason}</p>}
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            );
          })()}
        </section>
      )}

      {selectedPatient && activeTab === 'patients' && (
        <form onSubmit={saveFollowup} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
          <div>
            <h3 className="font-bold text-gray-900">
              Record follow-up · {selectedPatient.fullName}
            </h3>
            <p className="mt-1 text-xs text-gray-500">Record follow-up only; do not enter a diagnosis or prescribe treatment.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-semibold text-gray-700">
              Follow-up type
              <select
                value={followupType}
                onChange={(event) => setFollowupType(event.target.value as AshaFollowupType)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              >
                {Object.entries(FOLLOWUP_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-700">
              Visit date
              <input required type="date" value={visitDate} onChange={(event) => setVisitDate(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            </label>
            {followupType === 'screening_reminder' && (
              <label className="text-xs font-semibold text-gray-700">
                Screening session
                <select
                  required
                  value={selectedPatient.latestScreeningId || ''}
                  disabled={!selectedPatient.latestScreeningId}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">
                    {selectedPatient.latestScreeningId ? 'Latest screening' : 'No screening available'}
                  </option>
                  {selectedPatient.latestScreeningId && (
                    <option value={selectedPatient.latestScreeningId}>
                      {selectedPatient.latestScreeningAt
                        ? new Date(selectedPatient.latestScreeningAt).toLocaleDateString()
                        : selectedPatient.latestScreeningId}
                    </option>
                  )}
                </select>
              </label>
            )}
            {followupType === 'appointment_followup' && (
              <label className="text-xs font-semibold text-gray-700">
                Appointment
                <select
                  required
                  value={selectedPatient.latestAppointmentId || ''}
                  disabled={!selectedPatient.latestAppointmentId}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">
                    {selectedPatient.latestAppointmentId ? 'Latest appointment' : 'No appointment available'}
                  </option>
                  {selectedPatient.latestAppointmentId && (
                    <option value={selectedPatient.latestAppointmentId}>
                      {selectedPatient.latestAppointmentDate || selectedPatient.latestAppointmentId}
                    </option>
                  )}
                </select>
              </label>
            )}
            <label className="text-xs font-semibold text-gray-700">
              Outcome
              <select value={outcome} onChange={(event) => setOutcome(event.target.value as AshaFollowupOutcome)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
                {Object.entries(OUTCOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-700">
              Next follow-up date {followupType === 'visit' ? '(optional)' : '(required)'}
              <input
                required={followupType !== 'visit'}
                type="date"
                value={followUpDate}
                onChange={(event) => setFollowUpDate(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-gray-700">
            Follow-up notes
            <textarea required maxLength={500} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <button
            type="submit"
            disabled={
              followupType === 'screening_reminder' && !selectedPatient.latestScreeningId ||
              followupType === 'appointment_followup' && !selectedPatient.latestAppointmentId
            }
            className="ad-btn-teal rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save follow-up
          </button>
        </form>
      )}

      {activeTab === 'screenings' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Consented oral screening records</h2>
            <p className="mt-1 text-xs text-gray-500">
              Results are preliminary screening information, not a diagnosis. Refer clinical concerns to a qualified specialist.
            </p>
          </div>
          {patients
            .filter((patient) => patient.clinicalRecordsConsent)
            .flatMap((patient) =>
              patient.screeningRecords.map((screening) => ({ patient, screening }))
            )
            .map(({ patient, screening }) => (
              <article key={screening.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">{patient.fullName} · Age {patient.age ?? '—'}</h3>
                    <p className="text-xs text-gray-500">{patient.village}, {patient.mandal} · {screening.reportCode}</p>
                  </div>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
                    {screening.riskCategory || screening.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-700">
                  {screening.symptoms.length
                    ? screening.symptoms.map((symptom) => SYMPTOM_LABELS[symptom] || symptom).join(', ')
                    : 'No symptoms reported'}
                  {screening.symptomDuration ? ` · Duration: ${screening.symptomDuration}` : ''}
                </p>
                {screening.reportedRegion && <p className="mt-1 text-xs text-gray-600">Region: {screening.reportedRegion}</p>}
                {screening.patientReportedSymptoms && (
                  <p className="mt-1 text-xs text-gray-700">{screening.patientReportedSymptoms}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">{new Date(screening.createdAt).toLocaleDateString()}</p>
              </article>
            ))}
          {!loading &&
            patients.every(
              (patient) => !patient.clinicalRecordsConsent || patient.screeningRecords.length === 0
            ) && (
              <p className="text-sm text-gray-500">
                No oral screening details are available for patients who consented to share them.
              </p>
            )}
        </section>
      )}

      {activeTab === 'referrals' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-amber-200 bg-white p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <h2 className="font-bold text-gray-900">Referral management</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Refer patients who have separately consented to clinical-record sharing to your assigned PHC/Hospital.
                  Record patient-reported concerns only; do not diagnose or prescribe.
                </p>
                <p className="mt-1 text-xs font-semibold text-amber-900">Referral destination: {hospitalName}</p>
              </div>
            </div>
            {patients.some((patient) => patient.clinicalRecordsConsent) ? (
              <form onSubmit={createReferral} className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold text-gray-700">
                  Patient
                  <select
                    required
                    value={referralPatientId}
                    onChange={(event) => setReferralPatientId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm"
                  >
                    <option value="">Select a consented patient</option>
                    {patients
                      .filter((patient) => patient.clinicalRecordsConsent)
                      .map((patient) => (
                        <option key={patient.id} value={patient.id}>
                          {patient.fullName} · {patient.village}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-gray-700">
                  Patient-reported concern
                  <textarea
                    required
                    maxLength={500}
                    rows={2}
                    value={referralReason}
                    onChange={(event) => setReferralReason(event.target.value)}
                    placeholder="Describe the patient's reported concern; do not add a diagnosis."
                    className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    savingReferral ||
                    !referralPatientId ||
                    !referralReason.trim() ||
                    patients
                      .find((patient) => patient.id === referralPatientId)
                      ?.referrals.some((referral) => ['pending', 'accepted'].includes(referral.status))
                  }
                  className="ad-btn-teal w-fit rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingReferral ? 'Submitting referral…' : 'Refer to hospital'}
                </button>
              </form>
            ) : (
              <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                No patient has enabled clinical-record sharing for ASHA referral support.
              </p>
            )}
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Referral status tracking</h3>
            {referralRows.map((referral) => (
              <article key={referral.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-gray-900">{referral.patientName}</h4>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold capitalize text-amber-900">
                    {referral.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {referral.hospitalName} · {referral.appointmentCode} · {referral.date}
                </p>
                {referral.reason && <p className="mt-2 text-sm text-gray-700">{referral.reason}</p>}
              </article>
            ))}
            {!loading && referralRows.length === 0 && (
              <p className="text-sm text-gray-500">No hospital referrals have been created yet.</p>
            )}
          </div>
        </section>
      )}

      {activeTab === 'inventory' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-start gap-3">
              <Package className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
              <div>
                <h2 className="font-bold text-gray-900">ASHA kit inventory</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Track available kits for field visits. Biopsy referral kits are for referral logistics only; biopsy procedures
                  must be performed by qualified hospital specialists.
                </p>
              </div>
            </div>
            <form onSubmit={saveInventory} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-gray-700">
                Medikit units available
                <input
                  type="number"
                  min={0}
                  max={999}
                  step={1}
                  required
                  value={medikitCount}
                  onChange={(event) => setMedikitCount(Number(event.target.value))}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-semibold text-gray-700">
                Biopsy referral kits available
                <input
                  type="number"
                  min={0}
                  max={999}
                  step={1}
                  required
                  value={biopsyReferralKitCount}
                  onChange={(event) => setBiopsyReferralKitCount(Number(event.target.value))}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={savingInventory}
                className="ad-btn-teal w-fit rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingInventory ? 'Saving inventory…' : 'Save kit inventory'}
              </button>
            </form>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
              <p className="text-sm font-semibold text-teal-900">Medikit</p>
              <p className="mt-1 text-2xl font-bold text-teal-950">{medikitCount}</p>
              <p className="text-xs text-teal-800">Units reported available</p>
            </article>
            <article className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-sm font-semibold text-sky-900">Biopsy referral kits</p>
              <p className="mt-1 text-2xl font-bold text-sky-950">{biopsyReferralKitCount}</p>
              <p className="text-xs text-sky-800">Referral support only; not for performing biopsy</p>
            </article>
          </div>
        </section>
      )}

      {activeTab === 'education' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-teal-200 bg-white p-5">
            <div className="flex items-start gap-3">
              <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
              <div>
                <h2 className="font-bold text-gray-900">Village oral health awareness</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Use these simple messages during community visits. Encourage examination by a qualified clinician for
                  persistent symptoms.
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-2xl border border-gray-200 bg-white p-5">
              <Activity className="h-5 w-5 text-teal-700" />
              <h3 className="mt-3 font-semibold text-gray-900">Proper brushing</h3>
              <p className="mt-2 text-sm text-gray-600">
                Brush gently twice daily with fluoride toothpaste, clean all tooth surfaces and the tongue, and replace a
                worn toothbrush. Avoid sharing toothbrushes.
              </p>
            </article>
            <article className="rounded-2xl border border-gray-200 bg-white p-5">
              <ShieldCheck className="h-5 w-5 text-amber-700" />
              <h3 className="mt-3 font-semibold text-gray-900">Tobacco and gutka risks</h3>
              <p className="mt-2 text-sm text-gray-600">
                Explain that smoking, chewing tobacco, gutka, and areca nut can seriously harm oral health. Encourage
                stopping and seeking support from a qualified health professional.
              </p>
            </article>
            <article className="rounded-2xl border border-gray-200 bg-white p-5">
              <CalendarCheck className="h-5 w-5 text-sky-700" />
              <h3 className="mt-3 font-semibold text-gray-900">Regular checkups</h3>
              <p className="mt-2 text-sm text-gray-600">
                Encourage regular dental checkups and prompt hospital review for a mouth ulcer, patch, lump, pain, or
                swallowing problem that persists or worsens.
              </p>
            </article>
          </div>
        </section>
      )}

      {activeTab === 'followups' && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">Recent follow-ups</h2>
          {followups.map((followup) => (
            <article key={followup.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-gray-900">{followup.patientName}</h3>
                <span className="inline-flex items-center gap-1 text-xs text-gray-500"><CalendarCheck className="h-3.5 w-3.5" />{followup.visitDate}</span>
              </div>
              <p className="mt-2 text-sm text-teal-800">{OUTCOME_LABELS[followup.outcome]}</p>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                {FOLLOWUP_TYPE_LABELS[followup.type || 'visit']}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{followup.notes}</p>
              {followup.followUpDate && (
                <p className={`mt-2 text-xs font-semibold ${followup.followUpDate <= today ? 'text-rose-700' : 'text-gray-500'}`}>
                  Next visit: {followup.followUpDate}
                  {followup.followUpDate <= today ? ' · Due' : ''}
                </p>
              )}
            </article>
          ))}
          {!loading && followups.length === 0 && <p className="text-sm text-gray-500">No follow-ups recorded yet.</p>}
        </section>
      )}
    </div>
  );
}

export const ASHA_NAV_ITEMS = [
  { id: 'overview', label: 'Village Overview', icon: MapPin },
  { id: 'patients', label: 'Patient Records', icon: Users },
  { id: 'screenings', label: 'Oral Screenings', icon: Activity },
  { id: 'referrals', label: 'Referrals', icon: ShieldCheck },
  { id: 'followups', label: 'Follow-up Tracking', icon: CalendarCheck },
  { id: 'inventory', label: 'Medikit & Kits', icon: Package },
  { id: 'education', label: 'Health Awareness', icon: BookOpen },
];
