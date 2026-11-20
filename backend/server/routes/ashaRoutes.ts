import { Router } from 'express';
import {
  authenticate,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { dbStore, generateId, sanitizeString } from '../db/store.js';
import { broadcastToUser } from '../ws/socketServer.js';
import type {
  Appointment,
  AshaFollowupOutcome,
  AshaFollowupType,
} from '../../../shared/types/index.js';
import { decryptAadhaarValue, getAadhaarEncryptionKey } from '../services/aadhaarEncryption.js';

export const ashaRouter = Router();

ashaRouter.use(authenticate, requireRoles('asha_worker'));

function getWorker(req: AuthenticatedRequest) {
  return dbStore.getState().ashaWorkers.find((worker) => worker.userId === req.auth!.userId);
}

function notifyHospitalManager(worker: NonNullable<ReturnType<typeof getWorker>>) {
  const state = dbStore.getState();
  const hospital = state.hospitals.find((item) => item.id === worker.hospitalId);
  if (hospital?.managerUserId) {
    broadcastToUser(hospital.managerUserId, { type: 'asha-update' });
  }
}

function workerCanAccess(
  worker: ReturnType<typeof getWorker>
): worker is NonNullable<ReturnType<typeof getWorker>> {
  return Boolean(
    worker &&
      worker.active &&
      (worker.verificationStatus === 'approved' || !worker.verificationStatus)
  );
}

function patientIsAssignedToWorker(
  state: ReturnType<typeof dbStore.getState>,
  patientId: string,
  workerId: string
): boolean {
  const request = state.ashaWorkerRequests
    .filter((item) => item.patientId === patientId && item.status !== 'cancelled')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!request) return true;
  return request.status === 'assigned' && request.assignedWorkerId === workerId;
}

ashaRouter.get('/me', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const worker = getWorker(req);
  if (!workerCanAccess(worker)) {
    res.status(404).json({ error: 'ASHA Worker profile is unavailable.' });
    return;
  }
  res.json({
    worker: {
      ...worker,
      dutyStatus: worker.dutyStatus || 'active',
      medikitCount: worker.medikitCount || 0,
      biopsyReferralKitCount: worker.biopsyReferralKitCount || 0,
    },
    hospitalName: state.hospitals.find((hospital) => hospital.id === worker.hospitalId)?.name || 'Health facility',
  });
});

ashaRouter.patch('/me/duty-status', (req: AuthenticatedRequest, res) => {
  const worker = getWorker(req);
  if (!workerCanAccess(worker)) {
    res.status(404).json({ error: 'ASHA Worker profile is unavailable.' });
    return;
  }
  const dutyStatus = req.body?.dutyStatus;
  if (dutyStatus !== 'active' && dutyStatus !== 'on_field') {
    res.status(400).json({ error: 'Select Active or On field status.' });
    return;
  }
  worker.dutyStatus = dutyStatus;
  worker.updatedAt = new Date().toISOString();
  dbStore.persist();
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'asha_worker',
    actorName: worker.fullName,
    action: 'ASHA_DUTY_STATUS_UPDATED',
    targetType: 'asha_worker',
    targetId: worker.id,
    hospitalId: worker.hospitalId,
    metadata: { dutyStatus },
  });
  notifyHospitalManager(worker);
  res.json({ dutyStatus: worker.dutyStatus });
});

