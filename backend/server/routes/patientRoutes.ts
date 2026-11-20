import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import {
  authenticate,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import {
  UPLOADS_DIR,
  dbStore,
  generateId,
  sanitizeString,
} from '../db/store.js';
import { analyzeOralScreeningWithGemini } from '../services/geminiService.js';
import { broadcastToUser } from '../ws/socketServer.js';
import {
  getAgeCategory,
  getAgeFromDateOfBirth,
  isPatientAgeCategory,
} from '../../../shared/utils/ageClassification.js';
import type {
  Appointment,
  AshaWorkerRequest,
  ScreeningImage,
  ScreeningQuestionnaire,
  ScreeningSession,
} from '../../../shared/types/index.js';
import { withoutAadhaarData } from '../utils/patientProfile.js';

export const patientRouter = Router();

const imageUpload = multer({
  dest: path.join(UPLOADS_DIR, 'screenings'),
  limits: { fileSize: 8 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, and WEBP images are supported for oral screening.'));
  },
});

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function generateTimeSlotsForSchedule(
  startTime: string,
  endTime: string,
  durationMinutes: number
): string[] {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return [];
  const startMins = sh * 60 + (sm || 0);
  const endMins = eh * 60 + (em || 0);
  const slots: string[] = [];
  for (let m = startMins; m + durationMinutes <= endMins; m += durationMinutes) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

// Public / Patient Hospital & Doctor Discovery
patientRouter.get('/discover', (req, res) => {
  const state = dbStore.getState();
  const q = sanitizeString(req.query.q, 100).toLowerCase();
  const city = sanitizeString(req.query.city, 80).toLowerCase();
  const specialization = sanitizeString(req.query.specialization, 100).toLowerCase();
  const hospitalId = sanitizeString(req.query.hospitalId, 80);
  const minExperience = Number(req.query.minExperience) || 0;
  const onlineOnly = req.query.onlineOnly === 'true';
  const availableOnly = req.query.availableOnly === 'true';
  const userLat = Number(req.query.lat);
  const userLng = Number(req.query.lng);
  const hasUserLoc = Number.isFinite(userLat) && Number.isFinite(userLng);

  const activeHospitals = state.hospitals
    .filter((h) => h.active)
    .map((h) => {
      const doctors = state.doctors
        .filter((d) => d.hospitalId === h.id && d.active)
        .filter((d) => {
          if (specialization && !d.specialization.toLowerCase().includes(specialization)) return false;
          if (minExperience > 0 && d.yearsOfExperience < minExperience) return false;
          if (onlineOnly && !d.onlineConsultationAvailable) return false;
          if (availableOnly && d.workingStatus !== 'available') return false;
          return true;
        })
        .map((d) => ({
          id: d.id,
          doctorCode: d.doctorCode,
          hospitalId: d.hospitalId,
          fullName: d.fullName,
          qualifications: d.qualifications,
          registrationNumber: d.registrationNumber,
          specialization: d.specialization,
          yearsOfExperience: d.yearsOfExperience,
          areasOfExpertise: d.areasOfExpertise,
          consultationFee: d.consultationFee,
          onlineConsultationAvailable: d.onlineConsultationAvailable,
          inPersonConsultationAvailable: d.inPersonConsultationAvailable,
          workingStatus: d.workingStatus,
          verificationStatus: d.verificationStatus,
          schedule: d.schedule,
        }));

      const distanceKm = hasUserLoc
        ? haversineKm(userLat, userLng, h.latitude, h.longitude)
        : null;

      return {
        ...h,
        distanceKm,
        doctors,
      };
    })
    .filter((h) => {
      if (hospitalId && h.id !== hospitalId) return false;
      if (city && !h.city.toLowerCase().includes(city) && !h.address.toLowerCase().includes(city)) {
        return false;
      }
      if (q) {
        const hospitalMatch =
          h.name.toLowerCase().includes(q) ||
          h.city.toLowerCase().includes(q) ||
          h.address.toLowerCase().includes(q) ||
          h.services.some((s) => s.toLowerCase().includes(q));
        const docMatch = h.doctors.some(
          (d) =>
            d.fullName.toLowerCase().includes(q) ||
            d.specialization.toLowerCase().includes(q)
        );
        if (!hospitalMatch && !docMatch) return false;
      }
      if ((specialization || minExperience > 0 || onlineOnly || availableOnly) && h.doctors.length === 0) {
        return false;
      }
      return true;
    });

  if (hasUserLoc) {
    activeHospitals.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
  }

  res.json({ hospitals: activeHospitals });
});

// Get available time slots for a specific doctor and date (checks backend booked slots)
patientRouter.get('/doctors/:doctorId/slots', (req, res) => {
  const state = dbStore.getState();
  const doctor = state.doctors.find((d) => d.id === req.params.doctorId && d.active);
  if (!doctor) {
    res.status(404).json({ error: 'Doctor not found.' });
    return;
  }
  const dateStr = sanitizeString(req.query.date, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required.' });
    return;
  }

  const parsedDate = new Date(`${dateStr}T00:00:00`);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[parsedDate.getDay()];

  const daySchedule = doctor.schedule.find((s) => s.day === dayName);
  if (!daySchedule || !daySchedule.enabled || doctor.workingStatus === 'on_leave') {
    res.json({
      date: dateStr,
      dayName,
      workingStatus: doctor.workingStatus,
      slots: [],
    });
    return;
  }

  const allSlots = generateTimeSlotsForSchedule(
    daySchedule.startTime,
    daySchedule.endTime,
    daySchedule.slotDurationMinutes || 30
  );

  const bookedSlots = new Set(
    state.appointments
      .filter(
        (a) =>
          a.doctorId === doctor.id &&
          a.date === dateStr &&
          a.type === 'normal' &&
          ['pending', 'accepted', 'completed'].includes(a.status)
      )
      .map((a) => a.timeSlot)
  );

  const slots = allSlots.map((time) => ({
    time,
    available: !bookedSlots.has(time),
  }));

  res.json({
    date: dateStr,
    dayName,
    workingStatus: doctor.workingStatus,
    slots,
  });
});

// Authenticated patient routes below
patientRouter.use(authenticate, requireRoles('patient'));

patientRouter.get('/profile', (req: AuthenticatedRequest, res) => {
  const patient = dbStore.getState().patients.find((p) => p.id === req.auth!.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Patient profile not found.' });
    return;
  }
  res.json({
    patient: {
      ...withoutAadhaarData(patient),
      hasAadhaarOnFile: Boolean(
        patient.aadhaarLastFourEncrypted || patient.aadhaarNumberEncrypted
      ),
    },
  });
});

patientRouter.put('/profile', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const patient = state.patients.find((p) => p.id === req.auth!.patientId);
  const user = state.users.find((u) => u.id === req.auth!.userId);
  if (!patient || !user) {
    res.status(404).json({ error: 'Patient not found.' });
    return;
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Provide a valid patient profile update.' });
    return;
  }
  const requestBody = req.body as Record<string, unknown>;
  const hasDateOfBirth = Object.prototype.hasOwnProperty.call(requestBody, 'dateOfBirth');
  const hasAgeCategory = Object.prototype.hasOwnProperty.call(requestBody, 'ageCategory');
  let dateOfBirth = patient.dateOfBirth;
  let calculatedAge: number | undefined;

  if (hasDateOfBirth) {
    if (typeof requestBody.dateOfBirth !== 'string') {
      res.status(400).json({ error: 'Enter a valid date of birth.' });
      return;
    }
    const age = getAgeFromDateOfBirth(requestBody.dateOfBirth);
    if (age === null) {
      res.status(400).json({ error: 'Date of birth must be a valid date that is not in the future.' });
      return;
    }
    dateOfBirth = requestBody.dateOfBirth;
    calculatedAge = age;
  }

  const ageForCategory =
    calculatedAge ??
    (dateOfBirth ? getAgeFromDateOfBirth(dateOfBirth) ?? undefined : undefined);
  const recommendedAgeCategory =
    ageForCategory !== undefined ? getAgeCategory(ageForCategory) : null;
  if (hasAgeCategory) {
    if (!isPatientAgeCategory(requestBody.ageCategory)) {
      res.status(400).json({ error: 'Select a valid age category.' });
      return;
    }
    if (!recommendedAgeCategory) {
      res.status(400).json({ error: 'Enter your date of birth before selecting an age category.' });
      return;
    }
    if (requestBody.ageCategory !== recommendedAgeCategory) {
      res.status(400).json({
        error: 'The selected category does not match your date of birth. Choose the recommended category.',
      });
      return;
    }
  }

  const updatedVillage =
    typeof req.body?.village === 'string'
      ? sanitizeString(req.body.village, 100)
      : patient.village || '';
  const updatedMandal =
    typeof req.body?.mandal === 'string'
      ? sanitizeString(req.body.mandal, 100)
      : patient.mandal || '';
  const updatedAshaConsent =
    typeof req.body?.ashaFollowupConsent === 'boolean'
      ? req.body.ashaFollowupConsent
      : Boolean(patient.ashaFollowupConsent);
  const updatedClinicalRecordsConsent = updatedAshaConsent
    ? typeof req.body?.ashaClinicalRecordsConsent === 'boolean'
      ? req.body.ashaClinicalRecordsConsent
      : Boolean(patient.ashaClinicalRecordsConsent)
    : false;
  const updatedAadhaarLastFourConsent =
    updatedAshaConsent && patient.aadhaarNumberEncrypted
      ? typeof req.body?.ashaAadhaarLastFourConsent === 'boolean'
        ? req.body.ashaAadhaarLastFourConsent
        : Boolean(patient.ashaAadhaarLastFourConsent)
      : false;
  if (updatedAshaConsent && (!updatedVillage.trim() || !updatedMandal.trim())) {
    res.status(400).json({
      error: 'Enter your village and mandal before enabling ASHA follow-up sharing.',
    });
    return;
  }

  const previousVillageKey = (patient.village || '').trim().toLocaleLowerCase();
  const previousMandalKey = (patient.mandal || '').trim().toLocaleLowerCase();
  const previouslyConsented = patient.ashaFollowupConsent;
  const previouslyConsentedClinicalRecords = Boolean(patient.ashaClinicalRecordsConsent);
  const previouslyConsentedAadhaarLastFour = Boolean(patient.ashaAadhaarLastFourConsent);
  const locationChanged =
    previousVillageKey !== updatedVillage.trim().toLocaleLowerCase() ||
    previousMandalKey !== updatedMandal.trim().toLocaleLowerCase();
  if (typeof req.body?.fullName === 'string' && req.body.fullName.trim()) {
    patient.fullName = sanitizeString(req.body.fullName, 120);
    user.name = patient.fullName;
  }
  if (dateOfBirth) {
    patient.dateOfBirth = dateOfBirth;
    patient.age = calculatedAge ?? ageForCategory;
    patient.ageCategory =
      hasAgeCategory && isPatientAgeCategory(requestBody.ageCategory)
        ? requestBody.ageCategory
        : recommendedAgeCategory ?? undefined;
  }
  if (['male', 'female', 'other', 'prefer_not_to_say'].includes(req.body?.gender)) {
    patient.gender = req.body.gender;
  }
  if (typeof req.body?.city === 'string') patient.city = sanitizeString(req.body.city, 80);
  if (typeof req.body?.area === 'string') patient.area = sanitizeString(req.body.area, 120);
  patient.village = updatedVillage;
  patient.mandal = updatedMandal;
  patient.ashaFollowupConsent = updatedAshaConsent;
  patient.ashaClinicalRecordsConsent = updatedClinicalRecordsConsent;
  patient.ashaAadhaarLastFourConsent = updatedAadhaarLastFourConsent;
  if (previouslyConsentedClinicalRecords !== updatedClinicalRecordsConsent) {
    dbStore.addAuditLog({
      actorUserId: req.auth!.userId,
      actorRole: 'patient',
      actorName: patient.fullName,
      action: 'ASHA_CLINICAL_RECORD_CONSENT_UPDATED',
      targetType: 'patient',
      targetId: patient.id,
      metadata: { enabled: updatedClinicalRecordsConsent },
    });
  }
  if (previouslyConsentedAadhaarLastFour !== updatedAadhaarLastFourConsent) {
    dbStore.addAuditLog({
      actorUserId: req.auth!.userId,
      actorRole: 'patient',
      actorName: patient.fullName,
      action: 'ASHA_AADHAAR_LAST_FOUR_CONSENT_UPDATED',
      targetType: 'patient',
      targetId: patient.id,
      metadata: { enabled: updatedAadhaarLastFourConsent },
    });
  }
  if (typeof req.body?.previousOralHealthProblems === 'string') {
    patient.previousOralHealthProblems = sanitizeString(req.body.previousOralHealthProblems, 500);
  }
  if (typeof req.body?.medicalHistory === 'string') {
    patient.medicalHistory = sanitizeString(req.body.medicalHistory, 500);
  }
  if (typeof req.body?.emergencyContact === 'string') {
    patient.emergencyContact = sanitizeString(req.body.emergencyContact, 40);
  }
  patient.updatedAt = new Date().toISOString();
  if (!updatedAshaConsent || (previouslyConsented && locationChanged)) {
    for (const request of state.ashaWorkerRequests) {
      if (request.patientId === patient.id && request.status !== 'cancelled') {
        request.status = 'cancelled';
        request.updatedAt = patient.updatedAt;
        if (request.assignedWorkerId) {
          const assignedWorker = state.ashaWorkers.find(
            (worker) => worker.id === request.assignedWorkerId
          );
          if (assignedWorker) broadcastToUser(assignedWorker.userId, { type: 'asha-update' });
        }
      }
    }
  }
  dbStore.persist();

  const villageKey = (patient.village || '').trim().toLocaleLowerCase();
  const mandalKey = (patient.mandal || '').trim().toLocaleLowerCase();
  const locationsToRefresh = new Set<string>();
  if (previouslyConsented && previousVillageKey && previousMandalKey) {
    locationsToRefresh.add(`${previousVillageKey}|${previousMandalKey}`);
  }
  if (patient.ashaFollowupConsent && villageKey && mandalKey) {
    locationsToRefresh.add(`${villageKey}|${mandalKey}`);
  }
  const ashaUsers = new Set(
    state.ashaWorkers
      .filter(
        (worker) =>
          worker.active &&
          (worker.verificationStatus === 'approved' || !worker.verificationStatus) &&
          locationsToRefresh.has(
            `${worker.village.trim().toLocaleLowerCase()}|${(worker.mandal || '').trim().toLocaleLowerCase()}`
          )
      )
      .map((worker) => worker.userId)
  );
  for (const ashaUserId of ashaUsers) {
    broadcastToUser(ashaUserId, { type: 'asha-update' });
  }

  res.json({
    patient: {
      ...withoutAadhaarData(patient),
      hasAadhaarOnFile: Boolean(
        patient.aadhaarLastFourEncrypted || patient.aadhaarNumberEncrypted
      ),
    },
  });
});

patientRouter.get('/asha-followups', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const patient = state.patients.find((p) => p.id === req.auth!.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Patient profile not found.' });
    return;
  }

  const villageKey = (patient.village || '').trim().toLocaleLowerCase();
  const mandalKey = (patient.mandal || '').trim().toLocaleLowerCase();
  const request = state.ashaWorkerRequests
    .filter((item) => item.patientId === patient.id && item.status !== 'cancelled')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const ashaWorkers =
    patient.ashaFollowupConsent && villageKey && mandalKey
      ? state.ashaWorkers
          .filter(
            (worker) =>
              worker.active &&
              (worker.verificationStatus === 'approved' || !worker.verificationStatus) &&
              worker.village.trim().toLocaleLowerCase() === villageKey &&
              (worker.mandal || '').trim().toLocaleLowerCase() === mandalKey &&
              (!request ||
                (request.status === 'assigned' && request.assignedWorkerId === worker.id))
          )
          .map((worker) => ({
            id: worker.id,
            fullName: worker.fullName,
            phone: worker.phone,
            village: worker.village,
            hospitalName: state.hospitals.find((hospital) => hospital.id === worker.hospitalId)?.name || 'Health facility',
          }))
      : [];
  const followups = state.ashaFollowups
    .filter((followup) => followup.patientId === patient.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((followup) => ({
      ...followup,
      ashaWorkerName:
        state.ashaWorkers.find((worker) => worker.id === followup.ashaWorkerId)?.fullName || 'ASHA Worker',
    }));

  res.json({
    ashaWorkers,
    followups,
    request: request
      ? {
          id: request.id,
          status: request.status,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
        }
      : null,
  });
});

patientRouter.post('/asha-requests', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const patient = state.patients.find((item) => item.id === req.auth!.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Patient profile not found.' });
    return;
  }
  if (
    !patient.ashaFollowupConsent ||
    !patient.village?.trim() ||
    !patient.mandal?.trim()
  ) {
    res.status(400).json({
      error: 'Save your village and mandal and enable ASHA follow-up consent before requesting a worker.',
    });
    return;
  }

  const hospitalId = sanitizeString(req.body?.hospitalId, 80);
  if (!hospitalId || !state.hospitals.some((item) => item.id === hospitalId && item.active)) {
    res.status(400).json({ error: 'Choose an active PHC/Hospital for your ASHA Worker request.' });
    return;
  }

  const existing = state.ashaWorkerRequests
    .filter((item) => item.patientId === patient.id && item.status !== 'cancelled')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (existing) {
    if (existing.status === 'pending' && existing.hospitalId !== hospitalId) {
      existing.hospitalId = hospitalId;
      existing.updatedAt = new Date().toISOString();
      dbStore.persist();
      for (const manager of state.users.filter(
        (item) =>
          item.role === 'hospital_manager' &&
          item.active &&
          item.hospitalId === hospitalId
      )) {
        dbStore.createNotification(
          {
            userId: manager.id,
            title: 'ASHA Worker Request Requires Assignment',
            message: `A patient in ${existing.village}, ${existing.mandal} requested a local ASHA Worker.`,
            category: 'followup',
            relatedId: existing.id,
          },
          broadcastToUser
        );
        broadcastToUser(manager.id, { type: 'asha-update' });
      }
    }
    res.json({
      request: {
        id: existing.id,
        status: existing.status,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      },
    });
    return;
  }

  const now = new Date().toISOString();
  const request: AshaWorkerRequest = {
    id: generateId('asha_req'),
    patientId: patient.id,
    village: patient.village.trim(),
    mandal: patient.mandal.trim(),
    status: 'pending',
    hospitalId,
    createdAt: now,
    updatedAt: now,
  };
  state.ashaWorkerRequests.push(request);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'patient',
    actorName: patient.fullName,
    action: 'ASHA_WORKER_REQUESTED',
    targetType: 'asha_worker_request',
    targetId: request.id,
    metadata: { village: request.village, mandal: request.mandal },
  });

  for (const manager of state.users.filter(
    (item) =>
      item.role === 'hospital_manager' &&
      item.active &&
      item.hospitalId === hospitalId
  )) {
    dbStore.createNotification(
      {
        userId: manager.id,
        title: 'ASHA Worker Request Requires Assignment',
        message: `A patient in ${request.village}, ${request.mandal} requested a local ASHA Worker.`,
        category: 'followup',
        relatedId: request.id,
      },
      broadcastToUser
    );
    broadcastToUser(manager.id, { type: 'asha-update' });
  }

  res.status(201).json({
    request: {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    },
  });
});

