import { useEffect, useState, type FormEvent } from 'react';
import {
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileSearch,
  ShieldAlert,
  UserCog,
  Users,
  Video,
} from 'lucide-react';
import { apiRequest, authenticatedFileUrl } from '../../utils/api.js';
import type {
  Appointment,
  ConsultationRecord,
  DoctorProfile,
  Hospital,
  PatientAgeCategory,
  PatientProfile,
  ScreeningSession,
} from '../../../../shared/types/index.js';
import { VideoConsultationRoom } from '../VideoConsultationRoom.js';
import { VoiceDictationButton } from '../VoiceDictationButton.js';
import type { WsSignalMessage } from '../../hooks/useWebSocket.js';
import { SignatureCard, getVariantByIndex } from '../ui/SignatureCard.js';
import { getAgeCategoryLabel } from '../../../../shared/utils/ageClassification.js';
import {
  getWorkingStatusDotTone,
  getWorkingStatusLabel,
} from '../../utils/workingStatusLabel.js';

interface DoctorDashboardProps {
  activeTab: string;
  onChangeTab: (tab: string) => void;
  sendWsMessage: (payload: Record<string, unknown>) => void;
  lastSignalMessage: WsSignalMessage | null;
}

interface DoctorAppointmentView extends Appointment {
  patientName: string;
  patientMobile: string;
  patientAge?: number;
  patientGender?: string;
  screeningSummary?: {
    id: string;
    reportCode: string;
    preliminaryRiskCategory?: string;
    reportedOralRegion?: string;
    status: string;
  } | null;
  consultationId: string | null;
}

interface DoctorPatientSummary {
  id: string;
  fullName: string;
  age?: number;
  ageCategory?: PatientAgeCategory;
  gender?: string;
  city?: string;
  mobile: string;
  totalAppointments: number;
  totalScreenings: number;
  latestRiskCategory: string;
  lastAppointmentDate?: string;
}

