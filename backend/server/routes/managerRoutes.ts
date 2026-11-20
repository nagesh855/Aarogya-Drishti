import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import {
  authenticate,
  isSamePhoneNumber,
  normalizePhoneNumber,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import {
  UPLOADS_DIR,
  dbStore,
  generateId,
  sanitizeString,
} from '../db/store.js';
import { broadcastToUser } from '../ws/socketServer.js';
import type {
  AshaWorker,
  DoctorProfile,
  UserAccount,
} from '../../../shared/types/index.js';

export const managerRouter = Router();

managerRouter.use(authenticate, requireRoles('hospital_manager'));

const docUpload = multer({
  dest: path.join(UPLOADS_DIR, 'doctor_docs'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF, JPG, PNG, or WEBP verification documents are allowed.'));
  },
});

// Hospital Manager overview (strictly scoped to own hospitalId)
managerRouter.get('/overview', (req: AuthenticatedRequest, res) => {
  const hospitalId = req.auth!.hospitalId!;
  const state = dbStore.getState();
  const hospital = state.hospitals.find((h) => h.id === hospitalId);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital record not found.' });
    return;
  }

  const doctors = state.doctors.filter((d) => d.hospitalId === hospitalId);
  const appointments = state.appointments.filter((a) => a.hospitalId === hospitalId);
  const consultations = state.consultations.filter((c) => c.hospitalId === hospitalId);
  const uniquePatients = new Set(appointments.map((a) => a.patientId));

  res.json({
    hospital,
    stats: {
      totalDoctors: doctors.length,
      verifiedDoctors: doctors.filter((d) => d.verificationStatus === 'verified').length,
      pendingVerificationDoctors: doctors.filter((d) => d.verificationStatus === 'pending').length,
      patientCount: uniquePatients.size,
      totalAppointments: appointments.length,
      pendingRequests: appointments.filter((a) => a.status === 'pending').length,
      upcomingAppointments: appointments.filter((a) => a.status === 'accepted').length,
      completedConsultations: consultations.length,
      urgentRequests: appointments.filter((a) => a.type === 'urgent' && a.status === 'pending').length,
    },
  });
});

// Update own hospital profile (cannot create hospitals or touch others)
managerRouter.put('/hospital', (req: AuthenticatedRequest, res) => {
  const hospitalId = req.auth!.hospitalId!;
  const state = dbStore.getState();
  const hospital = state.hospitals.find((h) => h.id === hospitalId);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }

  const editableFields = [
    'address',
    'city',
    'state',
    'pincode',
    'phone',
    'email',
    'workingHours',
  ] as const;

  for (const f of editableFields) {
    if (typeof req.body?.[f] === 'string') {
      hospital[f] = sanitizeString(req.body[f], 200);
    }
  }
  if (Number.isFinite(Number(req.body?.latitude))) hospital.latitude = Number(req.body.latitude);
  if (Number.isFinite(Number(req.body?.longitude))) hospital.longitude = Number(req.body.longitude);
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
    actorRole: 'hospital_manager',
    actorName: actor?.name || 'Manager',
    action: 'HOSPITAL_PROFILE_UPDATED',
    targetType: 'hospital',
    targetId: hospital.id,
    hospitalId,
  });

  res.json({ hospital });
});

// List doctors strictly for own hospital
managerRouter.get('/doctors', (req: AuthenticatedRequest, res) => {
  const hospitalId = req.auth!.hospitalId!;
  const doctors = dbStore.getState().doctors.filter((d) => d.hospitalId === hospitalId);
  res.json({ doctors });
});