// Patient's chronological screening history
patientRouter.get('/screenings', (req: AuthenticatedRequest, res) => {
  const screenings = dbStore
    .getState()
    .screenings.filter((s) => s.patientId === req.auth!.patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ screenings });
});

patientRouter.get('/screenings/:id', (req: AuthenticatedRequest, res) => {
  const screening = dbStore
    .getState()
    .screenings.find((s) => s.id === req.params.id && s.patientId === req.auth!.patientId);
  if (!screening) {
    res.status(404).json({ error: 'Screening session not found.' });
    return;
  }
  res.json({ screening });
});

// Start and submit oral screening + Gemini AI image analysis
patientRouter.post(
  '/screenings',
  imageUpload.array('images', 4),
  async (req: AuthenticatedRequest, res) => {
    const state = dbStore.getState();
    const patient = state.patients.find((p) => p.id === req.auth!.patientId);
    if (!patient) {
      res.status(404).json({ error: 'Patient profile not found.' });
      return;
    }

    const consentAccepted =
      req.body?.consentAccepted === 'true' || req.body?.consentAccepted === true;
    if (state.settings.requireConsentBeforeScreening && !consentAccepted) {
      res.status(400).json({ error: 'Informed consent is required before starting screening.' });
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'Please capture or upload at least one clear oral photograph.' });
      return;
    }

    let questionnaire: ScreeningQuestionnaire;
    let regions: string[] = [];
    try {
      questionnaire = JSON.parse(req.body?.questionnaire || '{}') as ScreeningQuestionnaire;
      regions = JSON.parse(req.body?.regions || '[]') as string[];
    } catch {
      res.status(400).json({ error: 'Invalid questionnaire payload.' });
      return;
    }

    const now = new Date().toISOString();
    const screeningId = generateId('scr');
    const reportCode = `SCR-${new Date().getFullYear()}-${String(
      state.screenings.length + 1
    ).padStart(4, '0')}`;

    const storedImages: ScreeningImage[] = files.map((file, idx) => ({
      id: generateId('img'),
      oralRegion: sanitizeString(regions[idx], 80) || 'Oral Cavity',
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storagePath: file.path,
      uploadedAt: now,
    }));

    const session: ScreeningSession = {
      id: screeningId,
      reportCode,
      patientId: patient.id,
      consentAccepted: true,
      consentTimestamp: now,
      questionnaire,
      images: storedImages,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };

    try {
      const geminiImages = storedImages.map((img) => ({
        mimeType: img.mimeType,
        base64Data: fs.readFileSync(img.storagePath).toString('base64'),
        oralRegion: img.oralRegion,
      }));

      const aiReport = await analyzeOralScreeningWithGemini(geminiImages, questionnaire);
      session.aiReport = aiReport;
      session.status =
        aiReport.imageQuality === 'inadequate' ? 'retake_required' : 'analyzed';
      session.updatedAt = new Date().toISOString();

      state.screenings.unshift(session);
      patient.consentGivenAt = patient.consentGivenAt || now;
      if (questionnaire.age && !patient.age) patient.age = questionnaire.age;
      if (questionnaire.generalLocation && !patient.city) {
        patient.city = sanitizeString(questionnaire.generalLocation, 80);
      }
      dbStore.persist();

      dbStore.addAuditLog({
        actorUserId: req.auth!.userId,
        actorRole: 'patient',
        actorName: patient.fullName,
        action: 'SCREENING_COMPLETED',
        targetType: 'screening',
        targetId: session.id,
        metadata: {
          reportCode,
          riskCategory: aiReport.preliminaryRiskCategory,
          imageQuality: aiReport.imageQuality,
        },
      });

      dbStore.createNotification(
        {
          userId: req.auth!.userId,
          title:
            aiReport.imageQuality === 'inadequate'
              ? 'Clearer Oral Photo Needed'
              : `Screening Report Ready (${reportCode})`,
          message:
            aiReport.imageQuality === 'inadequate'
              ? 'The uploaded photo was unclear. Please retake the photograph in bright lighting.'
              : `Preliminary category: ${aiReport.preliminaryRiskCategory}. Review your next steps and specialist options.`,
          category: 'report',
          relatedId: session.id,
        },
        broadcastToUser
      );

      res.status(201).json({ screening: session });
    } catch (err) {
      // Clean up uploaded files on AI failure
      for (const img of storedImages) {
        try {
          if (fs.existsSync(img.storagePath)) fs.unlinkSync(img.storagePath);
        } catch {
          // ignore cleanup error
        }
      }
      const message =
        err instanceof Error ? err.message : 'Unable to complete AI screening analysis.';
      res.status(502).json({ error: message });
    }
  }
);