export function DoctorDashboard({
  activeTab,
  onChangeTab,
  sendWsMessage,
  lastSignalMessage,
}: DoctorDashboardProps) {
  const [doctor, setDoctor] = useState<DoctorProfile | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [appointments, setAppointments] = useState<DoctorAppointmentView[]>([]);
  const [patients, setPatients] = useState<DoctorPatientSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Patient History & Comparison Viewer
  const [selectedPatientHistory, setSelectedPatientHistory] = useState<{
    patient: PatientProfile;
    screenings: ScreeningSession[];
    consultations: ConsultationRecord[];
  } | null>(null);
  const [compareIds, setCompareIds] = useState<[string, string]>(['', '']);

  // Video Consultation Room
  const [activeCallAppointment, setActiveCallAppointment] =
    useState<DoctorAppointmentView | null>(null);

  // In-person / direct clinical note modal
  const [noteTargetApt, setNoteTargetApt] = useState<DoctorAppointmentView | null>(null);
  const [clinicalObservations, setClinicalObservations] = useState('');
  const [consultationNotes, setConsultationNotes] = useState('');
  const [prescription, setPrescription] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [referralRecommended, setReferralRecommended] = useState(false);
  const [referralDetails, setReferralDetails] = useState('');
  const [diagnosticTests, setDiagnosticTests] = useState('In-person examination');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpInstructions, setFollowUpInstructions] = useState('');
  const [savingMsg, setSavingMsg] = useState<string | null>(null);

  const loadDoctorData = async () => {
    setLoading(true);
    try {
      const [profRes, aptRes, patRes] = await Promise.all([
        apiRequest<{ doctor: DoctorProfile; hospital: Hospital }>('/api/doctor/profile'),
        apiRequest<{ appointments: DoctorAppointmentView[] }>('/api/doctor/appointments'),
        apiRequest<{ patients: DoctorPatientSummary[] }>('/api/doctor/patients'),
      ]);
      setDoctor(profRes.doctor);
      setHospital(profRes.hospital);
      setAppointments(aptRes.appointments || []);
      setPatients(patRes.patients || []);
    } catch {
      // handled gracefully
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDoctorData();
  }, []);

  const updateAppointmentStatus = async (
    id: string,
    status: 'accepted' | 'declined' | 'redirected',
    notes?: string,
    redirectedHospitalOrDoctor?: string
  ) => {
    try {
      await apiRequest(`/api/doctor/appointments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          doctorResponseNotes: notes,
          redirectedHospitalOrDoctor,
        }),
      });
      await loadDoctorData();
    } catch {
      // ignore
    }
  };

  const openPatientHistory = async (patientId: string) => {
    try {
      const res = await apiRequest<{
        patient: PatientProfile;
        screenings: ScreeningSession[];
        consultations: ConsultationRecord[];
      }>(`/api/doctor/patients/${patientId}/history`);
      setSelectedPatientHistory(res);
      if (res.screenings.length >= 2) {
        setCompareIds([res.screenings[0].id, res.screenings[1].id]);
      } else if (res.screenings.length === 1) {
        setCompareIds([res.screenings[0].id, '']);
      }
      onChangeTab('patients');
    } catch {
      // ignore
    }
  };

  const resetClinicalForm = () => {
    setClinicalObservations('');
    setConsultationNotes('');
    setPrescription('');
    setRecommendations('');
    setReferralRecommended(false);
    setReferralDetails('');
    setDiagnosticTests('In-person examination');
    setFollowUpDate('');
    setFollowUpInstructions('');
  };

  const openClinicalForm = (appointment: DoctorAppointmentView) => {
    resetClinicalForm();
    setNoteTargetApt(appointment);
  };

  const handleSaveProfileSchedule = async (e: FormEvent) => {
    e.preventDefault();
    if (!doctor) return;
    setSavingMsg(null);
    try {
      const res = await apiRequest<{ doctor: DoctorProfile }>('/api/doctor/profile', {
        method: 'PUT',
        body: JSON.stringify(doctor),
      });
      setDoctor(res.doctor);
      setSavingMsg('Profile and consultation availability saved.');
    } catch (err) {
      setSavingMsg(err instanceof Error ? err.message : 'Unable to save schedule.');
    }
  };

  const handleSaveDirectConsultation = async (e: FormEvent) => {
    e.preventDefault();
    if (!noteTargetApt) return;
    try {
      await apiRequest('/api/doctor/consultations', {
        method: 'POST',
        body: JSON.stringify({
          appointmentId: noteTargetApt.id,
          clinicalObservations,
          consultationNotes,
          prescription,
          recommendations,
          referralRecommended,
          referralDetails,
          diagnosticTestsSuggested: diagnosticTests
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          followUpDate,
          followUpInstructions,
          sharedWithPatient: true,
          markCompleted: true,
        }),
      });
      setNoteTargetApt(null);
      resetClinicalForm();
      await loadDoctorData();
    } catch {
      // ignore
    }
  };

  const pendingApts = appointments.filter((a) => a.status === 'pending');
  const upcomingApts = appointments.filter((a) => a.status === 'accepted');
  const urgentPending = pendingApts.filter((a) => a.type === 'urgent');

  return (
    <div className="space-y-6">
      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <SignatureCard
            variant="teal"
            topRightBadge={doctor?.verificationStatus || 'verified'}
            icon={<UserCog className="w-6 h-6" />}
            pillLabel={`${doctor?.doctorCode || 'DOC'} · Verified Clinician`}
            title={doctor?.fullName || 'Doctor Clinical Dashboard'}
            meta={`${doctor?.qualifications || ''} · ${doctor?.specialization || ''} · ${hospital?.name || ''}`}
            tags={[
              doctor?.onlineConsultationAvailable ? 'Video Enabled' : 'In-Person Only',
              `Fee ₹${doctor?.consultationFee ?? 0}`,
              `Status: ${getWorkingStatusLabel(doctor?.workingStatus || 'available')}`,
            ]}
            metrics={[
              { value: pendingApts.length, label: 'Pending' },
              { value: urgentPending.length, label: 'Urgent' },
              { value: patients.length, label: 'Patients' },
            ]}
            footer={{
              label: 'Availability status',
              value: `Currently ${getWorkingStatusLabel(doctor?.workingStatus || 'available')}`,
              dotTone: getWorkingStatusDotTone(doctor?.workingStatus || 'available'),
              dotBlink: true,
              ctaLabel: 'Manage Schedule',
              onCtaClick: () => onChangeTab('schedule'),
            }}
          />

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <SignatureCard
              variant="teal"
              topRightBadge="Queue"
              icon={<Clock className="w-6 h-6" />}
              pillLabel="Intake Queue"
              title={`${pendingApts.length} Pending`}
              meta="Awaiting specialist review"
              metrics={[
                { value: pendingApts.length, label: 'Pending' },
                { value: upcomingApts.length, label: 'Accepted' },
                { value: appointments.length, label: 'Total' },
              ]}
              footer={{
                label: 'Review requests',
                value: `${pendingApts.length} waiting`,
                ctaLabel: 'Open',
                onCtaClick: () => onChangeTab('appointments'),
              }}
            />

            <SignatureCard
              variant="saffron"
              topRightBadge="Priority"
              icon={<ShieldAlert className="w-6 h-6" />}
              pillLabel="Urgent Triage"
              title={`${urgentPending.length} Urgent`}
              meta="High-priority triage requests"
              metrics={[
                { value: urgentPending.length, label: 'Urgent' },
                { value: pendingApts.length, label: 'Total Pending' },
                { value: '24h', label: 'Target SLA' },
              ]}
              footer={{
                label: 'Urgent attention',
                value: `${urgentPending.length} active urgent`,
                dotTone: urgentPending.length > 0 ? 'rose' : 'emerald',
                ctaLabel: 'Triage',
                onCtaClick: () => onChangeTab('appointments'),
              }}
            />

            <SignatureCard
              variant="navy"
              topRightBadge="Upcoming"
              icon={<Video className="w-6 h-6" />}
              pillLabel="Scheduled Consults"
              title={`${upcomingApts.length} Upcoming`}
              meta="Confirmed video & hospital slots"
              metrics={[
                { value: upcomingApts.length, label: 'Confirmed' },
                { value: upcomingApts.filter((a) => a.mode === 'video').length, label: 'Video' },
                { value: upcomingApts.filter((a) => a.mode !== 'video').length, label: 'OPD' },
              ]}
              footer={{
                label: 'Consult schedule',
                value: `${upcomingApts.length} upcoming slot(s)`,
                ctaLabel: 'View',
                onCtaClick: () => onChangeTab('appointments'),
              }}
            />

            <SignatureCard
              variant="teal"
              topRightBadge="Records"
              icon={<Users className="w-6 h-6" />}
              pillLabel="Patient Panel"
              title={`${patients.length} Patients`}
              meta="Authorized clinical histories"
              metrics={[
                { value: patients.length, label: 'Assigned' },
                { value: patients.reduce((s, p) => s + p.totalScreenings, 0), label: 'Screenings' },
                { value: 'Logged', label: 'RBAC' },
              ]}
              footer={{
                label: 'Authorized panel',
                value: `${patients.length} patient record(s)`,
                ctaLabel: 'Inspect',
                onCtaClick: () => onChangeTab('patients'),
              }}
            />
          </div>

          <SignatureCard
            variant="saffron"
            topRightBadge="Clinical Governance"
            icon={<ShieldAlert className="w-6 h-6" />}
            pillLabel="Clinical Review Safeguard"
            title="Preliminary AI Triage Boundaries & Audit Policy"
            meta="AI observations support specialist review — never a standalone cancer diagnosis"
            tags={['Audit Logged', 'No Auto-Diagnosis', 'Biopsy By Doctor']}
          >
            <p className="text-xs text-gray-700 leading-relaxed">
              AI-generated screening observations are preliminary triage aids only. Do not treat AI
              outputs as a confirmed diagnosis or cancer stage. All patient record views and
              consultation updates are audit-logged.
            </p>
          </SignatureCard>
        </div>
      )}

      {/* APPOINTMENTS & URGENT REQUESTS */}
      {activeTab === 'appointments' && (
        <div className="space-y-6">
          <SignatureCard
            variant="teal"
            topRightBadge={`${appointments.length} Total`}
            icon={<Calendar className="w-6 h-6" />}
            pillLabel="Specialist Queue"
            title="Appointments & Urgent Triage Requests"
            meta="Accept, decline, review authorized patient records, or launch WebRTC video consults"
            metrics={[
              { value: pendingApts.length, label: 'Pending' },
              { value: urgentPending.length, label: 'Urgent' },
              { value: upcomingApts.length, label: 'Upcoming' },
            ]}
          />

          {loading ? (
            <SignatureCard
              variant="navy"
              icon={<Clock className="w-6 h-6" />}
              pillLabel="Loading"
              title="Loading appointments..."
              meta="Fetching specialist requests"
            />
          ) : appointments.length === 0 ? (
            <SignatureCard
              variant="saffron"
              icon={<Calendar className="w-6 h-6" />}
              pillLabel="Empty Queue"
              title="No appointment requests assigned yet"
              meta="New patient bookings and urgent dispatches will appear here automatically."
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {appointments.map((apt, idx) => (
                <SignatureCard
                  key={apt.id}
                  variant={apt.type === 'urgent' ? 'saffron' : getVariantByIndex(idx)}
                  topRightBadge={apt.type === 'urgent' ? 'URGENT' : apt.appointmentCode}
                  icon={apt.mode === 'video' ? <Video className="w-6 h-6" /> : <Calendar className="w-6 h-6" />}
                  pillLabel={`Status: ${apt.status}`}
                  title={apt.patientName}
                  meta={`${apt.patientMobile}${apt.patientAge ? ` · ${apt.patientAge} yrs` : ''} · ${apt.date} at ${apt.timeSlot}`}
                  tags={[
                    apt.appointmentCode,
                    apt.mode === 'video' ? 'Video Consult' : 'In-Person OPD',
                    apt.type === 'urgent' ? 'Urgent Triage' : 'Standard',
                  ]}
                  metrics={[
                    { value: apt.date, label: 'Date' },
                    { value: apt.timeSlot, label: 'Slot' },
                    { value: apt.status, label: 'Status' },
                  ]}
                  footer={{
                    label: 'Patient records',
                    value: apt.screeningSummary
                      ? `${apt.screeningSummary.reportCode} · ${apt.screeningSummary.preliminaryRiskCategory}`
                      : 'Authorize & consult',
                    dotTone: apt.type === 'urgent' ? 'rose' : 'emerald',
                    rightSlot: (
                      <div className="flex flex-wrap items-center gap-1.5 justify-end">
                        <button
                          type="button"
                          onClick={() => void openPatientHistory(apt.patientId)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer"
                        >
                          <FileSearch className="w-3.5 h-3.5" />
                          Records
                        </button>
                        {apt.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                void updateAppointmentStatus(
                                  apt.id,
                                  'accepted',
                                  'Confirmed by specialist.'
                                )
                              }
                              className="ad-btn-teal px-3 py-1.5 text-xs font-semibold text-white rounded-xl cursor-pointer"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void updateAppointmentStatus(
                                  apt.id,
                                  'declined',
                                  'Specialist unavailable for requested slot.'
                                )
                              }
                              className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-xl cursor-pointer"
                            >
                              Decline
                            </button>
                          </>
                        )}
                        {apt.status === 'accepted' && apt.mode === 'video' && (
                          <button
                            type="button"
                            onClick={() => setActiveCallAppointment(apt)}
                            className="ad-btn-teal inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white rounded-xl cursor-pointer"
                          >
                            <Video className="w-3.5 h-3.5" />
                            Video Call
                          </button>
                        )}
                        {apt.status === 'accepted' && (
                          <button
                            type="button"
                            onClick={() => openClinicalForm(apt)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-800 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl cursor-pointer"
                          >
                            <ClipboardCheck className="w-3.5 h-3.5" />
                            Complete
                          </button>
                        )}
                      </div>
                    ),
                  }}
                >
                  <p className="text-xs text-gray-600">
                    <strong className="text-gray-900">Reason:</strong> {apt.reason}
                  </p>
                  {apt.screeningSummary && (
                    <p className="text-xs text-[#0D5C58] font-medium">
                      Linked Screening: {apt.screeningSummary.reportCode} ·{' '}
                      {apt.screeningSummary.preliminaryRiskCategory} (
                      {apt.screeningSummary.reportedOralRegion})
                    </p>
                  )}
                </SignatureCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AUTHORIZED PATIENTS & LONGITUDINAL COMPARISON */}
      {activeTab === 'patients' && (
        <div className="grid lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4">
            <SignatureCard
              variant="navy"
              topRightBadge={`${patients.length} Authorized`}
              icon={<Users className="w-6 h-6" />}
              pillLabel="Patient Panel"
              title="Authorized Patients"
              meta="Only patients with an active appointment or urgent triage relationship appear here."
            >
              {patients.length === 0 ? (
                <p className="text-xs text-gray-500 py-4">No assigned patients yet.</p>
              ) : (
                <div className="space-y-2">
                  {patients.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void openPatientHistory(p.id)}
                      className={`w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
                        selectedPatientHistory?.patient.id === p.id
                          ? 'border-[#0D5C58] bg-[#ECFDF5]'
                          : 'border-gray-200 bg-[#FBFBFA] hover:bg-white'
                      }`}
                    >
                      <p className="text-sm font-bold text-gray-900">{p.fullName}</p>
                      <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                        {getAgeCategoryLabel(p.ageCategory)} · {p.totalScreenings} screening(s) ·{' '}
                        {p.latestRiskCategory}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </SignatureCard>
          </div>

          <div className="lg:col-span-8">
            {!selectedPatientHistory ? (
              <SignatureCard
                variant="teal"
                icon={<FileSearch className="w-6 h-6" />}
                pillLabel="Clinical Inspector"
                title="Select a patient to inspect screening history"
                meta="View questionnaire responses, clinical lesion photographs, AI observations, and longitudinal comparisons."
              />
            ) : (
              <SignatureCard
                variant="teal"
                topRightBadge={`${selectedPatientHistory.screenings.length} Screenings`}
                icon={<FileSearch className="w-6 h-6" />}
                pillLabel="Authorized Clinical Record"
                title={selectedPatientHistory.patient.fullName}
                meta={`Mobile: ${selectedPatientHistory.patient.mobile} · Age: ${
                  selectedPatientHistory.patient.age ?? 'N/A'
                } · Age category: ${getAgeCategoryLabel(
                  selectedPatientHistory.patient.ageCategory
                )} · City: ${selectedPatientHistory.patient.city || 'N/A'}`}
                metrics={[
                  { value: selectedPatientHistory.screenings.length, label: 'Screenings' },
                  { value: selectedPatientHistory.consultations.length, label: 'Consults' },
                  { value: 'Audit Logged', label: 'Access' },
                ]}
              >
                <div className="space-y-6">
                  {/* Longitudinal Comparison Selector (if >= 2 screenings) */}
                  {selectedPatientHistory.screenings.length >= 2 && (
                    <div className="p-4 rounded-2xl bg-[#FBFBFA] border border-gray-200 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-bold text-gray-900">
                          Longitudinal Screening Comparison
                        </h4>
                        <span className="text-[11px] text-[#EA580C] font-medium">
                          Visual changes do not constitute proof of cancer progression or improvement.
                        </span>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {([0, 1] as const).map((slotIdx) => {
                          const chosen = selectedPatientHistory.screenings.find(
                            (s) => s.id === compareIds[slotIdx]
                          );
                          return (
                            <div key={slotIdx} className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
                              <select
                                value={compareIds[slotIdx]}
                                onChange={(e) => {
                                  const next: [string, string] = [...compareIds] as [
                                    string,
                                    string,
                                  ];
                                  next[slotIdx] = e.target.value;
                                  setCompareIds(next);
                                }}
                                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                              >
                                {selectedPatientHistory.screenings.map((sc) => (
                                  <option key={sc.id} value={sc.id}>
                                    {sc.reportCode} ({new Date(sc.createdAt).toLocaleDateString()})
                                  </option>
                                ))}
                              </select>
                              {chosen && (
                                <div className="space-y-1.5 text-xs">
                                  <p className="font-semibold text-gray-900">
                                    {chosen.aiReport?.preliminaryRiskCategory}
                                  </p>
                                  <p className="text-gray-600">
                                    Duration: {chosen.questionnaire.symptomDuration}
                                  </p>
                                  {chosen.images[0] && (
                                    <img
                                      src={authenticatedFileUrl(
                                        `/api/files/screening/${chosen.id}/${chosen.images[0].id}`
                                      )}
                                      alt={chosen.images[0].oralRegion}
                                      className="w-full h-36 object-cover rounded-lg border border-gray-200"
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Full Screening List */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-gray-900">
                      Screening Records ({selectedPatientHistory.screenings.length})
                    </h4>
                    {selectedPatientHistory.screenings.map((sc) => (
                      <div key={sc.id} className="p-4 rounded-2xl border border-gray-200 bg-[#FBFBFA] space-y-3">
                        <div className="flex flex-wrap justify-between text-xs font-mono text-gray-500">
                          <span>
                            {sc.reportCode} · {new Date(sc.createdAt).toLocaleString()}
                          </span>
                          <span className="font-semibold text-gray-900">
                            {sc.aiReport?.preliminaryRiskCategory}
                          </span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3 text-xs text-gray-700">
                          <div>
                            <strong>Tobacco:</strong> {sc.questionnaire.usesTobacco}{' '}
                            {sc.questionnaire.tobaccoTypes.join(', ')}
                          </div>
                          <div>
                            <strong>Alcohol / Betel Nut:</strong> {sc.questionnaire.consumesAlcohol} /{' '}
                            {sc.questionnaire.chewsBetelOrArecaNut}
                          </div>
                        </div>
                        {sc.aiReport && (
                          <div className="text-xs text-gray-700 space-y-1">
                            <p>
                              <strong>AI Observations (Unconfirmed):</strong>{' '}
                              {sc.aiReport.observedVisibleFeatures.join('; ')}
                            </p>
                            <p>{sc.aiReport.riskExplanation}</p>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3">
                          {sc.images.map((img) => (
                            <div key={img.id} className="w-32">
                              <img
                                src={authenticatedFileUrl(
                                  `/api/files/screening/${sc.id}/${img.id}`
                                )}
                                alt={img.oralRegion}
                                className="w-32 h-24 object-cover rounded-xl border border-gray-200"
                              />
                              <p className="text-[11px] text-gray-500 mt-1">{img.oralRegion}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </SignatureCard>
            )}
          </div>
        </div>
      )}

      {/* SCHEDULE & PROFILE */}
      {activeTab === 'schedule' && doctor && (
        <form onSubmit={handleSaveProfileSchedule} className="max-w-4xl">
          <SignatureCard
            variant="teal"
            topRightBadge={doctor.doctorCode}
            icon={<UserCog className="w-6 h-6" />}
            pillLabel="Clinician Availability"
            title="Doctor Profile & Consultation Schedule"
            meta="Configure working status, fees, video consultation availability, and weekly booking slots."
            footer={{
              label: 'Schedule configuration',
              value: `Fee ₹${doctor.consultationFee} · ${getWorkingStatusLabel(
                doctor.workingStatus
              )}`,
              rightSlot: (
                <button
                  type="submit"
                  className="ad-btn-teal px-5 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer"
                >
                  Save Availability &amp; Profile
                </button>
              ),
            }}
          >
            <div className="space-y-5">
              {savingMsg && (
                <div className="p-3 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-xs font-medium text-[#0D5C58] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {savingMsg}
                </div>
              )}

              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Working Status
                  </label>
                  <select
                    value={doctor.workingStatus}
                    onChange={(e) =>
                      setDoctor({
                        ...doctor,
                        workingStatus: e.target.value as DoctorProfile['workingStatus'],
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white"
                  >
                    <option value="available">Available</option>
                    <option value="busy">On Visit</option>
                    <option value="on_leave">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Consultation Fee (₹)
                  </label>
                  <input
                    type="number"
                    value={doctor.consultationFee}
                    onChange={(e) =>
                      setDoctor({ ...doctor, consultationFee: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={doctor.phone}
                    onChange={(e) => setDoctor({ ...doctor, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-6 text-xs font-medium text-gray-800">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={doctor.onlineConsultationAvailable}
                    onChange={(e) =>
                      setDoctor({ ...doctor, onlineConsultationAvailable: e.target.checked })
                    }
                  />
                  Accept Online Video Consultations
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={doctor.inPersonConsultationAvailable}
                    onChange={(e) =>
                      setDoctor({ ...doctor, inPersonConsultationAvailable: e.target.checked })
                    }
                  />
                  Accept In-Person Hospital Visits
                </label>
              </div>

              <div>
                <h4 className="text-sm font-bold text-gray-900 mb-3">Weekly Time Slots</h4>
                <div className="space-y-2">
                  {doctor.schedule.map((slot, idx) => (
                    <div
                      key={slot.day}
                      className="grid grid-cols-12 gap-3 items-center p-3 rounded-xl border border-gray-200 bg-[#FBFBFA] text-xs"
                    >
                      <label className="col-span-3 flex items-center gap-2 font-semibold text-gray-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={slot.enabled}
                          onChange={(e) => {
                            const next = [...doctor.schedule];
                            next[idx] = { ...slot, enabled: e.target.checked };
                            setDoctor({ ...doctor, schedule: next });
                          }}
                        />
                        {slot.day}
                      </label>
                      <div className="col-span-3">
                        <input
                          type="time"
                          value={slot.startTime}
                          disabled={!slot.enabled}
                          onChange={(e) => {
                            const next = [...doctor.schedule];
                            next[idx] = { ...slot, startTime: e.target.value };
                            setDoctor({ ...doctor, schedule: next });
                          }}
                          className="w-full px-2 py-1 border border-gray-200 rounded-lg font-mono bg-white"
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          type="time"
                          value={slot.endTime}
                          disabled={!slot.enabled}
                          onChange={(e) => {
                            const next = [...doctor.schedule];
                            next[idx] = { ...slot, endTime: e.target.value };
                            setDoctor({ ...doctor, schedule: next });
                          }}
                          className="w-full px-2 py-1 border border-gray-200 rounded-lg font-mono bg-white"
                        />
                      </div>
                      <div className="col-span-3">
                        <select
                          value={slot.slotDurationMinutes}
                          disabled={!slot.enabled}
                          onChange={(e) => {
                            const next = [...doctor.schedule];
                            next[idx] = { ...slot, slotDurationMinutes: Number(e.target.value) };
                            setDoctor({ ...doctor, schedule: next });
                          }}
                          className="w-full px-2 py-1 border border-gray-200 rounded-lg bg-white"
                        >
                          <option value={15}>15 min</option>
                          <option value={30}>30 min</option>
                          <option value={45}>45 min</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SignatureCard>
        </form>
      )}

      {/* IN-PERSON / DIRECT CONSULTATION NOTES MODAL */}
      {noteTargetApt && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveDirectConsultation}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-3 shadow-xl"
          >
            <h3 className="text-base font-bold text-slate-900">
              Clinical Consultation Notes — {noteTargetApt.patientName}
            </h3>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700">
                  Clinical Observations
                </label>
                <VoiceDictationButton
                  contextHint="Doctor clinical oral examination observations"
                  onTranscript={(text) =>
                    setClinicalObservations((prev) => (prev ? `${prev} ${text}` : text))
                  }
                />
              </div>
              <textarea
                rows={2}
                required
                value={clinicalObservations}
                onChange={(e) => setClinicalObservations(e.target.value)}
                placeholder="Clinical observations..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <textarea
              rows={2}
              required
              value={consultationNotes}
              onChange={(e) => setConsultationNotes(e.target.value)}
              placeholder="Consultation summary notes..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <textarea
              rows={2}
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              placeholder="Recommendations & follow-up advice..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <textarea
              rows={2}
              value={prescription}
              onChange={(e) => setPrescription(e.target.value)}
              placeholder="Treatment prescription / medication plan..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              value={diagnosticTests}
              onChange={(e) => setDiagnosticTests(e.target.value)}
              placeholder="Suggested tests (comma-separated)..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={referralRecommended}
                onChange={(e) => setReferralRecommended(e.target.checked)}
              />
              Recommend Biopsy or Specialist Referral
            </label>
            {referralRecommended && (
              <input
                type="text"
                value={referralDetails}
                onChange={(e) => setReferralDetails(e.target.value)}
                placeholder="Referral details..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                value={followUpInstructions}
                onChange={(e) => setFollowUpInstructions(e.target.value)}
                placeholder="Follow-up instructions..."
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setNoteTargetApt(null);
                  resetClinicalForm();
                }}
                className="px-4 py-2 text-xs font-semibold border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg cursor-pointer"
              >
                Save &amp; Mark Completed
              </button>
            </div>
          </form>
        </div>
      )}

      {/* VIDEO CONSULTATION ROOM */}
      {activeCallAppointment && (
        <VideoConsultationRoom
          appointmentId={activeCallAppointment.id}
          appointmentCode={activeCallAppointment.appointmentCode}
          patientName={activeCallAppointment.patientName}
          doctorName={doctor?.fullName || 'Doctor'}
          userRole="doctor"
          userName={doctor?.fullName || 'Doctor'}
          sendWsMessage={sendWsMessage}
          lastSignalMessage={lastSignalMessage}
          onClose={() => setActiveCallAppointment(null)}
          onConsultationSaved={() => void loadDoctorData()}
        />
      )}
    </div>
  );
}

export const DOCTOR_NAV_ITEMS = [
  { id: 'overview', label: 'Clinical Overview', icon: Clock },
  { id: 'appointments', label: 'Appointments & Triage', icon: Calendar },
  { id: 'patients', label: 'Authorized Patients', icon: Users },
  { id: 'schedule', label: 'Profile & Schedule', icon: UserCog },
];
