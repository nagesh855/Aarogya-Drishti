import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    role: {
      type: String,
      enum: ['admin', 'hospital_manager', 'doctor', 'asha_worker', 'patient'],
      required: true,
      index: true,
    },
    identifier: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String },
    mobile: { type: String, index: true },
    passwordHash: { type: String },
    hospitalId: { type: String, index: true },
    doctorId: { type: String, index: true },
    ashaWorkerId: { type: String, index: true },
    patientId: { type: String, index: true },
    active: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    createdAt: { type: String, required: true },
    lastLoginAt: { type: String },
  },
  { versionKey: false }
);

const AshaWorkerSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, unique: true, index: true },
    hospitalId: { type: String, required: true, index: true },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    officialId: { type: String, unique: true, sparse: true, index: true },
    village: { type: String, required: true, index: true },
    mandal: { type: String, index: true },
    address: { type: String },
    verificationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
      index: true,
    },
    reviewedAt: { type: String },
    reviewedByUserId: { type: String },
    rejectionReason: { type: String },
    dutyStatus: { type: String, enum: ['active', 'on_field'], default: 'active' },
    medikitCount: { type: Number, min: 0, default: 0 },
    biopsyReferralKitCount: { type: Number, min: 0, default: 0 },
    inventoryUpdatedAt: { type: String },
    active: { type: Boolean, default: true, index: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const AshaFollowupSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    ashaWorkerId: { type: String, required: true, index: true },
    patientId: { type: String, required: true, index: true },
    village: { type: String, required: true, index: true },
    mandal: { type: String, index: true },
    visitDate: { type: String, required: true },
    type: {
      type: String,
      enum: ['visit', 'screening_reminder', 'appointment_followup'],
      default: 'visit',
    },
    appointmentId: { type: String },
    screeningId: { type: String },
    outcome: {
      type: String,
      enum: ['education_provided', 'referred_to_doctor', 'follow_up_required'],
      required: true,
    },
    notes: { type: String, required: true },
    followUpDate: { type: String },
    createdAt: { type: String, required: true, index: true },
  },
  { versionKey: false }
);

const AshaWorkerRequestSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    patientId: { type: String, required: true, index: true },
    village: { type: String, required: true, index: true },
    mandal: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'assigned', 'cancelled'],
      required: true,
      index: true,
    },
    assignedWorkerId: { type: String, index: true },
    hospitalId: { type: String, index: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const HospitalSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    hospitalCode: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    registrationNumber: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true, index: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    facilities: [String],
    services: [String],
    workingHours: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
    managerUserId: { type: String, required: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const DoctorSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    doctorCode: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    hospitalId: { type: String, required: true, index: true },
    fullName: { type: String, required: true },
    photoUrl: { type: String },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    qualifications: { type: String, required: true },
    registrationNumber: { type: String, required: true },
    specialization: { type: String, required: true, index: true },
    yearsOfExperience: { type: Number, required: true },
    previousHospitals: { type: String, default: '' },
    previousWorkDetails: { type: String, default: '' },
    achievements: { type: String, default: '' },
    areasOfExpertise: [String],
    consultationFee: { type: Number, required: true },
    onlineConsultationAvailable: { type: Boolean, default: true },
    inPersonConsultationAvailable: { type: Boolean, default: true },
    workingStatus: {
      type: String,
      enum: ['available', 'busy', 'on_leave'],
      default: 'available',
    },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      index: true,
    },
    verificationNotes: { type: String },
    documents: [Schema.Types.Mixed],
    schedule: [Schema.Types.Mixed],
    active: { type: Boolean, default: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const PatientSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, required: true },
    mobile: { type: String, required: true, unique: true, index: true },
    email: { type: String },
    age: { type: Number },
    dateOfBirth: { type: String },
    ageCategory: { type: String, enum: ['children', 'adults', 'senior_citizens'] },
    gender: { type: String },
    bloodGroup: { type: String },
    address: { type: String },
    state: { type: String },
    district: { type: String },
    mandal: { type: String },
    city: { type: String },
    area: { type: String },
    village: { type: String, index: true },
    pincode: { type: String },
    aadhaarLastFourEncrypted: { type: String },
    aadhaarNumberEncrypted: { type: String, select: false },
    aadhaarCardPhotoEncrypted: { type: String, select: false },
    aadhaarConsentGivenAt: { type: String },
    ashaFollowupConsent: { type: Boolean, default: false },
    ashaClinicalRecordsConsent: { type: Boolean, default: false },
    ashaAadhaarLastFourConsent: { type: Boolean, default: false },
    latitude: { type: Number },
    longitude: { type: Number },
    previousOralHealthProblems: { type: String },
    medicalHistory: { type: String },
    emergencyContact: { type: String },
    consentGivenAt: { type: String },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const ScreeningSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    reportCode: { type: String, required: true, unique: true },
    patientId: { type: String, required: true, index: true },
    consentAccepted: { type: Boolean, required: true },
    consentTimestamp: { type: String, required: true },
    questionnaire: { type: Schema.Types.Mixed, required: true },
    images: [Schema.Types.Mixed],
    aiReport: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: ['draft', 'analyzed', 'retake_required', 'reviewed_by_doctor'],
      default: 'draft',
    },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const AppointmentSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    appointmentCode: { type: String, required: true, unique: true },
    patientId: { type: String, required: true, index: true },
    doctorId: { type: String, index: true },
    hospitalId: { type: String, required: true, index: true },
    screeningId: { type: String },
    type: { type: String, enum: ['normal', 'urgent'], required: true },
    mode: { type: String, enum: ['video', 'in_person'], required: true },
    date: { type: String, required: true, index: true },
    timeSlot: { type: String, required: true },
    reason: { type: String, required: true },
    urgencyNotes: { type: String },
    referralSource: { type: String, enum: ['asha'] },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'cancelled', 'completed', 'redirected'],
      default: 'pending',
      index: true,
    },
    doctorResponseNotes: { type: String },
    redirectedHospitalOrDoctor: { type: String },
    videoRoomId: { type: String },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