// Retake images on an inadequate screening session
patientRouter.post(
  '/screenings/:id/retake',
  imageUpload.array('images', 4),
  async (req: AuthenticatedRequest, res) => {
    const state = dbStore.getState();
    const screening = state.screenings.find(
      (s) => s.id === req.params.id && s.patientId === req.auth!.patientId
    );
    if (!screening) {
      res.status(404).json({ error: 'Screening session not found.' });
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'Please upload at least one clear replacement photo.' });
      return;
    }

    let regions: string[] = [];
    try {
      regions = JSON.parse(req.body?.regions || '[]') as string[];
    } catch {
      regions = [];
    }

    const now = new Date().toISOString();
    const newImages: ScreeningImage[] = files.map((file, idx) => ({
      id: generateId('img'),
      oralRegion: sanitizeString(regions[idx], 80) || 'Oral Cavity',
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storagePath: file.path,
      uploadedAt: now,
    }));

    try {
      const geminiImages = newImages.map((img) => ({
        mimeType: img.mimeType,
        base64Data: fs.readFileSync(img.storagePath).toString('base64'),
        oralRegion: img.oralRegion,
      }));

      const aiReport = await analyzeOralScreeningWithGemini(
        geminiImages,
        screening.questionnaire
      );
      screening.images = newImages;
      screening.aiReport = aiReport;
      screening.status =
        aiReport.imageQuality === 'inadequate' ? 'retake_required' : 'analyzed';
      screening.updatedAt = new Date().toISOString();
      dbStore.persist();

      res.json({ screening });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze replacement image.';
      res.status(502).json({ error: message });
    }
  }
);

