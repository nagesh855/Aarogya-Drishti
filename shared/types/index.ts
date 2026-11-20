export type UserRole = 'admin' | 'hospital_manager' | 'doctor' | 'asha_worker' | 'patient';

export type PreliminaryRiskCategory =
  | 'Low Risk'
  | 'Moderate Risk'
  | 'High Risk'
  | 'Urgent Clinical Evaluation Recommended';

export type ImageQualityStatus = 'adequate' | 'inadequate' | 'uncertain';

export type VerificationStatus = 'pending' | 'verified' | 'rejected';

export type PatientAgeCategory = 'children' | 'adults' | 'senior_citizens';

export type AppointmentStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'completed'
  | 'redirected';

export type AppointmentType = 'normal' | 'urgent';

export type ConsultationMode = 'video' | 'in_person';

export interface UserAccount {
  id: string;
  role: UserRole;
  identifier: string; // email/admin ID, hospitalId, doctorId, or mobileNumber
  name: string;
  email?: string;
  mobile?: string;
  passwordHash?: string;
  hospitalId?: string;
  doctorId?: string;
  ashaWorkerId?: string;
  patientId?: string;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface Hospital {
  id: string;
  hospitalCode: string; // e.g., HOSP-1001
  name: string;
  registrationNumber: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  phone: string;
  email: string;
  facilities: string[];
  services: string[];
  workingHours: string;
  active: boolean;
  managerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DoctorDocument {
  id: string;
  label: string; // e.g., "Medical Council Registration", "MDS Degree Certificate"
  fileName: string;
  mimeType: string;
  filePath: string;
  uploadedAt: string;
  verified: boolean;
}

export interface DoctorScheduleSlot {
  day: string; // Monday..Sunday
  startTime: string; // "09:00"
  endTime: string; // "13:00"
  slotDurationMinutes: number;
  enabled: boolean;
}

export interface DoctorProfile {
  id: string;
  doctorCode: string; // e.g., DOC-2001
  userId: string;
  hospitalId: string;
  fullName: string;
  photoUrl?: string;
  phone: string;
  email: string;
  qualifications: string;
  registrationNumber: string;
  specialization: string;
  yearsOfExperience: number;
  previousHospitals: string;
  previousWorkDetails: string;
  achievements: string;
  areasOfExpertise: string[];
  consultationFee: number;
  onlineConsultationAvailable: boolean;
  inPersonConsultationAvailable: boolean;
  workingStatus: 'available' | 'busy' | 'on_leave';
  verificationStatus: VerificationStatus;
  verificationNotes?: string;
  documents: DoctorDocument[];
  schedule: DoctorScheduleSlot[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PatientProfile {
  id: string;
  userId: string;
  fullName: string;
  mobile: string;
  email?: string;
  age?: number;
  dateOfBirth?: string;
  ageCategory?: PatientAgeCategory;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  bloodGroup?: string;
  address?: string;
  state?: string;
  district?: string;
  mandal?: string;
  city?: string;
  area?: string;
  village?: string;
  pincode?: string;
  aadhaarLastFourEncrypted?: string;
  aadhaarNumberEncrypted?: string;
  aadhaarCardPhotoEncrypted?: string;
  aadhaarConsentGivenAt?: string;
  ashaFollowupConsent?: boolean;
  ashaClinicalRecordsConsent?: boolean;
  ashaAadhaarLastFourConsent?: boolean;
  hasAadhaarOnFile?: boolean;
  latitude?: number;
  longitude?: number;
  previousOralHealthProblems?: string;
  medicalHistory?: string;
  emergencyContact?: string;
  consentGivenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AshaWorker {
  id: string;
  userId: string;
  hospitalId: string;
  fullName: string;
  phone: string;
  village: string;
  officialId?: string;
  mandal?: string;
  address?: string;
  verificationStatus?: 'pending' | 'approved' | 'rejected';
  reviewedAt?: string;
  reviewedByUserId?: string;
  rejectionReason?: string;
  dutyStatus?: 'active' | 'on_field';
  medikitCount?: number;
  biopsyReferralKitCount?: number;
  inventoryUpdatedAt?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AshaFollowupType = 'visit' | 'screening_reminder' | 'appointment_followup';

export type AshaFollowupOutcome =
  | 'education_provided'
  | 'referred_to_doctor'
  | 'follow_up_required';

export interface AshaFollowup {
  id: string;
  ashaWorkerId: string;
  patientId: string;
  village: string;
  mandal?: string;
  visitDate: string;
  type?: AshaFollowupType;
  appointmentId?: string;
  screeningId?: string;
  outcome: AshaFollowupOutcome;
  notes: string;
  followUpDate?: string;
  createdAt: string;
}

export interface AshaWorkerRequest {
  id: string;
  patientId: string;
  village: string;
  mandal: string;
  status: 'pending' | 'assigned' | 'cancelled';
  assignedWorkerId?: string;
  hospitalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScreeningQuestionnaire {
  age?: number;
  gender?: string;
  generalLocation?: string;
  previousOralProblems?: string;
  usesTobacco: 'yes' | 'no' | 'unsure';
  tobaccoTypes: string[];
  tobaccoFrequencyDuration?: string;
  consumesAlcohol: 'yes' | 'no' | 'occasionally' | 'unsure';
  alcoholFrequencyDuration?: string;
  chewsBetelOrArecaNut: 'yes' | 'no' | 'unsure';
  betelFrequencyDuration?: string;
  symptoms: {
    whitePatches: boolean;
    redPatches: boolean;
    nonHealingUlcers: boolean;
    unusualGrowthsOrLumps: boolean;
    difficultyOpeningMouth: boolean;
    difficultySwallowing: boolean;
    painWhileChewing: boolean;
    bleedingInsideMouth: boolean;
    persistentPainOrNumbness: boolean;
    voiceChangeOrNeckSwelling: boolean;
  };
  symptomDuration: string;
  otherSymptomsDescription?: string;
  severeOrRapidlyWorsening: boolean;
}

export interface ScreeningImage {
  id: string;
  oralRegion: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  uploadedAt: string;
}

export interface AIScreeningReport {
  imageQuality: ImageQualityStatus;
  imageQualityReason: string;
  observedVisibleFeatures: string[];
  reportedOralRegion: string;
  preliminaryRiskCategory: PreliminaryRiskCategory;
  riskExplanation: string;
  patientReportedSymptomsSummary: string;
  lifestyleRiskFactorsSummary: string;
  recommendedNextSteps: string[];
  urgencyOfAssessment: string;
  uncertaintyAndLimitations: string;
  emergencyGuidanceRequired: boolean;
  modelUsed: string;
  generatedAt: string;
}

export interface ScreeningSession {
  id: string;
  reportCode: string; // e.g., SCR-2026-0001
  patientId: string;
  consentAccepted: boolean;
  consentTimestamp: string;
  questionnaire: ScreeningQuestionnaire;
  images: ScreeningImage[];
  aiReport?: AIScreeningReport;
  status: 'draft' | 'analyzed' | 'retake_required' | 'reviewed_by_doctor';
  createdAt: string;
  updatedAt: string;
}

export interface Appointment {
  id: string;
  appointmentCode: string;
  patientId: string;
  doctorId?: string; // optional initially for hospital-wide urgent request
  hospitalId: string;
  screeningId?: string;
  type: AppointmentType;
  mode: ConsultationMode;
  date: string; // YYYY-MM-DD
  timeSlot: string; // HH:mm
  reason: string;
  urgencyNotes?: string;
  referralSource?: 'asha';
  status: AppointmentStatus;
  doctorResponseNotes?: string;
  redirectedHospitalOrDoctor?: string;
  videoRoomId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConsultationRecord {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  hospitalId: string;
  screeningId?: string;
  mode: ConsultationMode;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  clinicalObservations: string;
  consultationNotes: string;
  prescription?: string;
  recommendations: string;
  referralRecommended: boolean;
  referralDetails?: string;
  diagnosticTestsSuggested?: string[];
  followUpDate?: string;
  followUpInstructions?: string;
  sharedWithPatient: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  category:
    | 'otp'
    | 'appointment'
    | 'urgent'
    | 'report'
    | 'followup'
    | 'account'
    | 'consultation';
  relatedId?: string;
  read: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  actorRole: UserRole;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  hospitalId?: string;
  justification?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface PlatformSettings {
  consentText: string;
  requireConsentBeforeScreening: boolean;
  enableUrgentRequests: boolean;
  enableVideoConsultations: boolean;
  maxImagesPerScreening: number;
  otpExpiryMinutes: number;
  updatedAt: string;
}