// Add doctor to own hospital + generate Doctor ID & initial password
managerRouter.post('/doctors', (req: AuthenticatedRequest, res) => {
  const hospitalId = req.auth!.hospitalId!;
  const state = dbStore.getState();

  const fullName = sanitizeString(req.body?.fullName, 120);
  const phone = sanitizeString(req.body?.phone, 25);
  const email = sanitizeString(req.body?.email, 120);
  const qualifications = sanitizeString(req.body?.qualifications, 180);
  const registrationNumber = sanitizeString(req.body?.registrationNumber, 80);
  const specialization = sanitizeString(req.body?.specialization, 120);
  const yearsOfExperience = Number(req.body?.yearsOfExperience) || 0;
  const consultationFee = Number(req.body?.consultationFee) || 500;
  const previousHospitals = sanitizeString(req.body?.previousHospitals, 300);
  const previousWorkDetails = sanitizeString(req.body?.previousWorkDetails, 500);
  const achievements = sanitizeString(req.body?.achievements, 400);
  const areasOfExpertise = Array.isArray(req.body?.areasOfExpertise)
    ? req.body.areasOfExpertise.map((x: unknown) => sanitizeString(x, 80)).filter(Boolean)
    : [];
  const onlineConsultationAvailable = Boolean(req.body?.onlineConsultationAvailable ?? true);
  const inPersonConsultationAvailable = Boolean(req.body?.inPersonConsultationAvailable ?? true);

  if (!fullName || !phone || !email || !qualifications || !registrationNumber || !specialization) {
    res.status(400).json({
      error:
        'Full name, phone, email, medical qualifications, registration number, and specialization are required.',
    });
    return;
  }

  const nextNum = 2001 + state.doctors.length;
  const doctorCode = `DOC-${nextNum}`;
  const initialPassword = `DocCare@${Math.floor(1000 + Math.random() * 9000)}`;
  const now = new Date().toISOString();
  const userId = generateId('usr_doc');
  const doctorId = generateId('doc');

  const doctorUser: UserAccount = {
    id: userId,
    role: 'doctor',
    identifier: doctorCode,
    name: fullName,
    email,
    passwordHash: bcrypt.hashSync(initialPassword, 10),
    hospitalId,
    doctorId,
    active: true,
    mustChangePassword: true,
    createdAt: now,
  };

  const defaultSchedule = [
    { day: 'Monday', startTime: '09:30', endTime: '13:00', slotDurationMinutes: 30, enabled: true },
    { day: 'Tuesday', startTime: '09:30', endTime: '13:00', slotDurationMinutes: 30, enabled: true },
    { day: 'Wednesday', startTime: '14:00', endTime: '17:30', slotDurationMinutes: 30, enabled: true },
    { day: 'Thursday', startTime: '09:30', endTime: '13:00', slotDurationMinutes: 30, enabled: true },
    { day: 'Friday', startTime: '10:00', endTime: '14:00', slotDurationMinutes: 30, enabled: true },
    { day: 'Saturday', startTime: '10:00', endTime: '13:00', slotDurationMinutes: 30, enabled: true },
    { day: 'Sunday', startTime: '10:00', endTime: '12:00', slotDurationMinutes: 30, enabled: false },
  ];

  const doctor: DoctorProfile = {
    id: doctorId,
    doctorCode,
    userId,
    hospitalId,
    fullName,
    phone,
    email,
    qualifications,
    registrationNumber,
    specialization,
    yearsOfExperience,
    previousHospitals,
    previousWorkDetails,
    achievements,
    areasOfExpertise,
    consultationFee,
    onlineConsultationAvailable,
    inPersonConsultationAvailable,
    workingStatus: 'available',
    verificationStatus: 'pending',
    verificationNotes: 'Awaiting verification of qualification and registration documents.',
    documents: [],
    schedule: defaultSchedule,
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  state.users.push(doctorUser);
  state.doctors.push(doctor);

  const actor = state.users.find((u) => u.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'hospital_manager',
    actorName: actor?.name || 'Manager',
    action: 'DOCTOR_ADDED',
    targetType: 'doctor',
    targetId: doctor.id,
    hospitalId,
    metadata: { doctorCode, fullName },
  });

  res.status(201).json({
    doctor,
    credentials: {
      doctorCode,
      initialPassword,
      note: 'Share securely with the doctor. Doctor must change the initial password on first sign-in.',
    },
  });
});