// Patient Appointments List
patientRouter.get('/appointments', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const appointments = state.appointments
    .filter((a) => a.patientId === req.auth!.patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => {
      const hospital = state.hospitals.find((h) => h.id === a.hospitalId);
      const doctor = state.doctors.find((d) => d.id === a.doctorId);
      const consultation = state.consultations.find(
        (c) => c.appointmentId === a.id && c.sharedWithPatient
      );
      return {
        ...a,
        hospitalName: hospital?.name || 'Hospital',
        hospitalAddress: hospital ? `${hospital.address}, ${hospital.city}` : '',
        hospitalPhone: hospital?.phone || '',
        doctorName: doctor?.fullName || 'Available Hospital Specialist',
        doctorSpecialization: doctor?.specialization || '',
        doctorVerified: doctor?.verificationStatus === 'verified',
        consultation: consultation || null,
      };
    });

  res.json({ appointments });
});

// Book Normal or Urgent Appointment (strict double-booking protection!)
patientRouter.post('/appointments', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const patient = state.patients.find((p) => p.id === req.auth!.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Patient not found.' });
    return;
  }

  const hospitalId = sanitizeString(req.body?.hospitalId, 80);
  const doctorId = sanitizeString(req.body?.doctorId, 80) || undefined;
  const screeningId = sanitizeString(req.body?.screeningId, 80) || undefined;
  const type = req.body?.type === 'urgent' ? 'urgent' : 'normal';
  const mode = req.body?.mode === 'in_person' ? 'in_person' : 'video';
  const date = sanitizeString(req.body?.date, 20) || new Date().toISOString().slice(0, 10);
  const timeSlot = sanitizeString(req.body?.timeSlot, 20) || 'ASAP';
  const reason = sanitizeString(req.body?.reason, 500);
  const urgencyNotes = sanitizeString(req.body?.urgencyNotes, 500);

  const hospital = state.hospitals.find((h) => h.id === hospitalId && h.active);
  if (!hospital) {
    res.status(404).json({ error: 'Selected hospital is not active or registered.' });
    return;
  }

  if (!reason) {
    res.status(400).json({ error: 'Please provide a brief reason for your consultation request.' });
    return;
  }

  if (screeningId) {
    const ownedScreening = state.screenings.find(
      (s) => s.id === screeningId && s.patientId === patient.id
    );
    if (!ownedScreening) {
      res.status(403).json({ error: 'Referenced screening does not belong to your account.' });
      return;
    }
  }

  let selectedDoctor = doctorId
    ? state.doctors.find(
        (d) => d.id === doctorId && d.hospitalId === hospital.id && d.active
      )
    : undefined;

  if (type === 'normal') {
    if (!selectedDoctor) {
      res.status(400).json({ error: 'Please select a doctor for a scheduled appointment.' });
      return;
    }
    if (selectedDoctor.workingStatus === 'on_leave') {
      res.status(400).json({ error: 'Selected doctor is currently on leave.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !timeSlot) {
      res.status(400).json({ error: 'Valid appointment date and time slot are required.' });
      return;
    }

    // Check backend slot availability & prevent double booking
    const conflict = state.appointments.some(
      (a) =>
        a.doctorId === selectedDoctor!.id &&
        a.date === date &&
        a.timeSlot === timeSlot &&
        a.type === 'normal' &&
        ['pending', 'accepted', 'completed'].includes(a.status)
    );
    if (conflict) {
      res.status(409).json({
        error: 'This time slot was just booked by another patient. Please select another slot.',
      });
      return;
    }
  }

  const now = new Date().toISOString();
  const appointmentCode = `APT-${String(state.appointments.length + 101).padStart(4, '0')}`;
  const appointment: Appointment = {
    id: generateId('apt'),
    appointmentCode,
    patientId: patient.id,
    doctorId: selectedDoctor?.id,
    hospitalId: hospital.id,
    screeningId,
    type,
    mode,
    date,
    timeSlot,
    reason,
    urgencyNotes,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  state.appointments.unshift(appointment);

  // Notify relevant doctor(s) and manager for urgent requests
  if (selectedDoctor) {
    dbStore.createNotification(
      {
        userId: selectedDoctor.userId,
        title:
          type === 'urgent'
            ? `Urgent Consultation Request (${appointmentCode})`
            : `New Appointment Request (${appointmentCode})`,
        message: `${patient.fullName} requested a ${mode === 'video' ? 'video' : 'in-person'} consultation on ${date} at ${timeSlot}.`,
        category: type === 'urgent' ? 'urgent' : 'appointment',
        relatedId: appointment.id,
      },
      broadcastToUser
    );
  } else if (type === 'urgent') {
    const hospitalDocs = state.doctors.filter(
      (d) => d.hospitalId === hospital.id && d.active && d.workingStatus !== 'on_leave'
    );
    for (const d of hospitalDocs) {
      dbStore.createNotification(
        {
          userId: d.userId,
          title: `Urgent Hospital Triage Request (${appointmentCode})`,
          message: `${patient.fullName} submitted an urgent request at ${hospital.name}: ${reason}`,
          category: 'urgent',
          relatedId: appointment.id,
        },
        broadcastToUser
      );
    }
    dbStore.createNotification(
      {
        userId: hospital.managerUserId,
        title: `Urgent Request Received (${appointmentCode})`,
        message: `An urgent consultation request requires doctor assignment or review.`,
        category: 'urgent',
        relatedId: appointment.id,
      },
      broadcastToUser
    );
  }

  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'patient',
    actorName: patient.fullName,
    action: type === 'urgent' ? 'URGENT_CONSULTATION_REQUESTED' : 'APPOINTMENT_BOOKED',
    targetType: 'appointment',
    targetId: appointment.id,
    hospitalId: hospital.id,
  });

  res.status(201).json({ appointment });
});

