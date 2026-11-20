import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  authenticate,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { dbStore, generateId, sanitizeString } from '../db/store.js';
import { broadcastToUser } from '../ws/socketServer.js';
import type { Hospital, UserAccount } from '../../../shared/types/index.js';

export const adminRouter = Router();

adminRouter.use(authenticate, requireRoles('admin'));

// Platform-wide overview totals
adminRouter.get('/overview', (_req, res) => {
  const state = dbStore.getState();
  const riskBreakdown = {
    'Low Risk': 0,
    'Moderate Risk': 0,
    'High Risk': 0,
    'Urgent Clinical Evaluation Recommended': 0,
  };
  for (const sc of state.screenings) {
    const cat = sc.aiReport?.preliminaryRiskCategory;
    if (cat && cat in riskBreakdown) {
      riskBreakdown[cat as keyof typeof riskBreakdown] += 1;
    }
  }

  const appointmentStats = {
    total: state.appointments.length,
    pending: state.appointments.filter((a) => a.status === 'pending').length,
    upcoming: state.appointments.filter((a) => a.status === 'accepted').length,
    completed: state.appointments.filter((a) => a.status === 'completed').length,
    urgent: state.appointments.filter((a) => a.type === 'urgent').length,
  };

  res.json({
    totals: {
      hospitals: state.hospitals.length,
      activeHospitals: state.hospitals.filter((h) => h.active).length,
      hospitalManagers: state.users.filter((u) => u.role === 'hospital_manager').length,
      doctors: state.doctors.length,
      verifiedDoctors: state.doctors.filter((d) => d.verificationStatus === 'verified').length,
      patients: state.patients.length,
      screenings: state.screenings.length,
      consultations: state.consultations.length,
    },
    riskBreakdown,
    appointmentStats,
    mongoConnected: dbStore.isMongoActive(),
  });
});

// List all hospitals with manager & doctor counts
adminRouter.get('/hospitals', (_req, res) => {
  const state = dbStore.getState();
  const hospitals = state.hospitals.map((h) => {
    const manager = state.users.find((u) => u.id === h.managerUserId);
    const doctorCount = state.doctors.filter((d) => d.hospitalId === h.id).length;
    const apptCount = state.appointments.filter((a) => a.hospitalId === h.id).length;
    return {
      ...h,
      managerName: manager?.name || 'Assigned Manager',
      managerEmail: manager?.email || h.email,
      managerActive: manager?.active ?? true,
      doctorCount,
      appointmentCount: apptCount,
    };
  });
  res.json({ hospitals });
});