// Update doctor or verify/reject documents (strictly own hospital)
managerRouter.put('/doctors/:id', (req: AuthenticatedRequest, res) => {
  const hospitalId = req.auth!.hospitalId!;
  const state = dbStore.getState();
  const doctor = state.doctors.find((d) => d.id === req.params.id);
  if (!doctor || doctor.hospitalId !== hospitalId) {
    res.status(404).json({ error: 'Doctor not found in your hospital.' });
    return;
  }

  const editable = [
    'fullName',
    'phone',
    'email',
    'qualifications',
    'registrationNumber',
    'specialization',
    'previousHospitals',
    'previousWorkDetails',
    'achievements',
    'verificationNotes',
  ] as const;

  for (const field of editable) {
    if (typeof req.body?.[field] === 'string') {
      doctor[field] = sanitizeString(req.body[field], 500);
    }
  }
  if (Number.isFinite(Number(req.body?.yearsOfExperience))) {
    doctor.yearsOfExperience = Number(req.body.yearsOfExperience);
  }
  if (Number.isFinite(Number(req.body?.consultationFee))) {
    doctor.consultationFee = Number(req.body.consultationFee);
  }
  if (typeof req.body?.onlineConsultationAvailable === 'boolean') {
    doctor.onlineConsultationAvailable = req.body.onlineConsultationAvailable;
  }
  if (typeof req.body?.inPersonConsultationAvailable === 'boolean') {
    doctor.inPersonConsultationAvailable = req.body.inPersonConsultationAvailable;
  }
  if (['available', 'busy', 'on_leave'].includes(req.body?.workingStatus)) {
    doctor.workingStatus = req.body.workingStatus;
  }
  if (['pending', 'verified', 'rejected'].includes(req.body?.verificationStatus)) {
    doctor.verificationStatus = req.body.verificationStatus;
    if (doctor.verificationStatus === 'verified') {
      doctor.documents.forEach((doc) => {
        doc.verified = true;
      });
    }
    dbStore.createNotification(
      {
        userId: doctor.userId,
        title: `Doctor Verification ${doctor.verificationStatus === 'verified' ? 'Approved' : 'Updated'}`,
        message: `Your hospital verification status is now: ${doctor.verificationStatus}.`,
        category: 'account',
        relatedId: doctor.id,
      },
      broadcastToUser
    );
  }
  if (typeof req.body?.active === 'boolean') {
    doctor.active = req.body.active;
    const docUser = state.users.find((u) => u.id === doctor.userId);
    if (docUser) docUser.active = req.body.active;
  }
  doctor.updatedAt = new Date().toISOString();

  const actor = state.users.find((u) => u.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'hospital_manager',
    actorName: actor?.name || 'Manager',
    action: 'DOCTOR_UPDATED',
    targetType: 'doctor',
    targetId: doctor.id,
    hospitalId,
    metadata: { verificationStatus: doctor.verificationStatus, active: doctor.active },
  });

  res.json({ doctor });
});

// Upload verification document for a doctor in own hospital
managerRouter.post(
  '/doctors/:id/documents',
  docUpload.single('document'),
  (req: AuthenticatedRequest, res) => {
    const hospitalId = req.auth!.hospitalId!;
    const state = dbStore.getState();
    const doctor = state.doctors.find((d) => d.id === req.params.id);
    if (!doctor || doctor.hospitalId !== hospitalId) {
      res.status(404).json({ error: 'Doctor not found in your hospital.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Please attach a PDF or image verification document.' });
      return;
    }

    const label = sanitizeString(req.body?.label, 120) || 'Professional Qualification Proof';
    const docRecord = {
      id: generateId('ddoc'),
      label,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      filePath: req.file.path,
      uploadedAt: new Date().toISOString(),
      verified: false,
    };

    doctor.documents.push(docRecord);
    doctor.updatedAt = new Date().toISOString();

    const actor = state.users.find((u) => u.id === req.auth!.userId);
    dbStore.addAuditLog({
      actorUserId: req.auth!.userId,
      actorRole: 'hospital_manager',
      actorName: actor?.name || 'Manager',
      action: 'DOCTOR_DOCUMENT_UPLOADED',
      targetType: 'doctor',
      targetId: doctor.id,
      hospitalId,
      metadata: { label },
    });

    res.status(201).json({ document: docRecord, doctor });
  }
);

