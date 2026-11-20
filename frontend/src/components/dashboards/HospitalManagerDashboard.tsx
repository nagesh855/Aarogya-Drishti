import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  FileCheck2,
  MapPin,
  Plus,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { apiRequest, authenticatedFileUrl } from '../../utils/api.js';
import type { AshaWorker, DoctorProfile, Hospital } from '../../../../shared/types/index.js';
import type { WsSignalMessage } from '../../hooks/useWebSocket.js';
import { getWorkingStatusLabel } from '../../utils/workingStatusLabel.js';
import { SignatureCard, getVariantByIndex } from '../ui/SignatureCard.js';

interface ManagerOverviewStats {
  totalDoctors: number;
  verifiedDoctors: number;
  pendingVerificationDoctors: number;
  patientCount: number;
  totalAppointments: number;
  pendingRequests: number;
  upcomingAppointments: number;
  completedConsultations: number;
  urgentRequests: number;
}

interface ManagerAppointmentRow {
  id: string;
  appointmentCode: string;
  type: 'normal' | 'urgent';
  mode: string;
  date: string;
  timeSlot: string;
  status: string;
  patientName: string;
  doctorId?: string;
  doctorName: string;
  reason: string;
}

interface HospitalManagerDashboardProps {
  activeTab: string;
  onChangeTab: (tab: string) => void;
  lastSignalMessage: WsSignalMessage | null;
}