ashaRouter.patch('/me/inventory', (req: AuthenticatedRequest, res) => {
  const worker = getWorker(req);
  if (!workerCanAccess(worker)) {
    res.status(404).json({ error: 'ASHA Worker profile is unavailable.' });
    return;
  }
  const medikitCount = req.body?.medikitCount;
  const biopsyReferralKitCount = req.body?.biopsyReferralKitCount;
  if (
    !Number.isInteger(medikitCount) ||
    medikitCount < 0 ||
    medikitCount > 999 ||
    !Number.isInteger(biopsyReferralKitCount) ||
    biopsyReferralKitCount < 0 ||
    biopsyReferralKitCount > 999
  ) {
    res.status(400).json({ error: 'Kit counts must be whole numbers between 0 and 999.' });
    return;
  }
  const now = new Date().toISOString();
  worker.medikitCount = medikitCount;
  worker.biopsyReferralKitCount = biopsyReferralKitCount;
  worker.inventoryUpdatedAt = now;
  worker.updatedAt = now;
  dbStore.persist();
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'asha_worker',
    actorName: worker.fullName,
    action: 'ASHA_KIT_INVENTORY_UPDATED',
    targetType: 'asha_worker',
    targetId: worker.id,
    hospitalId: worker.hospitalId,
    metadata: { medikitCount, biopsyReferralKitCount },
  });
  notifyHospitalManager(worker);
  res.json({
    medikitCount: worker.medikitCount,
    biopsyReferralKitCount: worker.biopsyReferralKitCount,
    inventoryUpdatedAt: worker.inventoryUpdatedAt,
  });
});

