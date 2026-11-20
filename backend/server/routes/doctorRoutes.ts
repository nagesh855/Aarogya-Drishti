import { Router } from 'express';
import {
  authenticate,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { dbStore, generateId, sanitizeString } from '../db/store.js';
import { broadcastToUser } from '../ws/socketServer.js';
import type { ConsultationRecord } from '../../../shared/types/index.js';
import { withoutAadhaarData } from '../utils/patientProfile.js';

export const doctorRouter = Router();

doctorRouter.use(authenticate, requireRoles('doctor'));

// Doctor's own profile & hospital info
doctorRouter.get('/profile', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const doctor = state.doctors.find((d) => d.id === req.auth!.doctorId);
  if (!doctor) {
    res.status(404).json({ error: 'Doctor profile not found.' });
    return;
  }
  const hospital = state.hospitals.find((h) => h.id === doctor.hospitalId);
  res.json({ doctor, hospital });
});

// Update permitted profile fields, schedule, fee, working status
doctorRouter.put('/profile', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const doctor = state.doctors.find((d) => d.id === req.auth!.doctorId);
  if (!doctor) {
    res.status(404).json({ error: 'Doctor profile not found.' });
    return;
  }

  if (typeof req.body?.phone === 'string') doctor.phone = sanitizeString(req.body.phone, 25);
  if (typeof req.body?.previousWorkDetails === 'string') {
    doctor.previousWorkDetails = sanitizeString(req.body.previousWorkDetails, 500);
  }
  if (typeof req.body?.achievements === 'string') {
    doctor.achievements = sanitizeString(req.body.achievements, 400);
  }
  if (Array.isArray(req.body?.areasOfExpertise)) {
    doctor.areasOfExpertise = req.body.areasOfExpertise
      .map((x: unknown) => sanitizeString(x, 80))
      .filter(Boolean);
  }
  if (Number.isFinite(Number(req.body?.consultationFee))) {
    doctor.consultationFee = Math.max(0, Number(req.body.consultationFee));
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
  if (Array.isArray(req.body?.schedule)) {
    doctor.schedule = req.body.schedule.map((slot: Record<string, unknown>) => ({
      day: sanitizeString(slot.day, 20),
      startTime: sanitizeString(slot.startTime, 10),
      endTime: sanitizeString(slot.endTime, 10),
      slotDurationMinutes: Number(slot.slotDurationMinutes) || 30,
      enabled: Boolean(slot.enabled),
    }));
  }

  doctor.updatedAt = new Date().toISOString();
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'doctor',
    actorName: doctor.fullName,
    action: 'DOCTOR_AVAILABILITY_UPDATED',
    targetType: 'doctor',
    targetId: doctor.id,
    hospitalId: doctor.hospitalId,
  });

  res.json({ doctor });
});

// Appointments assigned to doctor OR pending urgent requests at doctor's hospital
doctorRouter.get('/appointments', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const doctorId = req.auth!.doctorId!;
  const hospitalId = req.auth!.hospitalId!;

  const appointments = state.appointments
    .filter(
      (a) =>
        a.doctorId === doctorId ||
        (a.hospitalId === hospitalId && a.type === 'urgent' && !a.doctorId && a.status === 'pending')
    )
    .map((a) => {
      const patient = state.patients.find((p) => p.id === a.patientId);
      const screening = a.screeningId
        ? state.screenings.find((s) => s.id === a.screeningId)
        : undefined;
      const consultation = state.consultations.find((c) => c.appointmentId === a.id);
      return {
        ...a,
        patientName: patient?.fullName || 'Patient',
        patientMobile: patient?.mobile || '',
        patientAge: patient?.age,
        patientGender: patient?.gender,
        screeningSummary: screening
          ? {
              id: screening.id,
              reportCode: screening.reportCode,
              preliminaryRiskCategory: screening.aiReport?.preliminaryRiskCategory,
              reportedOralRegion: screening.aiReport?.reportedOralRegion,
              status: screening.status,
            }
          : null,
        consultationId: consultation?.id || null,
      };
    });

  res.json({ appointments });
});