export function HospitalManagerDashboard({
  activeTab,
  onChangeTab,
  lastSignalMessage,
}: HospitalManagerDashboardProps) {
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [stats, setStats] = useState<ManagerOverviewStats | null>(null);
  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [appointments, setAppointments] = useState<ManagerAppointmentRow[]>([]);
  const [ashaWorkers, setAshaWorkers] = useState<Array<AshaWorker & { identifier: string }>>([]);
  const [ashaRequests, setAshaRequests] = useState<
    Array<{
      id: string;
      village: string;
      mandal: string;
      status: 'pending' | 'assigned';
      assignedWorkerId?: string;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  const [hospitalSaveMsg, setHospitalSaveMsg] = useState<string | null>(null);
  const [showAddDoctor, setShowAddDoctor] = useState(false);
  const [newDocForm, setNewDocForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    qualifications: '',
    registrationNumber: '',
    specialization: 'Oral Medicine & Radiology',
    yearsOfExperience: 5,
    consultationFee: 600,
    previousHospitals: '',
    previousWorkDetails: '',
    achievements: '',
    areasOfExpertise: '',
  });
  const [generatedCreds, setGeneratedCreds] = useState<{
    doctorCode: string;
    initialPassword: string;
    note: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAddAsha, setShowAddAsha] = useState(false);
  const [newAshaForm, setNewAshaForm] = useState({
    fullName: '',
    phone: '',
    village: '',
    mandal: '',
    address: '',
  });
  const [ashaCredentials, setAshaCredentials] = useState<{
    identifier: string;
    initialPassword: string;
    note: string;
  } | null>(null);
  const [ashaVillageDrafts, setAshaVillageDrafts] = useState<Record<string, string>>({});
  const [ashaMandalDrafts, setAshaMandalDrafts] = useState<Record<string, string>>({});
  const [ashaRequestWorkerDrafts, setAshaRequestWorkerDrafts] = useState<Record<string, string>>({});
  const [assigningAshaRequestId, setAssigningAshaRequestId] = useState<string | null>(null);
  const [rejectingAshaId, setRejectingAshaId] = useState<string | null>(null);
  const [ashaRejectionReason, setAshaRejectionReason] = useState('');

  const loadManagerData = async () => {
    setLoading(true);
    try {
      const [ovRes, docRes, aptRes, ashaRes, ashaRequestRes] = await Promise.all([
        apiRequest<{ hospital: Hospital; stats: ManagerOverviewStats }>('/api/manager/overview'),
        apiRequest<{ doctors: DoctorProfile[] }>('/api/manager/doctors'),
        apiRequest<{ appointments: ManagerAppointmentRow[] }>('/api/manager/appointments'),
        apiRequest<{ ashaWorkers: Array<AshaWorker & { identifier: string }> }>('/api/manager/asha-workers'),
        apiRequest<{
          requests: Array<{
            id: string;
            village: string;
            mandal: string;
            status: 'pending' | 'assigned';
            assignedWorkerId?: string;
            createdAt: string;
            updatedAt: string;
          }>;
        }>('/api/manager/asha-requests'),
      ]);
      setHospital(ovRes.hospital);
      setStats(ovRes.stats);
      setDoctors(docRes.doctors || []);
      setAppointments(aptRes.appointments || []);
      setAshaWorkers(ashaRes.ashaWorkers || []);
      setAshaRequests(ashaRequestRes.requests || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadManagerData();
  }, []);

  useEffect(() => {
    if (lastSignalMessage?.type === 'asha-update') void loadManagerData();
  }, [lastSignalMessage]);

  const handleSaveHospital = async (e: FormEvent) => {
    e.preventDefault();
    if (!hospital) return;
    setHospitalSaveMsg(null);
    try {
      const res = await apiRequest<{ hospital: Hospital }>('/api/manager/hospital', {
        method: 'PUT',
        body: JSON.stringify(hospital),
      });
      setHospital(res.hospital);
      setHospitalSaveMsg('Hospital profile updated successfully.');
    } catch (err) {
      setHospitalSaveMsg(err instanceof Error ? err.message : 'Unable to save hospital.');
    }
  };

  const handleAddDoctor = async (e: FormEvent) => {
    e.preventDefault();
    setActionError(null);
    try {
      const res = await apiRequest<{
        doctor: DoctorProfile;
        credentials: { doctorCode: string; initialPassword: string; note: string };
      }>('/api/manager/doctors', {
        method: 'POST',
        body: JSON.stringify({
          ...newDocForm,
          areasOfExpertise: newDocForm.areasOfExpertise
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setGeneratedCreds(res.credentials);
      setShowAddDoctor(false);
      setNewDocForm({
        fullName: '',
        phone: '',
        email: '',
        qualifications: '',
        registrationNumber: '',
        specialization: 'Oral Medicine & Radiology',
        yearsOfExperience: 5,
        consultationFee: 600,
        previousHospitals: '',
        previousWorkDetails: '',
        achievements: '',
        areasOfExpertise: '',
      });
      await loadManagerData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to add doctor.');
    }
  };

  const handleVerifyDoctor = async (
    doctorId: string,
    verificationStatus: 'verified' | 'rejected'
  ) => {
    try {
      await apiRequest(`/api/manager/doctors/${doctorId}`, {
        method: 'PUT',
        body: JSON.stringify({
          verificationStatus,
          verificationNotes:
            verificationStatus === 'verified'
              ? 'Documents and registration number verified by Hospital Manager.'
              : 'Verification rejected — please re-upload valid registration proof.',
        }),
      });
      await loadManagerData();
    } catch {
      // ignore
    }
  };

  const handleUploadDoctorDoc = async (
    doctorId: string,
    e: ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('document', file);
    formData.append('label', file.name.replace(/\.[^.]+$/, ''));
    try {
      await apiRequest(`/api/manager/doctors/${doctorId}/documents`, {
        method: 'POST',
        body: formData,
      });
      await loadManagerData();
    } catch {
      // ignore
    }
    e.target.value = '';
  };

  const handleAssignUrgentDoctor = async (appointmentId: string, doctorId: string) => {
    if (!doctorId) return;
    try {
      await apiRequest(`/api/manager/appointments/${appointmentId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ doctorId }),
      });
      await loadManagerData();
    } catch {
      // ignore
    }
  };

  const handleAddAsha = async (event: FormEvent) => {
    event.preventDefault();
    setActionError(null);
    try {
      const result = await apiRequest<{
        credentials: { identifier: string; initialPassword: string; note: string };
      }>('/api/manager/asha-workers', {
        method: 'POST',
        body: JSON.stringify(newAshaForm),
      });
      setAshaCredentials(result.credentials);
      setNewAshaForm({ fullName: '', phone: '', village: '', mandal: '', address: '' });
      setShowAddAsha(false);
      await loadManagerData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to add ASHA Worker.');
    }
  };

  const handleToggleAsha = async (worker: AshaWorker, active: boolean) => {
    setActionError(null);
    try {
      await apiRequest(`/api/manager/asha-workers/${worker.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      await loadManagerData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update ASHA Worker.');
    }
  };

  const handleReviewAsha = async (
    worker: AshaWorker,
    decision: 'approved' | 'rejected',
    rejectionReason?: string
  ) => {
    setActionError(null);
    try {
      await apiRequest(`/api/manager/asha-workers/${worker.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ decision, rejectionReason }),
      });
      setRejectingAshaId(null);
      setAshaRejectionReason('');
      await loadManagerData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to review ASHA registration.');
    }
  };

  const handleAssignAshaRequest = async (requestId: string, workerId: string) => {
    if (!workerId) return;
    setActionError(null);
    try {
      await apiRequest(`/api/manager/asha-requests/${requestId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ workerId }),
      });
      await loadManagerData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to assign ASHA Worker request.');
    }
  };

  const handleMoveAndAssignAshaRequest = async (
    requestId: string,
    workerId: string,
    village: string,
    mandal: string
  ) => {
    const worker = ashaWorkers.find(
      (item) =>
        item.id === workerId &&
        item.active &&
        (item.verificationStatus === 'approved' || !item.verificationStatus)
    );
    if (!worker) {
      setActionError('Choose an approved, active ASHA Worker from your hospital.');
      return;
    }

    setActionError(null);
    setAssigningAshaRequestId(requestId);
    try {
      await apiRequest(`/api/manager/asha-workers/${worker.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ village, mandal }),
      });
      await apiRequest(`/api/manager/asha-requests/${requestId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ workerId: worker.id }),
      });
      await loadManagerData();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to update the worker location and assign this request.'
      );
      await loadManagerData();
    } finally {
      setAssigningAshaRequestId(null);
    }
  };

  const handleAssignAshaLocation = async (worker: AshaWorker) => {
    const village = (ashaVillageDrafts[worker.id] ?? worker.village).trim();
    const mandal = (ashaMandalDrafts[worker.id] ?? worker.mandal ?? '').trim();
    if (!village || !mandal || (village === worker.village && mandal === (worker.mandal || ''))) {
      return;
    }
    setActionError(null);
    try {
      await apiRequest(`/api/manager/asha-workers/${worker.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ village, mandal }),
      });
      setAshaVillageDrafts((drafts) => ({ ...drafts, [worker.id]: village }));
      setAshaMandalDrafts((drafts) => ({ ...drafts, [worker.id]: mandal }));
      await loadManagerData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update village/mandal assignment.');
    }
  };

  return (
    <div className="space-y-6">
      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <SignatureCard
            variant="teal"
            topRightBadge={hospital?.hospitalCode || 'HOSP'}
            icon={<Building2 className="w-6 h-6" />}
            pillLabel={`Reg ${hospital?.registrationNumber || 'Active'}`}
            title={hospital?.name || 'Hospital Operations'}
            meta={`${hospital?.address || ''}, ${hospital?.city || ''}, ${hospital?.state || ''}`}
            metrics={[
              { value: stats?.totalDoctors ?? 0, label: 'Doctors' },
              { value: stats?.patientCount ?? 0, label: 'Patients' },
              { value: stats?.urgentRequests ?? 0, label: 'Urgent Queue' },
            ]}
            footer={{
              label: 'Clinician onboarding',
              value: `${stats?.verifiedDoctors ?? 0} verified doctors active`,
              ctaLabel: 'Onboard Doctor',
              onCtaClick: () => {
                setShowAddDoctor(true);
                onChangeTab('doctors');
              },
            }}
          />

          {stats && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <SignatureCard
                variant="teal"
                topRightBadge="Staff"
                icon={<Users className="w-6 h-6" />}
                pillLabel="Hospital Doctors"
                title={`${stats.totalDoctors} Doctors`}
                meta={`${stats.verifiedDoctors} verified · ${stats.pendingVerificationDoctors} pending`}
                footer={{
                  label: 'Credential check',
                  value: `${stats.pendingVerificationDoctors} pending`,
                  ctaLabel: 'Manage',
                  onCtaClick: () => onChangeTab('doctors'),
                }}
              />
              <SignatureCard
                variant="navy"
                topRightBadge="Registry"
                icon={<Building2 className="w-6 h-6" />}
                pillLabel="Hospital Patients"
                title={`${stats.patientCount} Patients`}
                meta="Patients served by facility"
                footer={{
                  label: 'Appointments',
                  value: `${stats.totalAppointments} total bookings`,
                  ctaLabel: 'View',
                  onCtaClick: () => onChangeTab('appointments'),
                }}
              />
              <SignatureCard
                variant="teal"
                topRightBadge="Slots"
                icon={<Calendar className="w-6 h-6" />}
                pillLabel="Upcoming / Pending"
                title={`${stats.upcomingAppointments} / ${stats.pendingRequests}`}
                meta={`${stats.completedConsultations} completed consults`}
                footer={{
                  label: 'Booking flow',
                  value: `${stats.upcomingAppointments} confirmed`,
                  ctaLabel: 'Schedule',
                  onCtaClick: () => onChangeTab('appointments'),
                }}
              />
              <SignatureCard
                variant="saffron"
                topRightBadge="Urgent"
                icon={<ShieldCheck className="w-6 h-6" />}
                pillLabel="Urgent Dispatch"
                title={`${stats.urgentRequests} Urgent`}
                meta="Pending hospital assignment"
                footer={{
                  label: 'Priority dispatch',
                  value: `${stats.urgentRequests} awaiting assign`,
                  dotTone: stats.urgentRequests > 0 ? 'rose' : 'emerald',
                  ctaLabel: 'Assign',
                  onCtaClick: () => onChangeTab('appointments'),
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* DOCTORS & VERIFICATION */}
      {activeTab === 'doctors' && (
        <div className="space-y-6">
          <SignatureCard
            variant="teal"
            topRightBadge={`${doctors.length} Doctors`}
            icon={<Users className="w-6 h-6" />}
            pillLabel="Credential Verification"
            title="Doctor Management & Verification"
            meta={`Manage doctors linked exclusively to ${hospital?.name || 'your hospital'}.`}
            footer={{
              label: 'Onboarding',
              value: 'Issue Doctor ID & verify proof',
              ctaLabel: showAddDoctor ? 'Close Form' : 'Add Doctor',
              onCtaClick: () => setShowAddDoctor((v) => !v),
            }}
          />

          {generatedCreds && (
            <SignatureCard
              variant="navy"
              topRightBadge={generatedCreds.doctorCode}
              icon={<CheckCircle2 className="w-6 h-6" />}
              pillLabel="Credentials Issued"
              title="Doctor Account Created — Save Credentials Securely"
              meta={generatedCreds.note}
            >
              <p className="text-xs font-mono text-[#0D5C58] bg-[#ECFDF5] p-3 rounded-xl border border-emerald-200">
                Doctor ID: <strong>{generatedCreds.doctorCode}</strong> · Initial Password:{' '}
                <strong>{generatedCreds.initialPassword}</strong>
              </p>
            </SignatureCard>
          )}

          {showAddDoctor && (
            <form onSubmit={handleAddDoctor}>
              <SignatureCard
                variant="saffron"
                topRightBadge="New Onboarding"
                icon={<UserPlus className="w-6 h-6" />}
                pillLabel="Clinician Registration"
                title="New Doctor Onboarding"
                meta="Provision credentials and initial verification profile"
                footer={{
                  label: 'Auto-credentials',
                  value: 'Generates DOC-ID & temp password',
                  dotTone: 'amber',
                  rightSlot: (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddDoctor(false)}
                        className="px-4 py-2 text-xs font-semibold bg-white border border-gray-200 rounded-xl cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="ad-btn-teal px-5 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer"
                      >
                        Create Doctor
                      </button>
                    </div>
                  ),
                }}
              >
                <div className="space-y-4">
                  {actionError && (
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                      {actionError}
                    </div>
                  )}
                  <div className="grid sm:grid-cols-3 gap-4">
                    <input
                      required
                      placeholder="Full Name (e.g. Dr. Kavya Rao)"
                      value={newDocForm.fullName}
                      onChange={(e) => setNewDocForm({ ...newDocForm, fullName: e.target.value })}
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                    <input
                      required
                      placeholder="Phone Number"
                      value={newDocForm.phone}
                      onChange={(e) => setNewDocForm({ ...newDocForm, phone: e.target.value })}
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                    <input
                      required
                      type="email"
                      placeholder="Email Address"
                      value={newDocForm.email}
                      onChange={(e) => setNewDocForm({ ...newDocForm, email: e.target.value })}
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                    <input
                      required
                      placeholder="Qualifications (e.g. BDS, MDS)"
                      value={newDocForm.qualifications}
                      onChange={(e) =>
                        setNewDocForm({ ...newDocForm, qualifications: e.target.value })
                      }
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                    <input
                      required
                      placeholder="Medical Registration Number"
                      value={newDocForm.registrationNumber}
                      onChange={(e) =>
                        setNewDocForm({ ...newDocForm, registrationNumber: e.target.value })
                      }
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                    <input
                      required
                      placeholder="Specialization"
                      value={newDocForm.specialization}
                      onChange={(e) =>
                        setNewDocForm({ ...newDocForm, specialization: e.target.value })
                      }
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                    <input
                      type="number"
                      placeholder="Years of Experience"
                      value={newDocForm.yearsOfExperience}
                      onChange={(e) =>
                        setNewDocForm({ ...newDocForm, yearsOfExperience: Number(e.target.value) })
                      }
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                    <input
                      type="number"
                      placeholder="Consultation Fee (₹)"
                      value={newDocForm.consultationFee}
                      onChange={(e) =>
                        setNewDocForm({ ...newDocForm, consultationFee: Number(e.target.value) })
                      }
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                    <input
                      placeholder="Areas of Expertise (comma-separated)"
                      value={newDocForm.areasOfExpertise}
                      onChange={(e) =>
                        setNewDocForm({ ...newDocForm, areasOfExpertise: e.target.value })
                      }
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <input
                      placeholder="Previous Hospitals / Clinics"
                      value={newDocForm.previousHospitals}
                      onChange={(e) =>
                        setNewDocForm({ ...newDocForm, previousHospitals: e.target.value })
                      }
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                    <input
                      placeholder="Professional Achievements"
                      value={newDocForm.achievements}
                      onChange={(e) =>
                        setNewDocForm({ ...newDocForm, achievements: e.target.value })
                      }
                      className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                    />
                  </div>
                </div>
              </SignatureCard>
            </form>
          )}

          {loading ? (
            <SignatureCard
              variant="teal"
              icon={<Users className="w-6 h-6" />}
              pillLabel="Loading"
              title="Loading doctors..."
              meta="Retrieving clinician roster"
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {doctors.map((doc, idx) => (
                <SignatureCard
                  key={doc.id}
                  variant={getVariantByIndex(idx)}
                  topRightBadge={doc.verificationStatus.toUpperCase()}
                  icon={<ShieldCheck className="w-6 h-6" />}
                  pillLabel={doc.doctorCode}
                  title={doc.fullName}
                  meta={`${doc.qualifications} · ${doc.specialization} · Reg: ${doc.registrationNumber}`}
                  tags={[`${doc.yearsOfExperience} yrs exp`, `Fee ₹${doc.consultationFee}`, doc.email]}
                  metrics={[
                    { value: doc.yearsOfExperience, label: 'Yrs Exp' },
                    { value: `₹${doc.consultationFee}`, label: 'Fee' },
                    { value: doc.documents.length, label: 'Proof Docs' },
                  ]}
                  footer={{
                    label: 'Credential status',
                    value: `${doc.verificationStatus} · ${doc.phone}`,
                    dotTone: doc.verificationStatus === 'verified' ? 'emerald' : 'amber',
                    rightSlot: (
                      <div className="flex flex-wrap items-center gap-1.5 justify-end">
                        <label className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          Proof
                          <input
                            type="file"
                            accept=".pdf,image/jpeg,image/png,image/webp"
                            onChange={(e) => void handleUploadDoctorDoc(doc.id, e)}
                            className="hidden"
                          />
                        </label>
                        {doc.verificationStatus !== 'verified' && (
                          <button
                            type="button"
                            onClick={() => void handleVerifyDoctor(doc.id, 'verified')}
                            className="ad-btn-teal inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white rounded-xl cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Approve
                          </button>
                        )}
                        {doc.verificationStatus === 'pending' && (
                          <button
                            type="button"
                            onClick={() => void handleVerifyDoctor(doc.id, 'rejected')}
                            className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white border border-rose-200 rounded-xl cursor-pointer"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    ),
                  }}
                >
                  {doc.documents.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {doc.documents.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FBFBFA] border border-gray-200"
                        >
                          <FileCheck2 className="w-3.5 h-3.5 text-[#0D5C58]" />
                          <span>{d.label}</span>
                          {d.filePath ? (
                            <a
                              href={authenticatedFileUrl(`/api/files/doctor-doc/${doc.id}/${d.id}`)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#0D5C58] font-semibold hover:underline"
                            >
                              View
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </SignatureCard>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'asha' && (
        <div className="space-y-6">
          <SignatureCard
            variant="teal"
            topRightBadge={`${ashaWorkers.length} Workers`}
            icon={<MapPin className="w-6 h-6" />}
            pillLabel="Village health team"
            title="ASHA Worker Management"
            meta="Review self-registrations, approve verified workers, and assign consented patient requests by village and mandal."
            footer={{
              label: 'Worker onboarding',
              value: 'Village-scoped access',
              ctaLabel: showAddAsha ? 'Close Form' : 'Add ASHA Worker',
              onCtaClick: () => setShowAddAsha((visible) => !visible),
            }}
          />

          {actionError && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {actionError}
            </div>
          )}

          {ashaCredentials && (
            <SignatureCard
              variant="navy"
              topRightBadge={ashaCredentials.identifier}
              icon={<CheckCircle2 className="w-6 h-6" />}
              pillLabel="Credentials issued"
              title="ASHA Worker account created — share credentials securely"
              meta={ashaCredentials.note}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <p className="text-[10px] font-bold uppercase text-gray-500">Worker ID</p>
                  <p className="font-mono font-bold text-gray-900">{ashaCredentials.identifier}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <p className="text-[10px] font-bold uppercase text-gray-500">Initial password</p>
                  <p className="font-mono font-bold text-gray-900">{ashaCredentials.initialPassword}</p>
                </div>
              </div>
            </SignatureCard>
          )}

          {showAddAsha && (
            <form onSubmit={handleAddAsha} className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 sm:grid-cols-2">
              <label className="text-xs font-semibold text-gray-700">
                ASHA Worker name
                <input required maxLength={120} value={newAshaForm.fullName} onChange={(event) => setNewAshaForm({ ...newAshaForm, fullName: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-gray-700">
                Mobile number
                <input required maxLength={25} type="tel" value={newAshaForm.phone} onChange={(event) => setNewAshaForm({ ...newAshaForm, phone: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-gray-700 sm:col-span-2">
                Assigned village
                <input required maxLength={100} value={newAshaForm.village} onChange={(event) => setNewAshaForm({ ...newAshaForm, village: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-gray-700">
                Mandal
                <input required maxLength={100} value={newAshaForm.mandal} onChange={(event) => setNewAshaForm({ ...newAshaForm, mandal: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-gray-700">
                Address
                <input required maxLength={300} value={newAshaForm.address} onChange={(event) => setNewAshaForm({ ...newAshaForm, address: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <div className="sm:col-span-2">
                <button type="submit" className="ad-btn-teal rounded-xl px-5 py-2.5 text-sm font-semibold text-white">Create account</button>
              </div>
            </form>
          )}

          {ashaWorkers.some((worker) => worker.verificationStatus === 'pending') && (
            <section className="space-y-3">
              <h3 className="font-display text-lg font-bold text-slate-900">Pending ASHA registrations</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {ashaWorkers
                  .filter((worker) => worker.verificationStatus === 'pending')
                  .map((worker) => (
                    <div key={worker.id} className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{worker.fullName}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            Official ASHA ID: <span className="font-mono font-semibold">{worker.officialId || worker.identifier}</span>
                          </p>
                          <p className="text-xs text-slate-600">{worker.phone} · {worker.village}, {worker.mandal}</p>
                          <p className="mt-1 text-xs text-slate-500">{worker.address}</p>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">Pending review</span>
                      </div>
                      {rejectingAshaId === worker.id ? (
                        <div className="mt-4 space-y-2">
                          <label className="block text-xs font-semibold text-slate-700">
                            Reason for rejection
                            <textarea
                              required
                              minLength={3}
                              maxLength={300}
                              rows={2}
                              value={ashaRejectionReason}
                              onChange={(event) => setAshaRejectionReason(event.target.value)}
                              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                            />
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={ashaRejectionReason.trim().length < 3}
                              onClick={() => void handleReviewAsha(worker, 'rejected', ashaRejectionReason)}
                              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              Confirm rejection
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingAshaId(null);
                                setAshaRejectionReason('');
                              }}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleReviewAsha(worker, 'approved')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingAshaId(worker.id);
                              setAshaRejectionReason('');
                            }}
                            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h3 className="font-display text-lg font-bold text-slate-900">Patient ASHA requests</h3>
            {ashaRequests.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
                No open or assigned ASHA requests.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {ashaRequests.map((request) => {
                  const matchingWorkers = ashaWorkers.filter(
                    (worker) =>
                      worker.active &&
                      (worker.verificationStatus === 'approved' || !worker.verificationStatus) &&
                      worker.village.trim().toLocaleLowerCase() === request.village.trim().toLocaleLowerCase() &&
                      (worker.mandal || '').trim().toLocaleLowerCase() === request.mandal.trim().toLocaleLowerCase()
                  );
                  const assignableWorkers = ashaWorkers.filter(
                    (worker) =>
                      worker.active &&
                      (worker.verificationStatus === 'approved' || !worker.verificationStatus)
                  );
                  const assignedWorker = ashaWorkers.find(
                    (worker) => worker.id === request.assignedWorkerId
                  );
                  const selectedWorkerId =
                    ashaRequestWorkerDrafts[request.id] || matchingWorkers[0]?.id || '';
                  return (
                    <div key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">Request · {request.village}, {request.mandal}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Submitted {new Date(request.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          request.status === 'assigned'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {request.status === 'assigned' ? 'Assigned' : 'Needs assignment'}
                        </span>
                      </div>
                      {request.status === 'assigned' ? (
                        <p className="mt-3 text-xs text-slate-700">
                          Assigned to {assignedWorker?.fullName || 'ASHA Worker'}.
                        </p>
                      ) : matchingWorkers.length === 0 ? (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs text-amber-800">
                            No approved active worker is currently assigned to this village and mandal.
                          </p>
                          {assignableWorkers.length > 0 ? (
                            <>
                              <label className="block text-xs font-medium text-slate-700">
                                Select a worker to assign to {request.village}, {request.mandal}
                                <select
                                  aria-label={`ASHA Worker to relocate for ${request.village}, ${request.mandal}`}
                                  value={ashaRequestWorkerDrafts[request.id] || ''}
                                  onChange={(event) =>
                                    setAshaRequestWorkerDrafts((drafts) => ({
                                      ...drafts,
                                      [request.id]: event.target.value,
                                    }))
                                  }
                                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-xs"
                                >
                                  <option value="">Choose an approved active worker</option>
                                  {assignableWorkers.map((worker) => (
                                    <option key={worker.id} value={worker.id}>
                                      {worker.fullName} · {worker.village}, {worker.mandal}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <p className="text-[11px] text-slate-500">
                                Assigning will update the worker's village and mandal to match this request.
                              </p>
                              <button
                                type="button"
                                disabled={
                                  !ashaRequestWorkerDrafts[request.id] ||
                                  assigningAshaRequestId === request.id
                                }
                                onClick={() =>
                                  void handleMoveAndAssignAshaRequest(
                                    request.id,
                                    ashaRequestWorkerDrafts[request.id] || '',
                                    request.village,
                                    request.mandal
                                  )
                                }
                                className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {assigningAshaRequestId === request.id
                                  ? 'Updating & assigning…'
                                  : 'Update location & assign'}
                              </button>
                            </>
                          ) : (
                            <p className="text-xs text-slate-600">
                              Approve and activate an ASHA Worker before assigning this request.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`ASHA Worker for ${request.village}, ${request.mandal}`}
                            value={selectedWorkerId}
                            onChange={(event) =>
                              setAshaRequestWorkerDrafts((drafts) => ({
                                ...drafts,
                                [request.id]: event.target.value,
                              }))
                            }
                            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2.5 py-2 text-xs"
                          >
                            {matchingWorkers.map((worker) => (
                              <option key={worker.id} value={worker.id}>
                                {worker.fullName} · {worker.identifier}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleAssignAshaRequest(request.id, selectedWorkerId)}
                            className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white"
                          >
                            Assign
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {ashaWorkers.filter(
            (worker) => worker.verificationStatus !== 'pending' && worker.verificationStatus !== 'rejected'
          ).length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              No approved or previously reviewed ASHA workers yet.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {ashaWorkers
                .filter(
                  (worker) =>
                    worker.verificationStatus !== 'pending' &&
                    worker.verificationStatus !== 'rejected'
                )
                .map((worker) => (
                <SignatureCard
                  key={worker.id}
                  variant={worker.active ? 'teal' : 'navy'}
                  topRightBadge={
                    !worker.active
                      ? 'Inactive'
                      : worker.dutyStatus === 'on_field'
                      ? 'Approved · On field'
                      : 'Approved · Active'
                  }
                  icon={<Users className="w-5 h-5" />}
                  pillLabel={worker.identifier}
                  title={worker.fullName}
                  meta={`${worker.phone} · ${worker.village}, ${worker.mandal || 'Mandal not set'}`}
                  tags={[
                    `Medikit: ${worker.medikitCount ?? 0}`,
                    `Biopsy referral kits: ${worker.biopsyReferralKitCount ?? 0}`,
                  ]}
                  footer={{
                    label: 'Assigned location',
                    value: `${worker.village}, ${worker.mandal || ''}`,
                    ctaLabel: worker.active ? 'Deactivate' : 'Activate',
                    onCtaClick: () =>
                      void handleToggleAsha(worker, !worker.active),
                    rightSlot: (
                      worker.verificationStatus === 'approved' || !worker.verificationStatus ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <input
                            aria-label={`Village assignment for ${worker.fullName}`}
                            maxLength={100}
                            value={ashaVillageDrafts[worker.id] ?? worker.village}
                            onChange={(event) =>
                              setAshaVillageDrafts((drafts) => ({
                                ...drafts,
                                [worker.id]: event.target.value,
                              }))
                            }
                            className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                          />
                          <input
                            aria-label={`Mandal assignment for ${worker.fullName}`}
                            maxLength={100}
                            value={ashaMandalDrafts[worker.id] ?? worker.mandal ?? ''}
                            onChange={(event) =>
                              setAshaMandalDrafts((drafts) => ({
                                ...drafts,
                                [worker.id]: event.target.value,
                              }))
                            }
                            className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            disabled={
                              !(ashaVillageDrafts[worker.id] ?? worker.village).trim() ||
                              !(ashaMandalDrafts[worker.id] ?? worker.mandal ?? '').trim() ||
                              (ashaVillageDrafts[worker.id] ?? worker.village) === worker.village &&
                                (ashaMandalDrafts[worker.id] ?? worker.mandal ?? '') === (worker.mandal || '')
                            }
                            onClick={() => void handleAssignAshaLocation(worker)}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-800 disabled:opacity-50"
                          >
                            Save location
                          </button>
                        </div>
                      ) : null
                    ),
                  }}
                />
                ))}
            </div>
          )}
          {ashaWorkers.some((worker) => worker.verificationStatus === 'rejected') && (
            <section className="space-y-3">
              <h3 className="font-display text-lg font-bold text-slate-900">Rejected registrations</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {ashaWorkers
                  .filter((worker) => worker.verificationStatus === 'rejected')
                  .map((worker) => (
                    <div key={worker.id} className="rounded-2xl border border-red-200 bg-red-50/60 p-4">
                      <p className="font-semibold text-slate-900">{worker.fullName}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {worker.officialId || worker.identifier} · {worker.village}, {worker.mandal}
                      </p>
                      <p className="mt-2 text-xs text-red-800">
                        Reason: {worker.rejectionReason || 'Registration not approved.'}
                      </p>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* APPOINTMENTS & URGENT DISPATCH */}
      {activeTab === 'appointments' && (
        <div className="space-y-6">
          <SignatureCard
            variant="navy"
            topRightBadge={`${appointments.length} Total`}
            icon={<Calendar className="w-6 h-6" />}
            pillLabel="Hospital Dispatch"
            title="Hospital Appointments & Triage"
            meta="Monitor appointments and assign pending urgent requests to specialists"
          />

          {appointments.length === 0 ? (
            <SignatureCard
              variant="saffron"
              icon={<Calendar className="w-6 h-6" />}
              pillLabel="No Bookings"
              title="No appointments recorded at this hospital yet"
              meta="Patient bookings and urgent dispatches will appear here."
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {appointments.map((apt, idx) => (
                <SignatureCard
                  key={apt.id}
                  variant={apt.type === 'urgent' ? 'saffron' : getVariantByIndex(idx)}
                  topRightBadge={apt.type.toUpperCase()}
                  icon={<Calendar className="w-6 h-6" />}
                  pillLabel={apt.appointmentCode}
                  title={`${apt.patientName} → ${apt.doctorName}`}
                  meta={`${apt.date} at ${apt.timeSlot} · Mode: ${apt.mode}`}
                  metrics={[
                    { value: apt.date, label: 'Date' },
                    { value: apt.timeSlot, label: 'Slot' },
                    { value: apt.status, label: 'Status' },
                  ]}
                  footer={
                    !apt.doctorId && apt.status === 'pending'
                      ? {
                          label: 'Assign specialist',
                          value: 'Unassigned urgent request',
                          dotTone: 'rose',
                          rightSlot: (
                            <select
                              defaultValue=""
                              onChange={(e) => void handleAssignUrgentDoctor(apt.id, e.target.value)}
                              className="px-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-white"
                            >
                              <option value="">Assign Doctor...</option>
                              {doctors.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.fullName} ({getWorkingStatusLabel(d.workingStatus)})
                                </option>
                              ))}
                            </select>
                          ),
                        }
                      : undefined
                  }
                >
                  <p className="text-xs text-gray-600">Reason: {apt.reason}</p>
                </SignatureCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* HOSPITAL PROFILE */}
      {activeTab === 'hospital' && hospital && (
        <form onSubmit={handleSaveHospital} className="max-w-3xl">
          <SignatureCard
            variant="teal"
            topRightBadge={hospital.hospitalCode}
            icon={<Building2 className="w-6 h-6" />}
            pillLabel="Facility Profile"
            title={`Hospital Profile (${hospital.hospitalCode})`}
            meta="Maintain contact details, street address, and clinic hours"
            footer={{
              label: 'Facility registry',
              value: `Reg ${hospital.registrationNumber}`,
              rightSlot: (
                <button
                  type="submit"
                  className="ad-btn-teal px-5 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer"
                >
                  Save Hospital Profile
                </button>
              ),
            }}
          >
            <div className="space-y-4">
              {hospitalSaveMsg && (
                <div className="p-3 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-xs font-medium text-[#0D5C58] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {hospitalSaveMsg}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Hospital Name (Admin-Controlled)
                  </label>
                  <input
                    disabled
                    value={hospital.name}
                    className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-100 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Registration Number
                  </label>
                  <input
                    disabled
                    value={hospital.registrationNumber}
                    className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-100 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Phone</label>
                  <input
                    value={hospital.phone}
                    onChange={(e) => setHospital({ ...hospital, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Working Hours
                  </label>
                  <input
                    value={hospital.workingHours}
                    onChange={(e) => setHospital({ ...hospital, workingHours: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Address</label>
                  <input
                    value={hospital.address}
                    onChange={(e) => setHospital({ ...hospital, address: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">City</label>
                  <input
                    value={hospital.city}
                    onChange={(e) => setHospital({ ...hospital, city: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">State</label>
                  <input
                    value={hospital.state}
                    onChange={(e) => setHospital({ ...hospital, state: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
                  />
                </div>
              </div>
            </div>
          </SignatureCard>
        </form>
      )}
    </div>
  );
}

export const MANAGER_NAV_ITEMS = [
  { id: 'overview', label: 'Hospital Overview', icon: Building2 },
  { id: 'doctors', label: 'Doctors & Verification', icon: Users },
  { id: 'asha', label: 'ASHA Workers', icon: MapPin },
  { id: 'appointments', label: 'Hospital Appointments', icon: Calendar },
  { id: 'hospital', label: 'Hospital Profile', icon: ShieldCheck },
];