// Admin creates a new hospital AND generates initial Hospital Manager account
adminRouter.post('/hospitals', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const name = sanitizeString(req.body?.name, 150);
  const registrationNumber = sanitizeString(req.body?.registrationNumber, 80);
  const address = sanitizeString(req.body?.address, 250);
  const city = sanitizeString(req.body?.city, 80);
  const stateName = sanitizeString(req.body?.state, 80);
  const pincode = sanitizeString(req.body?.pincode, 12);
  const phone = sanitizeString(req.body?.phone, 25);
  const email = sanitizeString(req.body?.email, 120);
  const managerName = sanitizeString(req.body?.managerName, 120) || `${name} Manager`;
  const workingHours = sanitizeString(req.body?.workingHours, 120) || 'Mon–Sat: 09:00 AM – 06:00 PM';
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const facilities = Array.isArray(req.body?.facilities)
    ? req.body.facilities.map((x: unknown) => sanitizeString(x, 80)).filter(Boolean)
    : [];
  const services = Array.isArray(req.body?.services)
    ? req.body.services.map((x: unknown) => sanitizeString(x, 80)).filter(Boolean)
    : [];

  if (!name || !registrationNumber || !address || !city || !phone || !email) {
    res.status(400).json({ error: 'Hospital name, registration number, address, city, phone, and email are required.' });
    return;
  }

  const nextNum = 1001 + state.hospitals.length;
  const hospitalCode = `HOSP-${nextNum}`;
  const initialPassword = `Aarogya@${Math.floor(1000 + Math.random() * 9000)}`;
  const now = new Date().toISOString();
  const hospitalId = generateId('hosp');
  const managerUserId = generateId('usr_mgr');

  const managerUser: UserAccount = {
    id: managerUserId,
    role: 'hospital_manager',
    identifier: hospitalCode,
    name: managerName,
    email,
    passwordHash: bcrypt.hashSync(initialPassword, 10),
    hospitalId,
    active: true,
    mustChangePassword: true,
    createdAt: now,
  };

  const hospital: Hospital = {
    id: hospitalId,
    hospitalCode,
    name,
    registrationNumber,
    address,
    city,
    state: stateName || 'India',
    pincode: pincode || '000000',
    latitude: Number.isFinite(latitude) ? latitude : 12.9716,
    longitude: Number.isFinite(longitude) ? longitude : 77.5946,
    phone,
    email,
    facilities,
    services,
    workingHours,
    active: true,
    managerUserId,
    createdAt: now,
    updatedAt: now,
  };

  state.users.push(managerUser);
  state.hospitals.push(hospital);

  const actor = state.users.find((u) => u.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'admin',
    actorName: actor?.name || 'Admin',
    action: 'HOSPITAL_CREATED',
    targetType: 'hospital',
    targetId: hospital.id,
    hospitalId: hospital.id,
    metadata: { hospitalCode, name },
  });

  dbStore.createNotification(
    {
      userId: managerUserId,
      title: 'Hospital Account Provisioned',
      message: `Hospital ${name} (${hospitalCode}) has been activated. Please sign in and change your initial password.`,
      category: 'account',
      relatedId: hospital.id,
    },
    broadcastToUser
  );

  res.status(201).json({
    hospital,
    credentials: {
      hospitalCode,
      managerIdentifier: hospitalCode,
      initialPassword,
      note: 'Provide these credentials securely to the Hospital Manager. They will be prompted to change the initial password on login.',
    },
  });
});

// Update hospital details or activation status
adminRouter.patch('/hospitals/:id', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const hospital = state.hospitals.find((h) => h.id === req.params.id);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }

  const fields: Array<keyof Hospital> = [
    'name',
    'registrationNumber',
    'address',
    'city',
    'state',
    'pincode',
    'phone',
    'email',
    'workingHours',
  ];
  for (const field of fields) {
    if (typeof req.body?.[field] === 'string') {
      (hospital[field] as string) = sanitizeString(req.body[field], 200);
    }
  }
  if (typeof req.body?.active === 'boolean') {
    hospital.active = req.body.active;
  }
  if (Number.isFinite(Number(req.body?.latitude))) {
    hospital.latitude = Number(req.body.latitude);
  }
  if (Number.isFinite(Number(req.body?.longitude))) {
    hospital.longitude = Number(req.body.longitude);
  }
  if (Array.isArray(req.body?.facilities)) {
    hospital.facilities = req.body.facilities.map((x: unknown) => sanitizeString(x, 80)).filter(Boolean);
  }
  if (Array.isArray(req.body?.services)) {
    hospital.services = req.body.services.map((x: unknown) => sanitizeString(x, 80)).filter(Boolean);
  }
  hospital.updatedAt = new Date().toISOString();

  const actor = state.users.find((u) => u.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'admin',
    actorName: actor?.name || 'Admin',
    action: 'HOSPITAL_UPDATED',
    targetType: 'hospital',
    targetId: hospital.id,
    hospitalId: hospital.id,
    metadata: { active: hospital.active },
  });

  res.json({ hospital });
});

// Manage platform users
adminRouter.get('/users', (_req, res) => {
  const users = dbStore.getState().users.map((u) => ({
    id: u.id,
    role: u.role,
    identifier: u.identifier,
    name: u.name,
    email: u.email,
    mobile: u.mobile,
    hospitalId: u.hospitalId,
    active: u.active,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  }));
  res.json({ users });
});