// Accept, decline, redirect, or complete an appointment
doctorRouter.patch('/appointments/:id', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const doctorId = req.auth!.doctorId!;
  const hospitalId = req.auth!.hospitalId!;
  const doctor = state.doctors.find((d) => d.id === doctorId);

  const appt = state.appointments.find(
    (a) =>
      a.id === req.params.id &&
      (a.doctorId === doctorId ||
        (a.hospitalId === hospitalId && a.type === 'urgent' && !a.doctorId))
  );

  if (!appt) {
    res.status(404).json({ error: 'Appointment not found or not authorized.' });
    return;
  }

  const nextStatus = req.body?.status;
  if (!['accepted', 'declined', 'redirected', 'completed'].includes(nextStatus)) {
    res.status(400).json({ error: 'Invalid appointment status update.' });
    return;
  }

  if (nextStatus === 'accepted' && !appt.doctorId) {
    appt.doctorId = doctorId;
  }

  appt.status = nextStatus;
  if (typeof req.body?.doctorResponseNotes === 'string') {
    appt.doctorResponseNotes = sanitizeString(req.body.doctorResponseNotes, 500);
  }
  if (typeof req.body?.redirectedHospitalOrDoctor === 'string') {
    appt.redirectedHospitalOrDoctor = sanitizeString(req.body.redirectedHospitalOrDoctor, 200);
  }
  if (nextStatus === 'accepted' && appt.mode === 'video' && !appt.videoRoomId) {
    appt.videoRoomId = `room_${appt.id}`;
  }
  appt.updatedAt = new Date().toISOString();

  const patient = state.patients.find((p) => p.id === appt.patientId);
  if (patient) {
    dbStore.createNotification(
      {
        userId: patient.userId,
        title: `Appointment ${nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}`,
        message: `${doctor?.fullName || 'Your doctor'} updated your ${appt.type} request (${appt.appointmentCode}) to ${nextStatus}.`,
        category: appt.type === 'urgent' ? 'urgent' : 'appointment',
        relatedId: appt.id,
      },
      broadcastToUser
    );
  }

  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'doctor',
    actorName: doctor?.fullName || 'Doctor',
    action: `APPOINTMENT_${nextStatus.toUpperCase()}`,
    targetType: 'appointment',
    targetId: appt.id,
    hospitalId,
  });

  res.json({ appointment: appt });
});

// Assigned/booked patients list
doctorRouter.get('/patients', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const doctorId = req.auth!.doctorId!;
  const myAppointments = state.appointments.filter((a) => a.doctorId === doctorId);
  const patientIds = Array.from(new Set(myAppointments.map((a) => a.patientId)));

  const patients = patientIds
    .map((pid) => {
      const p = state.patients.find((pat) => pat.id === pid);
      if (!p) return null;
      const appts = myAppointments.filter((a) => a.patientId === pid);
      const screenings = state.screenings.filter((s) => s.patientId === pid);
      const latestScreening = screenings[0];
      return {
        id: p.id,
        fullName: p.fullName,
        age: p.age,
        ageCategory: p.ageCategory,
        gender: p.gender,
        city: p.city,
        mobile: p.mobile,
        totalAppointments: appts.length,
        totalScreenings: screenings.length,
        latestRiskCategory: latestScreening?.aiReport?.preliminaryRiskCategory || 'No screening yet',
        lastAppointmentDate: appts[0]?.date,
      };
    })
    .filter(Boolean);

  res.json({ patients });
});

// View authorized patient's full screening history & images (care relationship required + audit logged!)
doctorRouter.get('/patients/:patientId/history', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const doctorId = req.auth!.doctorId!;
  const hospitalId = req.auth!.hospitalId!;
  const patientId = req.params.patientId;

  const hasCareRelation = state.appointments.some(
    (a) =>
      a.patientId === patientId &&
      (a.doctorId === doctorId || (a.hospitalId === hospitalId && a.type === 'urgent'))
  );

  if (!hasCareRelation) {
    res.status(403).json({
      error: 'Access denied. You do not have an active care relationship or appointment with this patient.',
    });
    return;
  }

  const patient = state.patients.find((p) => p.id === patientId);
  if (!patient) {
    res.status(404).json({ error: 'Patient not found.' });
    return;
  }

  const doctor = state.doctors.find((d) => d.id === doctorId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'doctor',
    actorName: doctor?.fullName || 'Doctor',
    action: 'DOCTOR_ACCESSED_PATIENT_HISTORY',
    targetType: 'patient',
    targetId: patientId,
    hospitalId,
    justification: 'Clinical consultation & screening review',
  });

  const screenings = state.screenings
    .filter((s) => s.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const consultations = state.consultations
    .filter((c) => c.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const authorizedPatient = withoutAadhaarData(patient);
  delete authorizedPatient.dateOfBirth;
  delete authorizedPatient.email;
  delete authorizedPatient.bloodGroup;
  delete authorizedPatient.address;
  delete authorizedPatient.state;
  delete authorizedPatient.district;
  delete authorizedPatient.mandal;
  delete authorizedPatient.pincode;
  res.json({ patient: authorizedPatient, screenings, consultations });
});

