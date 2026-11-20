import { useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  Building2,
  CalendarDays,
  FileWarning,
  Plus,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { apiRequest } from '../../utils/api.js';
import type { AuditLogEntry, Hospital, PlatformSettings } from '../../../../shared/types/index.js';
import { AdminHospitalMap } from './AdminHospitalMap.js';
import { SignatureCard, getVariantByIndex } from '../ui/SignatureCard.js';

interface AdminOverview {
  totals: {
    hospitals: number;
    activeHospitals: number;
    hospitalManagers: number;
    doctors: number;
    verifiedDoctors: number;
    patients: number;
    screenings: number;
    consultations: number;
  };
  riskBreakdown: Record<string, number>;
  appointmentStats: {
    total: number;
    pending: number;
    upcoming: number;
    completed: number;
    urgent: number;
  };
  mongoConnected: boolean;
}

interface AdminHospitalRow extends Hospital {
  managerName: string;
  managerEmail: string;
  doctorCount: number;
  appointmentCount: number;
}

interface AdminScreeningRow {
  id: string;
  reportCode: string;
  patientName: string;
  patientCity: string;
  riskCategory: string;
  imageQuality: string;
  reportedOralRegion: string;
  emergencyGuidanceRequired: boolean;
  status: string;
  linkedAppointmentsCount: number;
  createdAt: string;
}

interface AdminUserRow {
  id: string;
  role: string;
  identifier: string;
  name: string;
  email?: string;
  mobile?: string;
  hospitalId?: string;
  active: boolean;
  lastLoginAt?: string;
}

interface AdminAppointmentRow {
  id: string;
  appointmentCode: string;
  type: 'normal' | 'urgent';
  mode: string;
  date: string;
  timeSlot: string;
  status: string;
  patientName: string;
  doctorName: string;
  hospitalName: string;
  reason: string;
}

interface AdminDashboardProps {
  activeTab: string;
  onChangeTab: (tab: string) => void;
}

export function AdminDashboard({ activeTab, onChangeTab }: AdminDashboardProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [hospitals, setHospitals] = useState<AdminHospitalRow[]>([]);
  const [screenings, setScreenings] = useState<AdminScreeningRow[]>([]);
  const [appointments, setAppointments] = useState<AdminAppointmentRow[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [selectedRiskFilter, setSelectedRiskFilter] = useState<string | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [showCreateHospital, setShowCreateHospital] = useState(false);
  const [hospForm, setHospForm] = useState({
    name: '',
    registrationNumber: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    latitude: 12.9716,
    longitude: 77.5946,
    phone: '',
    email: '',
    managerName: '',
    services: 'Oral Cancer Screening, Oral Medicine, Biopsy Diagnostics',
    facilities: 'Digital Intraoral Imaging, Tele-Consultation Studio',
    workingHours: 'Mon–Sat: 09:00 AM – 07:00 PM',
  });
  const [provisionedCreds, setProvisionedCreds] = useState<{
    hospitalCode: string;
    initialPassword: string;
    note: string;
  } | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  const loadAdminData = async () => {
    try {
      const [ovRes, hospRes, usrRes, audRes, setRes] = await Promise.all([
        apiRequest<AdminOverview>('/api/admin/overview'),
        apiRequest<{ hospitals: AdminHospitalRow[] }>('/api/admin/hospitals'),
        apiRequest<{ users: AdminUserRow[] }>('/api/admin/users'),
        apiRequest<{ auditLogs: AuditLogEntry[] }>('/api/admin/audit-logs'),
        apiRequest<{ settings: PlatformSettings }>('/api/admin/settings'),
      ]);
      setOverview(ovRes);
      setHospitals(hospRes.hospitals || []);
      setUsers(usrRes.users || []);
      setAuditLogs(audRes.auditLogs || []);
      setSettings(setRes.settings);
      setOverviewError(null);
    } catch {
      setOverviewError('Unable to refresh platform overview. Please retry.');
    }
  };

  useEffect(() => {
    void loadAdminData();
  }, []);

  useEffect(() => {
    if (activeTab === 'hospitals') {
      apiRequest<{ hospitals: AdminHospitalRow[] }>('/api/admin/hospitals')
        .then((res) => setHospitals(res.hospitals || []))
        .catch(() => setOverviewError('Unable to load platform hospitals.'));
    } else if (activeTab === 'users') {
      apiRequest<{ users: AdminUserRow[] }>('/api/admin/users')
        .then((res) => setUsers(res.users || []))
        .catch(() => setOverviewError('Unable to load platform users.'));
    } else if (activeTab === 'audit') {
      apiRequest<{ auditLogs: AuditLogEntry[] }>('/api/admin/audit-logs')
        .then((res) => setAuditLogs(res.auditLogs || []))
        .catch(() => setOverviewError('Unable to load audit logs.'));
    } else if (activeTab === 'screenings') {
      apiRequest<{ screenings: AdminScreeningRow[] }>(
        '/api/admin/screenings?justification=Platform+urgent+case+oversight'
      )
        .then((res) => setScreenings(res.screenings || []))
        .catch(() => setOverviewError('Unable to load screening activity.'));
    } else if (activeTab === 'appointments') {
      apiRequest<{ appointments: AdminAppointmentRow[] }>('/api/admin/appointments')
        .then((res) => setAppointments(res.appointments || []))
        .catch(() => setOverviewError('Unable to load platform appointments.'));
    }
  }, [activeTab]);

  useEffect(() => {
    const refreshOverview = () => {
      apiRequest<AdminOverview>('/api/admin/overview')
        .then((result) => {
          setOverview(result);
          setOverviewError(null);
        })
        .catch(() => setOverviewError('Live platform metrics are temporarily unavailable.'));
      if (activeTab === 'appointments') {
        apiRequest<{ appointments: AdminAppointmentRow[] }>('/api/admin/appointments')
          .then((result) => setAppointments(result.appointments || []))
          .catch(() => setOverviewError('Live appointment activity is temporarily unavailable.'));
      }
    };
    const intervalId = window.setInterval(refreshOverview, 5000);
    return () => window.clearInterval(intervalId);
  }, [activeTab]);

  const filteredScreenings = selectedRiskFilter
    ? screenings.filter((screening) => screening.riskCategory === selectedRiskFilter)
    : screenings;

  const handleCreateHospital = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{
        hospital: Hospital;
        credentials: { hospitalCode: string; initialPassword: string; note: string };
      }>('/api/admin/hospitals', {
        method: 'POST',
        body: JSON.stringify({
          ...hospForm,
          services: hospForm.services
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          facilities: hospForm.facilities
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setProvisionedCreds(res.credentials);
      setShowCreateHospital(false);
      await loadAdminData();
    } catch {
      // ignore
    }
  };

  const toggleHospitalActive = async (id: string, active: boolean) => {
    await apiRequest(`/api/admin/hospitals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
    await loadAdminData();
  };

  const toggleUserActive = async (id: string, active: boolean) => {
    await apiRequest(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
    await loadAdminData();
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSettingsMsg(null);
    const res = await apiRequest<{ settings: PlatformSettings }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    setSettings(res.settings);
    setSettingsMsg('Platform settings saved and audit-logged.');
  };

  return (
    <div className="space-y-6">
      {overviewError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {overviewError}
        </div>
      )}

      {/* OVERVIEW */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <SignatureCard
              variant="teal"
              topRightBadge="Network"
              icon={<Building2 className="w-6 h-6" />}
              pillLabel="Hospitals"
              title={`${overview.totals.hospitals} Registered`}
              meta={`${overview.totals.activeHospitals} active · ${overview.totals.hospitalManagers} managers`}
              onClick={() => onChangeTab('hospitals')}
            />
            <SignatureCard
              variant="saffron"
              topRightBadge="Clinicians"
              icon={<Users className="w-6 h-6" />}
              pillLabel="Doctors & Patients"
              title={`${overview.totals.doctors} / ${overview.totals.patients}`}
              meta={`${overview.totals.verifiedDoctors} verified specialists`}
              onClick={() => onChangeTab('users')}
            />
            <SignatureCard
              variant="navy"
              topRightBadge="AI Triage"
              icon={<Activity className="w-6 h-6" />}
              pillLabel="Screenings"
              title={`${overview.totals.screenings} Total`}
              meta={`${overview.totals.consultations} completed consultations`}
              onClick={() => {
                setSelectedRiskFilter(null);
                onChangeTab('screenings');
              }}
            />
            <SignatureCard
              variant="teal"
              topRightBadge={`${overview.appointmentStats.urgent} Urgent`}
              icon={<FileWarning className="w-6 h-6" />}
              pillLabel="Appointments"
              title={`${overview.appointmentStats.total} Bookings`}
              meta={`${overview.appointmentStats.pending} pending · ${overview.appointmentStats.upcoming} upcoming`}
              onClick={() => onChangeTab('appointments')}
            />
          </div>

          <SignatureCard
            variant="navy"
            topRightBadge="Triage Analytics"
            icon={<Activity className="w-6 h-6" />}
            pillLabel="Risk Distribution"
            title="Screening Risk Category Distribution"
            meta="Aggregate breakdown of preliminary triage outcomes across all submitted screenings"
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(overview.riskBreakdown).map(([cat, count]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setSelectedRiskFilter(cat);
                    onChangeTab('screenings');
                  }}
                  className="w-full p-4 text-left rounded-2xl border border-gray-200 bg-[#FBFBFA] hover:border-teal-300 hover:bg-teal-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 transition-colors"
                  aria-label={`View ${count} screenings in ${cat}`}
                >
                  <p className="text-xs font-medium text-gray-500">{cat}</p>
                  <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{count}</p>
                </button>
              ))}
            </div>
          </SignatureCard>
        </div>
      )}

      {/* HOSPITALS & MANAGER PROVISIONING */}
      {activeTab === 'hospitals' && (
        <div className="space-y-6">
          <AdminHospitalMap hospitals={hospitals} />

          <SignatureCard
            variant="teal"
            topRightBadge={`${hospitals.length} Hospitals`}
            icon={<Building2 className="w-6 h-6" />}
            pillLabel="Governance Provisioning"
            title="Hospital & Manager Account Provisioning"
            meta="Provision hospitals and issue initial Hospital IDs and manager passwords."
            footer={{
              label: 'Provision new facility',
              value: 'Generates HOSP-ID & manager credentials',
              ctaLabel: showCreateHospital ? 'Close Form' : 'Create Hospital',
              onCtaClick: () => setShowCreateHospital((v) => !v),
            }}
          />

          {provisionedCreds && (
            <SignatureCard
              variant="navy"
              topRightBadge={provisionedCreds.hospitalCode}
              icon={<ShieldCheck className="w-6 h-6" />}
              pillLabel="Credentials Generated"
              title="Hospital & Manager Credentials Generated"
              meta={provisionedCreds.note}
            >
              <p className="text-xs font-mono text-[#0D5C58] bg-[#ECFDF5] p-3 rounded-xl border border-emerald-200">
                Hospital ID: <strong>{provisionedCreds.hospitalCode}</strong> · Initial Password:{' '}
                <strong>{provisionedCreds.initialPassword}</strong>
              </p>
            </SignatureCard>
          )}

          {showCreateHospital && (
            <form onSubmit={handleCreateHospital}>
              <SignatureCard
                variant="saffron"
                topRightBadge="New Facility"
                icon={<Plus className="w-6 h-6" />}
                pillLabel="Hospital Registration"
                title="Register New Hospital"
                meta="Enter verified medical registration, location coordinates, and manager contact"
                footer={{
                  label: 'Provisioning',
                  value: 'Issues Manager ID & temporary password',
                  dotTone: 'amber',
                  rightSlot: (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowCreateHospital(false)}
                        className="px-4 py-2 text-xs font-semibold bg-white border border-gray-200 rounded-xl cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="ad-btn-teal px-5 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer"
                      >
                        Create Hospital
                      </button>
                    </div>
                  ),
                }}
              >
                <div className="grid sm:grid-cols-3 gap-4">
                  <input
                    required
                    placeholder="Hospital Name"
                    value={hospForm.name}
                    onChange={(e) => setHospForm({ ...hospForm, name: e.target.value })}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                  />
                  <input
                    required
                    placeholder="Registration Number"
                    value={hospForm.registrationNumber}
                    onChange={(e) =>
                      setHospForm({ ...hospForm, registrationNumber: e.target.value })
                    }
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                  />
                  <input
                    required
                    placeholder="Hospital Manager Full Name"
                    value={hospForm.managerName}
                    onChange={(e) => setHospForm({ ...hospForm, managerName: e.target.value })}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                  />
                  <input
                    required
                    placeholder="Street Address"
                    value={hospForm.address}
                    onChange={(e) => setHospForm({ ...hospForm, address: e.target.value })}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl sm:col-span-2"
                  />
                  <input
                    required
                    placeholder="City"
                    value={hospForm.city}
                    onChange={(e) => setHospForm({ ...hospForm, city: e.target.value })}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                  />
                  <input
                    required
                    placeholder="State"
                    value={hospForm.state}
                    onChange={(e) => setHospForm({ ...hospForm, state: e.target.value })}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                  />
                  <input
                    required
                    placeholder="Phone"
                    value={hospForm.phone}
                    onChange={(e) => setHospForm({ ...hospForm, phone: e.target.value })}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                  />
                  <input
                    required
                    type="email"
                    placeholder="Official Email"
                    value={hospForm.email}
                    onChange={(e) => setHospForm({ ...hospForm, email: e.target.value })}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Latitude"
                    value={hospForm.latitude}
                    onChange={(e) =>
                      setHospForm({ ...hospForm, latitude: Number(e.target.value) })
                    }
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl font-mono"
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Longitude"
                    value={hospForm.longitude}
                    onChange={(e) =>
                      setHospForm({ ...hospForm, longitude: Number(e.target.value) })
                    }
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl font-mono"
                  />
                  <input
                    placeholder="Working Hours"
                    value={hospForm.workingHours}
                    onChange={(e) => setHospForm({ ...hospForm, workingHours: e.target.value })}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl"
                  />
                </div>
              </SignatureCard>
            </form>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            {hospitals.map((h, idx) => (
              <SignatureCard
                key={h.id}
                variant={getVariantByIndex(idx)}
                topRightBadge={h.active ? 'ACTIVE' : 'INACTIVE'}
                icon={<Building2 className="w-6 h-6" />}
                pillLabel={h.hospitalCode}
                title={h.name}
                meta={`${h.address}, ${h.city}, ${h.state} · Reg ${h.registrationNumber}`}
                metrics={[
                  { value: h.doctorCount, label: 'Doctors' },
                  { value: h.appointmentCount, label: 'Bookings' },
                  { value: h.active ? 'Active' : 'Paused', label: 'Status' },
                ]}
                footer={{
                  label: 'Manager',
                  value: h.managerName,
                  dotTone: h.active ? 'emerald' : 'rose',
                  ctaLabel: h.active ? 'Deactivate' : 'Activate',
                  ctaVariant: h.active ? 'danger' : 'teal',
                  onCtaClick: () => void toggleHospitalActive(h.id, !h.active),
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* HIGH-RISK & SCREENING MONITOR */}
      {activeTab === 'screenings' && (
        <div className="space-y-4">
          {selectedRiskFilter && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
              <span>Showing screenings: {selectedRiskFilter}</span>
              <button
                type="button"
                onClick={() => setSelectedRiskFilter(null)}
                className="rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
              >
                Clear filter
              </button>
            </div>
          )}
          <SignatureCard
            variant="saffron"
            topRightBadge={`${filteredScreenings.length} Sessions`}
            icon={<FileWarning className="w-6 h-6" />}
            pillLabel="Clinical Oversight"
            title="Screening Activity & High-Risk Follow-Up Monitor"
            meta="Permission-controlled view recorded automatically in security audit logs"
          >
            {filteredScreenings.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">
                {selectedRiskFilter
                  ? `No screenings found for ${selectedRiskFilter}.`
                  : 'No screening sessions submitted yet.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500">
                      <th className="py-2.5 pr-4">Report Code</th>
                      <th className="py-2.5 pr-4">Patient</th>
                      <th className="py-2.5 pr-4">Region</th>
                      <th className="py-2.5 pr-4">Preliminary Category</th>
                      <th className="py-2.5 pr-4">Linked Bookings</th>
                      <th className="py-2.5">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredScreenings.map((sc) => (
                      <tr key={sc.id}>
                        <td className="py-2.5 pr-4 font-mono font-semibold">{sc.reportCode}</td>
                        <td className="py-2.5 pr-4">
                          {sc.patientName} ({sc.patientCity})
                        </td>
                        <td className="py-2.5 pr-4">{sc.reportedOralRegion}</td>
                        <td
                          className={`py-2.5 pr-4 font-semibold ${
                            sc.riskCategory.includes('Urgent') || sc.riskCategory.includes('High')
                              ? 'text-rose-700'
                              : 'text-gray-900'
                          }`}
                        >
                          {sc.riskCategory}
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums">{sc.linkedAppointmentsCount}</td>
                        <td className="py-2.5 font-mono text-gray-500">
                          {new Date(sc.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SignatureCard>
        </div>
      )}

      {activeTab === 'appointments' && (
        <SignatureCard
          variant="teal"
          topRightBadge={`${appointments.length} Bookings`}
          icon={<CalendarDays className="w-6 h-6" />}
          pillLabel="Platform Appointments"
          title="Appointments & Urgent Requests"
          meta="Live platform-wide appointment activity, refreshed automatically."
        >
          {appointments.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              No appointments have been submitted yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500">
                    <th className="py-2.5 pr-4">Booking</th>
                    <th className="py-2.5 pr-4">Patient</th>
                    <th className="py-2.5 pr-4">Hospital / Doctor</th>
                    <th className="py-2.5 pr-4">Type</th>
                    <th className="py-2.5 pr-4">Date / Slot</th>
                    <th className="py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {appointments.map((appointment) => (
                    <tr key={appointment.id}>
                      <td className="py-2.5 pr-4 font-mono font-semibold">
                        {appointment.appointmentCode}
                      </td>
                      <td className="py-2.5 pr-4">{appointment.patientName}</td>
                      <td className="py-2.5 pr-4">
                        {appointment.hospitalName}
                        <span className="block text-gray-500">{appointment.doctorName}</span>
                      </td>
                      <td className="py-2.5 pr-4 capitalize">
                        {appointment.type} · {appointment.mode.replace('_', ' ')}
                      </td>
                      <td className="py-2.5 pr-4">
                        {appointment.date} · {appointment.timeSlot}
                      </td>
                      <td className="py-2.5 font-semibold capitalize">{appointment.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SignatureCard>
      )}

      {/* PLATFORM USERS */}
      {activeTab === 'users' && (
        <SignatureCard
          variant="navy"
          topRightBadge={`${users.length} Accounts`}
          icon={<Users className="w-6 h-6" />}
          pillLabel="Access Control"
          title="Platform Users & Roles"
          meta="Manage active accounts across patient, doctor, hospital manager, and admin roles"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="py-2.5 pr-4">Identifier</th>
                  <th className="py-2.5 pr-4">Name</th>
                  <th className="py-2.5 pr-4">Role</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 pr-4 font-mono">{u.identifier}</td>
                    <td className="py-2.5 pr-4 font-semibold text-gray-900">{u.name}</td>
                    <td className="py-2.5 pr-4 capitalize">{u.role.replace('_', ' ')}</td>
                    <td
                      className={`py-2.5 pr-4 font-semibold ${
                        u.active ? 'text-[#0D5C58]' : 'text-rose-700'
                      }`}
                    >
                      {u.active ? 'Active' : 'Inactive'}
                    </td>
                    <td className="py-2.5">
                      {u.role !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => void toggleUserActive(u.id, !u.active)}
                          className="text-xs font-semibold text-[#0D5C58] hover:underline cursor-pointer"
                        >
                          {u.active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SignatureCard>
      )}

      {/* AUDIT LOGS */}
      {activeTab === 'audit' && (
        <SignatureCard
          variant="teal"
          topRightBadge={`${auditLogs.length} Events`}
          icon={<ScrollText className="w-6 h-6" />}
          pillLabel="Immutable Audit Log"
          title="Security & Clinical Audit Logs"
          meta="Chronological trail of logins, clinical record accesses, and administrative actions"
        >
          <div className="space-y-2 max-h-[540px] overflow-y-auto">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="p-3 rounded-xl border border-gray-200 bg-[#FBFBFA] text-xs flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <span className="font-mono font-bold text-gray-900">{log.action}</span> ·{' '}
                  <span className="font-semibold">{log.actorName}</span> ({log.actorRole}) ·
                  Target: {log.targetType}/{log.targetId}
                  {log.justification ? ` · Reason: ${log.justification}` : ''}
                </div>
                <span className="font-mono text-gray-400">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </SignatureCard>
      )}

      {/* SETTINGS */}
      {activeTab === 'settings' && settings && (
        <form onSubmit={saveSettings} className="max-w-3xl">
          <SignatureCard
            variant="navy"
            topRightBadge="Governance"
            icon={<Settings className="w-6 h-6" />}
            pillLabel="Platform Rules"
            title="Platform Governance Settings"
            meta="Configure consent requirements, urgent dispatch workflows, and WebRTC video rooms"
            footer={{
              label: 'Compliance policy',
              value: 'Changes are automatically audit-logged',
              rightSlot: (
                <button
                  type="submit"
                  className="ad-btn-teal px-5 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer"
                >
                  Save Platform Settings
                </button>
              ),
            }}
          >
            <div className="space-y-4">
              {settingsMsg && (
                <div className="p-3 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-xs font-medium text-[#0D5C58]">
                  {settingsMsg}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Patient Screening Informed Consent Notice
                </label>
                <textarea
                  rows={4}
                  value={settings.consentText}
                  onChange={(e) => setSettings({ ...settings, consentText: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl"
                />
              </div>
              <div className="space-y-2 text-xs font-medium text-gray-800">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.requireConsentBeforeScreening}
                    onChange={(e) =>
                      setSettings({ ...settings, requireConsentBeforeScreening: e.target.checked })
                    }
                  />
                  Require explicit patient consent before starting oral screening
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.enableUrgentRequests}
                    onChange={(e) =>
                      setSettings({ ...settings, enableUrgentRequests: e.target.checked })
                    }
                  />
                  Enable Urgent Consultation Request workflow
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.enableVideoConsultations}
                    onChange={(e) =>
                      setSettings({ ...settings, enableVideoConsultations: e.target.checked })
                    }
                  />
                  Enable WebRTC Video Consultations
                </label>
              </div>
            </div>
          </SignatureCard>
        </form>
      )}
    </div>
  );
}

export const ADMIN_NAV_ITEMS = [
  { id: 'overview', label: 'Platform Overview', icon: Activity },
  { id: 'hospitals', label: 'Hospitals & Managers', icon: Building2 },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays },
  { id: 'screenings', label: 'Screening Monitor', icon: FileWarning },
  { id: 'users', label: 'Users & Roles', icon: Users },
  { id: 'audit', label: 'Audit Logs', icon: ScrollText },
  { id: 'settings', label: 'Platform Settings', icon: Settings },
];

export { ShieldCheck };