// Prevent double-booking active normal slots at database level
AppointmentSchema.index(
  { doctorId: 1, date: 1, timeSlot: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'normal',
      status: { $in: ['pending', 'accepted', 'completed'] },
    },
  }
);

const ConsultationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    appointmentId: { type: String, required: true, unique: true, index: true },
    patientId: { type: String, required: true, index: true },
    doctorId: { type: String, required: true, index: true },
    hospitalId: { type: String, required: true, index: true },
    screeningId: { type: String },
    mode: { type: String, enum: ['video', 'in_person'], required: true },
    startedAt: { type: String, required: true },
    endedAt: { type: String },
    durationSeconds: { type: Number },
    clinicalObservations: { type: String, default: '' },
    consultationNotes: { type: String, default: '' },
    prescription: { type: String, default: '' },
    recommendations: { type: String, default: '' },
    referralRecommended: { type: Boolean, default: false },
    referralDetails: { type: String },
    diagnosticTestsSuggested: [String],
    followUpDate: { type: String },
    followUpInstructions: { type: String },
    sharedWithPatient: { type: Boolean, default: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const NotificationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    category: { type: String, required: true },
    relatedId: { type: String },
    read: { type: Boolean, default: false },
    createdAt: { type: String, required: true },
  },
  { versionKey: false }
);

const AuditLogSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    actorUserId: { type: String, required: true, index: true },
    actorRole: { type: String, required: true },
    actorName: { type: String, required: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    hospitalId: { type: String, index: true },
    justification: { type: String },
    metadata: { type: Schema.Types.Mixed },
    createdAt: { type: String, required: true, index: true },
  },
  { versionKey: false }
);

const SettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    consentText: { type: String, required: true },
    requireConsentBeforeScreening: { type: Boolean, default: true },
    enableUrgentRequests: { type: Boolean, default: true },
    enableVideoConsultations: { type: Boolean, default: true },
    maxImagesPerScreening: { type: Number, default: 3 },
    otpExpiryMinutes: { type: Number, default: 5 },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

export const MongoModels = {
  User: mongoose.models.User || mongoose.model('User', UserSchema),
  Hospital: mongoose.models.Hospital || mongoose.model('Hospital', HospitalSchema),
  Doctor: mongoose.models.Doctor || mongoose.model('Doctor', DoctorSchema),
  Patient: mongoose.models.Patient || mongoose.model('Patient', PatientSchema),
  AshaWorker: mongoose.models.AshaWorker || mongoose.model('AshaWorker', AshaWorkerSchema),
  AshaFollowup: mongoose.models.AshaFollowup || mongoose.model('AshaFollowup', AshaFollowupSchema),
  AshaWorkerRequest:
    mongoose.models.AshaWorkerRequest || mongoose.model('AshaWorkerRequest', AshaWorkerRequestSchema),
  Screening: mongoose.models.Screening || mongoose.model('Screening', ScreeningSchema),
  Appointment: mongoose.models.Appointment || mongoose.model('Appointment', AppointmentSchema),
  Consultation: mongoose.models.Consultation || mongoose.model('Consultation', ConsultationSchema),
  Notification: mongoose.models.Notification || mongoose.model('Notification', NotificationSchema),
  AuditLog: mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema),
  Settings: mongoose.models.Settings || mongoose.model('Settings', SettingsSchema),
};