managerRouter.get('/asha-workers', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const hospitalId = req.auth!.hospitalId!;
  const ashaWorkers = state.ashaWorkers
    .filter((worker) => worker.hospitalId === hospitalId)
    .map((worker) => ({
      ...worker,
      identifier: state.users.find((user) => user.id === worker.userId)?.identifier || '',
    }));
  res.json({ ashaWorkers });
});

managerRouter.get('/asha-requests', (req: AuthenticatedRequest, res) => {
  const hospitalId = req.auth!.hospitalId!;
  const requests = dbStore
    .getState()
    .ashaWorkerRequests.filter(
      (request) =>
        request.status !== 'cancelled' &&
        (!request.hospitalId || request.hospitalId === hospitalId)
    )
    .map((request) => ({
      id: request.id,
      village: request.village,
      mandal: request.mandal,
      status: request.status,
      assignedWorkerId: request.assignedWorkerId,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    }));
  res.json({ requests });
});

managerRouter.patch('/asha-workers/:id/review', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const hospitalId = req.auth!.hospitalId!;
  const worker = state.ashaWorkers.find(
    (item) => item.id === req.params.id && item.hospitalId === hospitalId
  );
  if (!worker) {
    res.status(404).json({ error: 'ASHA Worker registration not found in your hospital.' });
    return;
  }
  if (worker.verificationStatus !== 'pending') {
    res.status(409).json({ error: 'Only pending ASHA Worker registrations can be reviewed.' });
    return;
  }

  const decision = req.body?.decision;
  const rejectionReason = sanitizeString(req.body?.rejectionReason, 300);
  if (decision !== 'approved' && decision !== 'rejected') {
    res.status(400).json({ error: 'Choose approve or reject for this ASHA Worker registration.' });
    return;
  }
  if (decision === 'rejected' && rejectionReason.length < 3) {
    res.status(400).json({ error: 'Provide a reason when rejecting an ASHA Worker registration.' });
    return;
  }

  const workerUser = state.users.find((item) => item.id === worker.userId);
  if (!workerUser) {
    res.status(409).json({ error: 'The ASHA Worker account linked to this registration is missing.' });
    return;
  }

  const now = new Date().toISOString();
  const actor = state.users.find((item) => item.id === req.auth!.userId);
  worker.verificationStatus = decision;
  worker.reviewedAt = now;
  worker.reviewedByUserId = req.auth!.userId;
  worker.rejectionReason = decision === 'rejected' ? rejectionReason : undefined;
  worker.active = decision === 'approved';
  worker.updatedAt = now;
  workerUser.active = worker.active;

  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'hospital_manager',
    actorName: actor?.name || 'Manager',
    action: decision === 'approved' ? 'ASHA_WORKER_APPROVED' : 'ASHA_WORKER_REJECTED',
    targetType: 'asha_worker',
    targetId: worker.id,
    hospitalId,
    metadata: { officialId: worker.officialId || '', rejectionReason },
  });
  dbStore.createNotification(
    {
      userId: worker.userId,
      title: decision === 'approved' ? 'ASHA Worker Registration Approved' : 'ASHA Worker Registration Not Approved',
      message:
        decision === 'approved'
          ? 'Your ASHA Worker registration is approved. You can now sign in to your dashboard.'
          : `Your ASHA Worker registration was not approved: ${rejectionReason}`,
      category: 'account',
      relatedId: worker.id,
    },
    broadcastToUser
  );
  broadcastToUser(worker.userId, { type: 'asha-update' });
  if (decision === 'approved') {
    for (const patient of state.patients) {
      if (
        patient.ashaFollowupConsent &&
        patient.village?.trim().toLocaleLowerCase() === worker.village.trim().toLocaleLowerCase() &&
        patient.mandal?.trim().toLocaleLowerCase() === (worker.mandal || '').trim().toLocaleLowerCase()
      ) {
        broadcastToUser(patient.userId, { type: 'asha-update' });
      }
    }
  }
  res.json({ ashaWorker: worker });
});