adminRouter.patch('/users/:id', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const target = state.users.find((u) => u.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  if (target.id === req.auth!.userId && req.body?.active === false) {
    res.status(400).json({ error: 'You cannot deactivate your own admin account.' });
    return;
  }
  if (typeof req.body?.active === 'boolean') {
    target.active = req.body.active;
  }
  const actor = state.users.find((u) => u.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'admin',
    actorName: actor?.name || 'Admin',
    action: 'USER_STATUS_UPDATED',
    targetType: 'user',
    targetId: target.id,
    metadata: { active: target.active, role: target.role },
  });
  res.json({
    user: {
      id: target.id,
      role: target.role,
      identifier: target.identifier,
      name: target.name,
      active: target.active,
    },
  });
});

// Monitor screening activity & high-risk cases (with audit logging)
adminRouter.get('/screenings', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const actor = state.users.find((u) => u.id === req.auth!.userId);
  const justification = sanitizeString(req.query.justification, 200) || 'Platform safety & high-risk follow-up monitoring';

  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'admin',
    actorName: actor?.name || 'Admin',
    action: 'ADMIN_VIEWED_SCREENING_MONITOR',
    targetType: 'screening_list',
    targetId: 'all',
    justification,
  });

  const screenings = state.screenings.map((sc) => {
    const patient = state.patients.find((p) => p.id === sc.patientId);
    const linkedAppts = state.appointments.filter((a) => a.screeningId === sc.id);
    return {
      id: sc.id,
      reportCode: sc.reportCode,
      patientName: patient?.fullName || 'Patient',
      patientCity: patient?.city || sc.questionnaire.generalLocation || 'Not specified',
      riskCategory: sc.aiReport?.preliminaryRiskCategory || 'Pending',
      imageQuality: sc.aiReport?.imageQuality || 'N/A',
      reportedOralRegion: sc.aiReport?.reportedOralRegion || 'N/A',
      emergencyGuidanceRequired: sc.aiReport?.emergencyGuidanceRequired || false,
      status: sc.status,
      linkedAppointmentsCount: linkedAppts.length,
      createdAt: sc.createdAt,
    };
  });

  res.json({ screenings });
});

// Platform-wide appointments activity
adminRouter.get('/appointments', (_req, res) => {
  const state = dbStore.getState();
  const appointments = state.appointments.map((a) => {
    const hosp = state.hospitals.find((h) => h.id === a.hospitalId);
    const doc = state.doctors.find((d) => d.id === a.doctorId);
    const pat = state.patients.find((p) => p.id === a.patientId);
    return {
      ...a,
      hospitalName: hosp?.name || 'Hospital',
      doctorName: doc?.fullName || 'Unassigned (Urgent Pool)',
      patientName: pat?.fullName || 'Patient',
    };
  });
  res.json({ appointments });
});

// Audit logs
adminRouter.get('/audit-logs', (_req, res) => {
  res.json({ auditLogs: dbStore.getState().auditLogs.slice(0, 200) });
});

// Platform settings
adminRouter.get('/settings', (_req, res) => {
  res.json({ settings: dbStore.getState().settings });
});

adminRouter.put('/settings', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const s = state.settings;
  if (typeof req.body?.consentText === 'string' && req.body.consentText.trim()) {
    s.consentText = sanitizeString(req.body.consentText, 2500);
  }
  if (typeof req.body?.requireConsentBeforeScreening === 'boolean') {
    s.requireConsentBeforeScreening = req.body.requireConsentBeforeScreening;
  }
  if (typeof req.body?.enableUrgentRequests === 'boolean') {
    s.enableUrgentRequests = req.body.enableUrgentRequests;
  }
  if (typeof req.body?.enableVideoConsultations === 'boolean') {
    s.enableVideoConsultations = req.body.enableVideoConsultations;
  }
  if (Number.isFinite(Number(req.body?.maxImagesPerScreening))) {
    s.maxImagesPerScreening = Math.min(5, Math.max(1, Number(req.body.maxImagesPerScreening)));
  }
  s.updatedAt = new Date().toISOString();

  const actor = state.users.find((u) => u.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'admin',
    actorName: actor?.name || 'Admin',
    action: 'PLATFORM_SETTINGS_UPDATED',
    targetType: 'settings',
    targetId: 'default',
  });

  res.json({ settings: s });
});