patientRouter.patch('/appointments/:id/cancel', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const appt = state.appointments.find(
    (a) => a.id === req.params.id && a.patientId === req.auth!.patientId
  );
  if (!appt) {
    res.status(404).json({ error: 'Appointment not found.' });
    return;
  }
  if (appt.status === 'completed') {
    res.status(400).json({ error: 'Completed consultations cannot be cancelled.' });
    return;
  }
  appt.status = 'cancelled';
  appt.updatedAt = new Date().toISOString();

  if (appt.doctorId) {
    const doc = state.doctors.find((d) => d.id === appt.doctorId);
    if (doc) {
      dbStore.createNotification(
        {
          userId: doc.userId,
          title: `Appointment Cancelled (${appt.appointmentCode})`,
          message: `Patient cancelled the appointment scheduled for ${appt.date} at ${appt.timeSlot}.`,
          category: 'appointment',
          relatedId: appt.id,
        },
        broadcastToUser
      );
    }
  }
  dbStore.persist();
  res.json({ appointment: appt });
});

// Patient consultation notes & follow-up recommendations
patientRouter.get('/consultations', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const consultations = state.consultations
    .filter((c) => c.patientId === req.auth!.patientId && c.sharedWithPatient)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => {
      const doc = state.doctors.find((d) => d.id === c.doctorId);
      const hosp = state.hospitals.find((h) => h.id === c.hospitalId);
      return {
        ...c,
        doctorName: doc?.fullName || 'Doctor',
        doctorSpecialization: doc?.specialization || '',
        hospitalName: hosp?.name || 'Hospital',
      };
    });
  res.json({ consultations });
});