managerRouter.patch('/asha-requests/:id/assign', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const hospitalId = req.auth!.hospitalId!;
  const request = state.ashaWorkerRequests.find(
    (item) =>
      item.id === req.params.id &&
      item.status === 'pending' &&
      (!item.hospitalId || item.hospitalId === hospitalId)
  );
  if (!request) {
    res.status(404).json({ error: 'Pending ASHA Worker request not found.' });
    return;
  }

  const workerId = sanitizeString(req.body?.workerId, 100);
  const worker = state.ashaWorkers.find(
    (item) =>
      item.id === workerId &&
      item.hospitalId === hospitalId &&
      item.active &&
      (item.verificationStatus === 'approved' || !item.verificationStatus) &&
      item.village.trim().toLocaleLowerCase() === request.village.trim().toLocaleLowerCase() &&
      (item.mandal || '').trim().toLocaleLowerCase() === request.mandal.trim().toLocaleLowerCase()
  );
  if (!worker) {
    res.status(400).json({
      error: 'Choose an approved, active ASHA Worker assigned to the requested village and mandal.',
    });
    return;
  }

  const patient = state.patients.find((item) => item.id === request.patientId);
  if (
    !patient ||
    !patient.ashaFollowupConsent ||
    patient.village?.trim().toLocaleLowerCase() !== request.village.trim().toLocaleLowerCase() ||
    patient.mandal?.trim().toLocaleLowerCase() !== request.mandal.trim().toLocaleLowerCase()
  ) {
    request.status = 'cancelled';
    request.updatedAt = new Date().toISOString();
    dbStore.persist();
    res.status(409).json({ error: 'Patient consent or location changed. The request has been cancelled.' });
    return;
  }

  const now = new Date().toISOString();
  request.status = 'assigned';
  request.assignedWorkerId = worker.id;
  request.hospitalId = hospitalId;
  request.updatedAt = now;

  const actor = state.users.find((item) => item.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'hospital_manager',
    actorName: actor?.name || 'Manager',
    action: 'ASHA_WORKER_REQUEST_ASSIGNED',
    targetType: 'asha_worker_request',
    targetId: request.id,
    hospitalId,
    metadata: { ashaWorkerId: worker.id, village: request.village, mandal: request.mandal },
  });
  dbStore.createNotification(
    {
      userId: worker.userId,
      title: 'Patient Follow-up Assigned',
      message: `A patient in ${request.village}, ${request.mandal} requested ASHA follow-up.`,
      category: 'followup',
      relatedId: request.id,
    },
    broadcastToUser
  );
  broadcastToUser(worker.userId, { type: 'asha-update' });
  broadcastToUser(patient.userId, { type: 'asha-update' });
  res.json({ request: { id: request.id, status: request.status, assignedWorkerId: worker.id } });
});