// Create or update consultation notes, recommendations, referrals, follow-up
doctorRouter.post('/consultations', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const doctorId = req.auth!.doctorId!;
  const hospitalId = req.auth!.hospitalId!;
  const doctor = state.doctors.find((d) => d.id === doctorId);

  const appointmentId = sanitizeString(req.body?.appointmentId, 80);
  const appt = state.appointments.find(
    (a) => a.id === appointmentId && a.doctorId === doctorId
  );

  if (!appt) {
    res.status(404).json({ error: 'Appointment not found for this doctor.' });
    return;
  }

  const now = new Date().toISOString();
  let consultation = state.consultations.find((c) => c.appointmentId === appointmentId);

  const clinicalObservations = sanitizeString(req.body?.clinicalObservations, 3000);
  const consultationNotes = sanitizeString(req.body?.consultationNotes, 3000);
  const prescription = sanitizeString(req.body?.prescription, 3000);
  const recommendations = sanitizeString(req.body?.recommendations, 2000);
  const referralRecommended = Boolean(req.body?.referralRecommended);
  const referralDetails = sanitizeString(req.body?.referralDetails, 1000);
  const followUpDate = sanitizeString(req.body?.followUpDate, 30);
  const followUpInstructions = sanitizeString(req.body?.followUpInstructions, 1500);
  const sharedWithPatient = Boolean(req.body?.sharedWithPatient ?? true);
  const markCompleted = Boolean(req.body?.markCompleted ?? true);
  const durationSeconds = Number(req.body?.durationSeconds) || undefined;
  const diagnosticTestsSuggested = Array.isArray(req.body?.diagnosticTestsSuggested)
    ? req.body.diagnosticTestsSuggested.map((x: unknown) => sanitizeString(x, 120)).filter(Boolean)
    : [];

  if (!consultation) {
    consultation = {
      id: generateId('cons'),
      appointmentId,
      patientId: appt.patientId,
      doctorId,
      hospitalId,
      screeningId: appt.screeningId,
      mode: appt.mode,
      startedAt: now,
      endedAt: markCompleted ? now : undefined,
      durationSeconds,
      clinicalObservations,
      consultationNotes,
      prescription,
      recommendations,
      referralRecommended,
      referralDetails,
      diagnosticTestsSuggested,
      followUpDate,
      followUpInstructions,
      sharedWithPatient,
      createdAt: now,
      updatedAt: now,
    } as ConsultationRecord;
    state.consultations.unshift(consultation);
  } else {
    consultation.clinicalObservations = clinicalObservations;
    consultation.consultationNotes = consultationNotes;
    consultation.prescription = prescription;
    consultation.recommendations = recommendations;
    consultation.referralRecommended = referralRecommended;
    consultation.referralDetails = referralDetails;
    consultation.diagnosticTestsSuggested = diagnosticTestsSuggested;
    consultation.followUpDate = followUpDate;
    consultation.followUpInstructions = followUpInstructions;
    consultation.sharedWithPatient = sharedWithPatient;
    if (durationSeconds) consultation.durationSeconds = durationSeconds;
    if (markCompleted && !consultation.endedAt) consultation.endedAt = now;
    consultation.updatedAt = now;
  }

  if (markCompleted) {
    appt.status = 'completed';
    appt.updatedAt = now;
  }

  if (appt.screeningId) {
    const screening = state.screenings.find((s) => s.id === appt.screeningId);
    if (screening) {
      screening.status = 'reviewed_by_doctor';
      screening.updatedAt = now;
    }
  }

  const patient = state.patients.find((p) => p.id === appt.patientId);
  if (patient && sharedWithPatient) {
    dbStore.createNotification(
      {
        userId: patient.userId,
        title: 'Consultation Notes & Follow-Up Available',
        message: `${doctor?.fullName || 'Your doctor'} added clinical consultation notes and follow-up instructions for ${appt.appointmentCode}.`,
        category: followUpDate ? 'followup' : 'consultation',
        relatedId: consultation.id,
      },
      broadcastToUser
    );
  }

  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'doctor',
    actorName: doctor?.fullName || 'Doctor',
    action: 'CONSULTATION_RECORD_SAVED',
    targetType: 'consultation',
    targetId: consultation.id,
    hospitalId,
    metadata: { appointmentId, markCompleted },
  });

  res.status(201).json({ consultation, appointment: appt });
});