ashaRouter.get('/patients', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const worker = getWorker(req);
  if (!workerCanAccess(worker)) {
    res.status(404).json({ error: 'ASHA Worker profile is unavailable.' });
    return;
  }

  const villageKey = worker.village.trim().toLocaleLowerCase();
  const mandalKey = (worker.mandal || '').trim().toLocaleLowerCase();
  const patients = state.patients
    .filter(
      (patient) =>
        patient.ashaFollowupConsent &&
        patient.village?.trim().toLocaleLowerCase() === villageKey &&
        patient.mandal?.trim().toLocaleLowerCase() === mandalKey &&
        patientIsAssignedToWorker(state, patient.id, worker.id)
    )
    .map((patient) => {
      const patientScreenings = state.screenings
        .filter((screening) => screening.patientId === patient.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const patientAppointments = state.appointments
        .filter((appointment) => appointment.patientId === patient.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.timeSlot.localeCompare(a.timeSlot));
      const detailedRecordsAllowed = Boolean(
        patient.ashaFollowupConsent && patient.ashaClinicalRecordsConsent
      );
      let aadhaarMasked: string | undefined;
      if (
        patient.ashaFollowupConsent &&
        patient.ashaAadhaarLastFourConsent &&
        (patient.aadhaarLastFourEncrypted || patient.aadhaarNumberEncrypted)
      ) {
        const key = getAadhaarEncryptionKey();
        if (!key) {
          throw new Error('Aadhaar encryption key is unavailable for ASHA identity matching.');
        }
        let lastFour: string;
        if (patient.aadhaarLastFourEncrypted) {
          lastFour = decryptAadhaarValue(patient.aadhaarLastFourEncrypted, key)
            .toString('utf8')
            .replace(/\D/g, '');
        } else if (patient.aadhaarNumberEncrypted) {
          const digits = decryptAadhaarValue(patient.aadhaarNumberEncrypted, key)
            .toString('utf8')
            .replace(/\D/g, '');
          if (digits.length !== 12) {
            throw new Error('A stored Aadhaar number is invalid and cannot be shared.');
          }
          lastFour = digits.slice(-4);
        } else {
          lastFour = '';
        }
        if (!/^\d{4}$/.test(lastFour)) {
          throw new Error('Stored Aadhaar last-four value is invalid and cannot be shared.');
        }
        aadhaarMasked = `XXXX-XXXX-${lastFour}`;
      }
      const screeningRecords = detailedRecordsAllowed
        ? patientScreenings.slice(0, 5).map((screening) => ({
            id: screening.id,
            reportCode: screening.reportCode,
            createdAt: screening.createdAt,
            status: screening.status,
            reportedRegion: screening.aiReport?.reportedOralRegion || '',
            riskCategory: screening.aiReport?.preliminaryRiskCategory || '',
            symptoms: Object.entries(screening.questionnaire.symptoms || {})
              .filter(([, present]) => present)
              .map(([symptom]) => symptom),
            symptomDuration: screening.questionnaire.symptomDuration,
            patientReportedSymptoms: screening.aiReport?.patientReportedSymptomsSummary || '',
          }))
        : [];
      const healthRecords = detailedRecordsAllowed
        ? state.consultations
            .filter(
              (consultation) =>
                consultation.patientId === patient.id && consultation.sharedWithPatient
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((consultation) => ({
              id: consultation.id,
              date: consultation.createdAt,
              specialistName:
                state.doctors.find((doctor) => doctor.id === consultation.doctorId)?.fullName ||
                'Hospital specialist',
              hospitalName:
                state.hospitals.find((hospital) => hospital.id === consultation.hospitalId)?.name ||
                'Health facility',
              clinicalObservations: consultation.clinicalObservations,
              consultationNotes: consultation.consultationNotes,
              prescription: consultation.prescription || '',
              recommendations: consultation.recommendations,
              referralRecommended: consultation.referralRecommended,
              referralDetails: consultation.referralDetails || '',
              followUpDate: consultation.followUpDate || '',
              followUpInstructions: consultation.followUpInstructions || '',
            }))
        : [];
      const referrals = patientAppointments
        .filter((appointment) => appointment.referralSource === 'asha')
        .map((appointment) => ({
          id: appointment.id,
          appointmentCode: appointment.appointmentCode,
          hospitalName:
            state.hospitals.find((hospital) => hospital.id === appointment.hospitalId)?.name ||
            'Health facility',
          date: appointment.date,
          status: appointment.status,
          reason: detailedRecordsAllowed ? appointment.urgencyNotes || '' : '',
        }));
      const latestFollowup = state.ashaFollowups
        .filter((followup) => followup.patientId === patient.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        id: patient.id,
        fullName: patient.fullName,
        mobile: patient.mobile,
        age: detailedRecordsAllowed ? patient.age : undefined,
        village: patient.village,
        mandal: patient.mandal,
        aadhaarMasked,
        clinicalRecordsConsent: detailedRecordsAllowed,
        screeningCount: patientScreenings.length,
        latestScreeningId: patientScreenings[0]?.id,
        latestScreeningStatus: patientScreenings[0]?.status,
        latestScreeningAt: patientScreenings[0]?.createdAt,
        latestRiskCategory: detailedRecordsAllowed
          ? patientScreenings[0]?.aiReport?.preliminaryRiskCategory || ''
          : '',
        screeningRecords,
        healthRecords,
        latestAppointmentId: patientAppointments[0]?.id,
        latestAppointmentStatus: patientAppointments[0]?.status,
        latestAppointmentDate: patientAppointments[0]?.date,
        referrals,
        latestFollowupDate: latestFollowup?.followUpDate || '',
      };
    });

  res.json({ patients });
});

ashaRouter.get('/followups', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const worker = getWorker(req);
  if (!workerCanAccess(worker)) {
    res.status(404).json({ error: 'ASHA Worker profile is unavailable.' });
    return;
  }
  const villageKey = worker.village.trim().toLocaleLowerCase();
  const mandalKey = (worker.mandal || '').trim().toLocaleLowerCase();
  const followups = state.ashaFollowups
    .filter((followup) => {
      const patient = state.patients.find((item) => item.id === followup.patientId);
      return (
        followup.village.trim().toLocaleLowerCase() === villageKey &&
        (followup.mandal || '').trim().toLocaleLowerCase() === mandalKey &&
        patient?.ashaFollowupConsent &&
        patient.village?.trim().toLocaleLowerCase() === villageKey &&
        patient.mandal?.trim().toLocaleLowerCase() === mandalKey &&
        patientIsAssignedToWorker(state, patient.id, worker.id)
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((followup) => ({
      ...followup,
      patientName:
        state.patients.find((patient) => patient.id === followup.patientId)?.fullName || 'Patient',
    }));
  res.json({ followups });
});

ashaRouter.post('/patients/:patientId/referrals', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const worker = getWorker(req);
  if (!workerCanAccess(worker)) {
    res.status(404).json({ error: 'ASHA Worker profile is unavailable.' });
    return;
  }
  const patient = state.patients.find((item) => item.id === req.params.patientId);
  const villageKey = worker.village.trim().toLocaleLowerCase();
  const mandalKey = (worker.mandal || '').trim().toLocaleLowerCase();
  if (
    !patient ||
    !patient.ashaFollowupConsent ||
    !patient.ashaClinicalRecordsConsent ||
    patient.village?.trim().toLocaleLowerCase() !== villageKey ||
    patient.mandal?.trim().toLocaleLowerCase() !== mandalKey ||
    !patientIsAssignedToWorker(state, patient.id, worker.id)
  ) {
    res.status(404).json({ error: 'Patient has not shared referral access with your account.' });
    return;
  }
  const hospital = state.hospitals.find(
    (item) => item.id === worker.hospitalId && item.active
  );
  if (!hospital) {
    res.status(400).json({ error: 'Your assigned PHC/Hospital is not active.' });
    return;
  }
  const reason = sanitizeString(req.body?.reason, 500);
  if (!reason) {
    res.status(400).json({ error: 'Enter the patient-reported concern for this referral.' });
    return;
  }
  const existingReferral = state.appointments.find(
    (appointment) =>
      appointment.patientId === patient.id &&
      appointment.referralSource === 'asha' &&
      ['pending', 'accepted'].includes(appointment.status)
  );
  if (existingReferral) {
    res.status(409).json({ error: 'An ASHA hospital referral is already in progress.' });
    return;
  }
  const now = new Date().toISOString();
  const appointment: Appointment = {
    id: generateId('apt'),
    appointmentCode: `APT-${String(state.appointments.length + 101).padStart(4, '0')}`,
    patientId: patient.id,
    hospitalId: hospital.id,
    screeningId: state.screenings
      .filter((screening) => screening.patientId === patient.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id,
    type: 'urgent',
    mode: 'in_person',
    date: now.slice(0, 10),
    timeSlot: 'ASAP',
    reason: 'ASHA community referral',
    urgencyNotes: reason,
    referralSource: 'asha',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  state.appointments.unshift(appointment);
  dbStore.persist();
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'asha_worker',
    actorName: worker.fullName,
    action: 'ASHA_HOSPITAL_REFERRAL_CREATED',
    targetType: 'appointment',
    targetId: appointment.id,
    hospitalId: hospital.id,
    metadata: { patientId: patient.id, referralSource: 'asha' },
  });
  const hospitalUsers = [
    ...state.users.filter(
      (user) =>
        user.active &&
        ((user.role === 'doctor' && user.hospitalId === hospital.id) ||
          user.id === hospital.managerUserId)
    ),
  ];
  for (const hospitalUser of hospitalUsers) {
    dbStore.createNotification(
      {
        userId: hospitalUser.id,
        title: `ASHA Hospital Referral (${appointment.appointmentCode})`,
        message: `An ASHA Worker submitted a patient referral to ${hospital.name}.`,
        category: 'urgent',
        relatedId: appointment.id,
      },
      broadcastToUser
    );
    broadcastToUser(hospitalUser.id, { type: 'appointment-update' });
    if (hospitalUser.id === hospital.managerUserId) {
      broadcastToUser(hospitalUser.id, { type: 'asha-update' });
    }
  }
  dbStore.createNotification(
    {
      userId: patient.userId,
      title: 'Hospital referral submitted',
      message: `${worker.fullName} submitted a referral to ${hospital.name}.`,
      category: 'appointment',
      relatedId: appointment.id,
    },
    broadcastToUser
  );
  broadcastToUser(patient.userId, { type: 'asha-update' });
  broadcastToUser(worker.userId, { type: 'asha-update' });
  res.status(201).json({ appointment });
});

ashaRouter.post('/patients/:patientId/followups', (req: AuthenticatedRequest, res) => {
  const state = dbStore.getState();
  const worker = getWorker(req);
  if (!workerCanAccess(worker)) {
    res.status(404).json({ error: 'ASHA Worker profile is unavailable.' });
    return;
  }
  const patient = state.patients.find((item) => item.id === req.params.patientId);
  const villageKey = worker.village.trim().toLocaleLowerCase();
  const mandalKey = (worker.mandal || '').trim().toLocaleLowerCase();
  if (
    !patient ||
    !patient.ashaFollowupConsent ||
    patient.village?.trim().toLocaleLowerCase() !== villageKey ||
    patient.mandal?.trim().toLocaleLowerCase() !== mandalKey ||
    !patientIsAssignedToWorker(state, patient.id, worker.id)
  ) {
    res.status(404).json({ error: 'Patient is not available in your assigned village.' });
    return;
  }

  const notes = sanitizeString(req.body?.notes, 500);
  const outcome = req.body?.outcome as AshaFollowupOutcome;
  const type = (req.body?.type || 'visit') as AshaFollowupType;
  const appointmentId = sanitizeString(req.body?.appointmentId, 100);
  const screeningId = sanitizeString(req.body?.screeningId, 100);
  const visitDate = sanitizeString(req.body?.visitDate, 10);
  const followUpDate = sanitizeString(req.body?.followUpDate, 10);
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!notes || !validDate(visitDate)) {
    res.status(400).json({ error: 'Visit date and follow-up notes are required.' });
    return;
  }
  if (!['education_provided', 'referred_to_doctor', 'follow_up_required'].includes(outcome)) {
    res.status(400).json({ error: 'Select a valid follow-up outcome.' });
    return;
  }
  if (!['visit', 'screening_reminder', 'appointment_followup'].includes(type)) {
    res.status(400).json({ error: 'Select a valid follow-up type.' });
    return;
  }
  if (type === 'screening_reminder' && !screeningId) {
    res.status(400).json({ error: 'Choose a screening session for this reminder.' });
    return;
  }
  if (type === 'appointment_followup' && !appointmentId) {
    res.status(400).json({ error: 'Choose an appointment for this follow-up.' });
    return;
  }
  if (
    type === 'screening_reminder' &&
    !state.screenings.some((item) => item.id === screeningId && item.patientId === patient.id)
  ) {
    res.status(400).json({ error: 'The selected screening session does not belong to this patient.' });
    return;
  }
  if (
    type === 'appointment_followup' &&
    !state.appointments.some((item) => item.id === appointmentId && item.patientId === patient.id)
  ) {
    res.status(400).json({ error: 'The selected appointment does not belong to this patient.' });
    return;
  }
  if (type !== 'visit' && !followUpDate) {
    res.status(400).json({ error: 'A reminder date is required for screening and appointment follow-ups.' });
    return;
  }
  if (followUpDate && !validDate(followUpDate)) {
    res.status(400).json({ error: 'Follow-up date must use YYYY-MM-DD format.' });
    return;
  }

  const followup = {
    id: generateId('asha_followup'),
    ashaWorkerId: worker.id,
    patientId: patient.id,
    village: worker.village,
    mandal: worker.mandal || '',
    visitDate,
    type,
    ...(appointmentId ? { appointmentId } : {}),
    ...(screeningId ? { screeningId } : {}),
    outcome,
    notes,
    ...(followUpDate ? { followUpDate } : {}),
    createdAt: new Date().toISOString(),
  };
  state.ashaFollowups.push(followup);
  dbStore.persist();

  const actor = state.users.find((user) => user.id === req.auth!.userId);
  dbStore.addAuditLog({
    actorUserId: req.auth!.userId,
    actorRole: 'asha_worker',
    actorName: actor?.name || worker.fullName,
    action: type === 'visit' ? 'ASHA_FOLLOWUP_RECORDED' : 'ASHA_REMINDER_RECORDED',
    targetType: 'patient_followup',
    targetId: followup.id,
    hospitalId: worker.hospitalId,
    metadata: { patientId: patient.id, outcome, type },
  });
  dbStore.createNotification(
    {
      userId: patient.userId,
      title: type === 'visit' ? 'ASHA Follow-up Recorded' : 'ASHA Reminder Scheduled',
      message: `${worker.fullName} recorded a ${type.replace(/_/g, ' ')} for you in ${worker.village}, ${worker.mandal}.`,
      category: 'followup',
      relatedId: followup.id,
    },
    broadcastToUser
  );
  broadcastToUser(patient.userId, { type: 'asha-update' });
  broadcastToUser(worker.userId, { type: 'asha-update' });

  res.status(201).json({ followup });
});