managerRouter.post('/asha-workers', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const hospitalId = req.auth!.hospitalId!;
  const fullName = sanitizeString(req.body?.fullName, 120);
  const phoneInput = sanitizeString(req.body?.phone, 32);
  const normalizedPhone = normalizePhoneNumber(phoneInput);
  const village = sanitizeString(req.body?.village, 100);
  const mandal = sanitizeString(req.body?.mandal, 100);
  const address = sanitizeString(req.body?.address, 300);
  if (!fullName || !normalizedPhone.ok || !village || !mandal || !address) {
    res.status(400).json({
      error: 'ASHA Worker name, valid mobile number, village, mandal, and address are required.',
    });
    return;
  }
  const phone = normalizedPhone.normalized;
  if (state.users.some((user) => isSamePhoneNumber(user.mobile, phone))) {
    res.status(409).json({ error: 'An account with this mobile number already exists.' });
    return;
  }

  let workerNumber = 1001 + state.ashaWorkers.length;
  while (state.users.some((user) => user.identifier.toLowerCase() === `asha-${workerNumber}`.toLowerCase())) {
    workerNumber += 1;
  }
  const identifier = `ASHA-${workerNumber}`;
  const initialPassword = `Asha-${randomBytes(12).toString('hex')}`;
  const now = new Date().toISOString();
  const userId = generateId('usr_asha');
  const ashaWorkerId = generateId('asha');
  const user: UserAccount = {
    id: userId,
    role: 'asha_worker',
    identifier,
    name: fullName,
    mobile: phone,
    passwordHash: bcrypt.hashSync(initialPassword, 10),
    hospitalId,
    ashaWorkerId,
    active: true,
    mustChangePassword: true,
    createdAt: now,
  };
  const ashaWorker: AshaWorker = {
    id: ashaWorkerId,
    userId,
    hospitalId,
    fullName,
    phone,
    village,
    officialId: identifier,
    mandal,
    address,
    verificationStatus: 'approved',
    reviewedAt: now,
    reviewedByUserId: req.auth!.userId,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  state.users.push(user);
  state.ashaWorkers.push(ashaWorker);

  const actor = state.users.find((item) => item.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'hospital_manager',
    actorName: actor?.name || 'Manager',
    action: 'ASHA_WORKER_ADDED',
    targetType: 'asha_worker',
    targetId: ashaWorker.id,
    hospitalId,
    metadata: { identifier, village, mandal },
  });
  dbStore.createNotification(
    {
      userId,
      title: 'ASHA Worker Account Created',
      message: `Your ASHA Worker account is verified and assigned to ${village}, ${mandal}. Change your initial password after signing in.`,
      category: 'account',
      relatedId: ashaWorker.id,
    },
    broadcastToUser
  );
  const villageKey = village.trim().toLocaleLowerCase();
  const mandalKey = mandal.trim().toLocaleLowerCase();
  for (const patient of state.patients) {
    if (
      patient.ashaFollowupConsent &&
      patient.village?.trim().toLocaleLowerCase() === villageKey &&
      patient.mandal?.trim().toLocaleLowerCase() === mandalKey
    ) {
      broadcastToUser(patient.userId, { type: 'asha-update' });
    }
  }

  res.status(201).json({
    ashaWorker: { ...ashaWorker, identifier },
    credentials: {
      identifier,
      initialPassword,
      note: 'Share these credentials securely. The worker must change the initial password after signing in.',
    },
  });
});

