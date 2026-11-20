import { Router } from 'express';
import fs from 'fs';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { dbStore } from '../db/store.js';

export const sharedRouter = Router();

// Public platform settings (consent notice & capabilities)
sharedRouter.get('/public/settings', (_req, res) => {
  const s = dbStore.getState().settings;
  res.json({
    consentText: s.consentText,
    requireConsentBeforeScreening: s.requireConsentBeforeScreening,
    enableUrgentRequests: s.enableUrgentRequests,
    enableVideoConsultations: s.enableVideoConsultations,
    maxImagesPerScreening: s.maxImagesPerScreening,
  });
});

// Notifications for authenticated user
sharedRouter.get('/notifications', authenticate, (req: AuthenticatedRequest, res) => {
  const items = dbStore
    .getState()
    .notifications.filter((n) => n.userId === req.auth!.userId)
    .slice(0, 50);
  res.json({ notifications: items });
});

sharedRouter.patch('/notifications/:id/read', authenticate, (req: AuthenticatedRequest, res) => {
  const item = dbStore
    .getState()
    .notifications.find((n) => n.id === req.params.id && n.userId === req.auth!.userId);
  if (item) {
    item.read = true;
    dbStore.persist();
  }
  res.json({ ok: true });
});

sharedRouter.patch('/notifications/read-all', authenticate, (req: AuthenticatedRequest, res) => {
  for (const n of dbStore.getState().notifications) {
    if (n.userId === req.auth!.userId) n.read = true;
  }
  dbStore.persist();
  res.json({ ok: true });
});

// Permission-checked private screening image streaming
sharedRouter.get(
  '/files/screening/:screeningId/:imageId',
  authenticate,
  (req: AuthenticatedRequest, res) => {
    const state = dbStore.getState();
    const screening = state.screenings.find((s) => s.id === req.params.screeningId);
    if (!screening) {
      res.status(404).json({ error: 'Screening not found.' });
      return;
    }

    const img = screening.images.find((i) => i.id === req.params.imageId);
    if (!img || !img.storagePath || !fs.existsSync(img.storagePath)) {
      res.status(404).json({ error: 'Image file not found.' });
      return;
    }

    const auth = req.auth!;
    let authorized = false;

    if (auth.role === 'patient' && screening.patientId === auth.patientId) {
      authorized = true;
    } else if (auth.role === 'doctor') {
      authorized = state.appointments.some(
        (a) =>
          a.patientId === screening.patientId &&
          (a.doctorId === auth.doctorId ||
            (a.hospitalId === auth.hospitalId && a.type === 'urgent'))
      );
    }

    // Note: Hospital Manager and Admin do NOT receive unrestricted image access by default.
    if (!authorized) {
      res.status(403).json({
        error: 'Access denied. Only the patient and authorized treating doctors may view oral screening images.',
      });
      return;
    }

    if (auth.role === 'doctor') {
      const actor = state.users.find((u) => u.id === auth.userId);
      dbStore.addAuditLog({
        actorUserId: auth.userId,
        actorRole: auth.role,
        actorName: actor?.name || 'Doctor',
        action: 'VIEWED_PATIENT_ORAL_IMAGE',
        targetType: 'screening_image',
        targetId: img.id,
        hospitalId: auth.hospitalId,
        justification: `Clinical review for screening ${screening.reportCode}`,
      });
    }

    res.setHeader('Content-Type', img.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(img.storagePath).pipe(res);
  }
);

// Permission-checked doctor verification document streaming
sharedRouter.get(
  '/files/doctor-doc/:doctorId/:docId',
  authenticate,
  (req: AuthenticatedRequest, res) => {
    const state = dbStore.getState();
    const doctor = state.doctors.find((d) => d.id === req.params.doctorId);
    if (!doctor) {
      res.status(404).json({ error: 'Doctor not found.' });
      return;
    }
    const doc = doctor.documents.find((d) => d.id === req.params.docId);
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }

    const auth = req.auth!;
    const allowed =
      auth.role === 'admin' ||
      (auth.role === 'hospital_manager' && auth.hospitalId === doctor.hospitalId) ||
      (auth.role === 'doctor' && auth.doctorId === doctor.id);

    if (!allowed) {
      res.status(403).json({ error: 'Access denied to doctor verification document.' });
      return;
    }

    if (!doc.filePath || !fs.existsSync(doc.filePath)) {
      res.status(404).json({ error: 'Document file is metadata-only or unavailable on disk.' });
      return;
    }

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(doc.filePath).pipe(res);
  }
);