managerRouter.patch('/asha-workers/:id', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const hospitalId = req.auth!.hospitalId!;
  const worker = state.ashaWorkers.find(
    (item) => item.id === req.params.id && item.hospitalId === hospitalId
  );
  if (!worker) {
    res.status(404).json({ error: 'ASHA Worker not found in your hospital.' });
    return;
  }
  const nextVillage =
    typeof req.body?.village === 'string' ? sanitizeString(req.body.village, 100) : undefined;
  const nextMandal =
    typeof req.body?.mandal === 'string' ? sanitizeString(req.body.mandal, 100) : undefined;
  if (typeof req.body?.active !== 'boolean' && nextVillage === undefined && nextMandal === undefined) {
    res.status(400).json({ error: 'Provide a village, mandal, or active status to update this account.' });
    return;
  }
  if (nextVillage !== undefined && !nextVillage) {
    res.status(400).json({ error: 'Assigned village cannot be empty.' });
    return;
  }
  if (nextMandal !== undefined && !nextMandal) {
    res.status(400).json({ error: 'Assigned mandal cannot be empty.' });
    return;
  }
  if (
    req.body?.active === true &&
    worker.verificationStatus !== 'approved' &&
    worker.verificationStatus !== undefined
  ) {
    res.status(409).json({ error: 'Approve the ASHA Worker registration before activating the account.' });
    return;
  }

  const previousVillageKey = worker.village.trim().toLocaleLowerCase();
  const previousMandalKey = (worker.mandal || '').trim().toLocaleLowerCase();
  if (nextVillage !== undefined) worker.village = nextVillage;
  if (nextMandal !== undefined) worker.mandal = nextMandal;
  if (typeof req.body?.active === 'boolean') worker.active = req.body.active;
  worker.updatedAt = new Date().toISOString();
  const workerUser = state.users.find((user) => user.id === worker.userId);
  if (workerUser && typeof req.body?.active === 'boolean') workerUser.active = worker.active;

  const actor = state.users.find((item) => item.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'hospital_manager',
    actorName: actor?.name || 'Manager',
    action: 'ASHA_WORKER_STATUS_UPDATED',
    targetType: 'asha_worker',
    targetId: worker.id,
    hospitalId,
    metadata: { active: worker.active, village: worker.village },
  });
  const affectedLocations = new Set([
    `${previousVillageKey}|${previousMandalKey}`,
    `${worker.village.trim().toLocaleLowerCase()}|${(worker.mandal || '').trim().toLocaleLowerCase()}`,
  ]);
  if (!worker.active || affectedLocations.size > 1) {
    for (const request of state.ashaWorkerRequests) {
      if (request.assignedWorkerId === worker.id && request.status === 'assigned') {
        request.status = 'pending';
        delete request.assignedWorkerId;
        request.updatedAt = worker.updatedAt;
        const patient = state.patients.find((item) => item.id === request.patientId);
        if (patient) broadcastToUser(patient.userId, { type: 'asha-update' });
      }
    }
  }
  for (const patient of state.patients) {
    if (
      patient.ashaFollowupConsent &&
      patient.village &&
      patient.mandal &&
      affectedLocations.has(
        `${patient.village.trim().toLocaleLowerCase()}|${patient.mandal.trim().toLocaleLowerCase()}`
      )
    ) {
      broadcastToUser(patient.userId, { type: 'asha-update' });
    }
  }
  broadcastToUser(worker.userId, { type: 'asha-update' });
  res.json({ ashaWorker: worker });
});

// Hospital-scoped appointments (no unrestricted medical image/questionnaire leakage)
managerRouter.get('/appointments', (req: AuthenticatedRequest, res) => {
  const hospitalId = req.auth!.hospitalId!;
  const state = dbStore.getState();
  const appointments = state.appointments
    .filter((a) => a.hospitalId === hospitalId)
    .map((a) => {
      const doc = state.doctors.find((d) => d.id === a.doctorId);
      const pat = state.patients.find((p) => p.id === a.patientId);
      return {
        id: a.id,
        appointmentCode: a.appointmentCode,
        type: a.type,
        mode: a.mode,
        date: a.date,
        timeSlot: a.timeSlot,
        status: a.status,
        patientName: pat?.fullName || 'Patient',
        doctorId: a.doctorId,
        doctorName: doc?.fullName || 'Hospital Urgent Pool',
        reason: a.reason,
        createdAt: a.createdAt,
      };
    });
  res.json({ appointments });
});

// Hospital Manager can assign or redirect an urgent hospital-pool appointment to an available doctor
managerRouter.patch('/appointments/:id/assign', (req: AuthenticatedRequest, res) => {
  const hospitalId = req.auth!.hospitalId!;
  const state = dbStore.getState();
  const appt = state.appointments.find((a) => a.id === req.params.id && a.hospitalId === hospitalId);
  if (!appt) {
    res.status(404).json({ error: 'Appointment not found in your hospital.' });
    return;
  }
  const doctorId = sanitizeString(req.body?.doctorId, 80);
  const doctor = state.doctors.find((d) => d.id === doctorId && d.hospitalId === hospitalId);
  if (!doctor) {
    res.status(404).json({ error: 'Selected doctor does not belong to your hospital.' });
    return;
  }

  appt.doctorId = doctor.id;
  appt.updatedAt = new Date().toISOString();
  dbStore.persist();

  dbStore.createNotification(
    {
      userId: doctor.userId,
      title: 'Urgent Consultation Assigned',
      message: `Hospital operations assigned urgent request ${appt.appointmentCode} to you for review.`,
      category: 'urgent',
      relatedId: appt.id,
    },
    broadcastToUser
  );

  res.json({ appointment: appt });
});
