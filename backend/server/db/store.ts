import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoModels } from '../models/mongoSchemas.js';
import type {
  Appointment,
  AshaFollowup,
  AshaWorker,
  AshaWorkerRequest,
  AuditLogEntry,
  ConsultationRecord,
  DoctorProfile,
  Hospital,
  NotificationItem,
  PatientProfile,
  PlatformSettings,
  ScreeningSession,
  UserAccount,
  UserRole,
} from '../../../shared/types/index.js';

export interface DatabaseState {
  users: UserAccount[];
  hospitals: Hospital[];
  doctors: DoctorProfile[];
  patients: PatientProfile[];
  ashaWorkers: AshaWorker[];
  ashaFollowups: AshaFollowup[];
  ashaWorkerRequests: AshaWorkerRequest[];
  screenings: ScreeningSession[];
  appointments: Appointment[];
  consultations: ConsultationRecord[];
  notifications: NotificationItem[];
  auditLogs: AuditLogEntry[];
  settings: PlatformSettings;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'aarogya_drishti_db.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(path.join(UPLOADS_DIR, 'screenings'))) {
    fs.mkdirSync(path.join(UPLOADS_DIR, 'screenings'), { recursive: true });
  }
  if (!fs.existsSync(path.join(UPLOADS_DIR, 'doctor_docs'))) {
    fs.mkdirSync(path.join(UPLOADS_DIR, 'doctor_docs'), { recursive: true });
  }
}

const DEFAULT_SCHEDULE = [
  { day: 'Monday', startTime: '09:30', endTime: '13:00', slotDurationMinutes: 30, enabled: true },
  { day: 'Tuesday', startTime: '09:30', endTime: '13:00', slotDurationMinutes: 30, enabled: true },
  { day: 'Wednesday', startTime: '14:00', endTime: '17:30', slotDurationMinutes: 30, enabled: true },
  { day: 'Thursday', startTime: '09:30', endTime: '13:00', slotDurationMinutes: 30, enabled: true },
  { day: 'Friday', startTime: '10:00', endTime: '14:00', slotDurationMinutes: 30, enabled: true },
  { day: 'Saturday', startTime: '10:00', endTime: '13:00', slotDurationMinutes: 30, enabled: true },
  { day: 'Sunday', startTime: '10:00', endTime: '12:00', slotDurationMinutes: 30, enabled: false },
];

function createSeedState(): DatabaseState {
  const now = new Date().toISOString();
  const adminPass = bcrypt.hashSync('Admin@123', 10);
  const managerPass = bcrypt.hashSync('Manager@123', 10);
  const doctorPass = bcrypt.hashSync('Doctor@123', 10);

  const users: UserAccount[] = [
    {
      id: 'usr_admin_1',
      role: 'admin',
      identifier: 'admin@aarogyadrishti.org',
      name: 'Platform Administrator',
      email: 'admin@aarogyadrishti.org',
      passwordHash: adminPass,
      active: true,
      mustChangePassword: false,
      createdAt: now,
    },
    {
      id: 'usr_mgr_1',
      role: 'hospital_manager',
      identifier: 'HOSP-1001',
      name: 'Suresh Menon (Mgr)',
      email: 'manager@narayanaoral.org',
      passwordHash: managerPass,
      hospitalId: 'hosp_1',
      active: true,
      mustChangePassword: false,
      createdAt: now,
    },
    {
      id: 'usr_mgr_2',
      role: 'hospital_manager',
      identifier: 'HOSP-1002',
      name: 'Kavita Deshmukh (Mgr)',
      email: 'manager@sahyadricare.org',
      passwordHash: managerPass,
      hospitalId: 'hosp_2',
      active: true,
      mustChangePassword: false,
      createdAt: now,
    },
    {
      id: 'usr_mgr_3',
      role: 'hospital_manager',
      identifier: 'HOSP-1003',
      name: 'Rajiv Malhotra (Mgr)',
      email: 'manager@indraprasthaent.org',
      passwordHash: managerPass,
      hospitalId: 'hosp_3',
      active: true,
      mustChangePassword: false,
      createdAt: now,
    },
    {
      id: 'usr_doc_1',
      role: 'doctor',
      identifier: 'DOC-2001',
      name: 'Dr. Priya Sharma',
      email: 'priya.sharma@narayanaoral.org',
      passwordHash: doctorPass,
      hospitalId: 'hosp_1',
      doctorId: 'doc_1',
      active: true,
      mustChangePassword: false,
      createdAt: now,
    },
    {
      id: 'usr_doc_2',
      role: 'doctor',
      identifier: 'DOC-2002',
      name: 'Dr. Alok Kulkarni',
      email: 'alok.kulkarni@narayanaoral.org',
      passwordHash: doctorPass,
      hospitalId: 'hosp_1',
      doctorId: 'doc_2',
      active: true,
      mustChangePassword: false,
      createdAt: now,
    },
    {
      id: 'usr_doc_3',
      role: 'doctor',
      identifier: 'DOC-2003',
      name: 'Dr. Rohan Iyer',
      email: 'rohan.iyer@sahyadricare.org',
      passwordHash: doctorPass,
      hospitalId: 'hosp_2',
      doctorId: 'doc_3',
      active: true,
      mustChangePassword: false,
      createdAt: now,
    },
    {
      id: 'usr_doc_4',
      role: 'doctor',
      identifier: 'DOC-2004',
      name: 'Dr. Meera Nair',
      email: 'meera.nair@indraprasthaent.org',
      passwordHash: doctorPass,
      hospitalId: 'hosp_3',
      doctorId: 'doc_4',
      active: true,
      mustChangePassword: false,
      createdAt: now,
    },
  ];

  const hospitals: Hospital[] = [
    {
      id: 'hosp_1',
      hospitalCode: 'HOSP-1001',
      name: 'Bengaluru Oral & Head-Neck Centre',
      registrationNumber: 'KA-BLR-MED-2018-4491',
      address: '42 Residency Road, Ashok Nagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560025',
      latitude: 12.9716,
      longitude: 77.5946,
      phone: '+91 80 4120 7780',
      email: 'care@narayanaoral.org',
      facilities: [
        'Oral Pathology & Biopsy Suite',
        'Digital Intraoral Imaging',
        'Tele-Consultation Studio',
        '24/7 Emergency ENT Triage',
      ],
      services: [
        'Oral Cancer Screening',
        'Oral Medicine & Radiology',
        'Head & Neck Surgical Oncology',
        'Tobacco Cessation Counselling',
      ],
      workingHours: 'Mon–Sat: 08:30 AM – 07:30 PM',
      active: true,
      managerUserId: 'usr_mgr_1',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'hosp_2',
      hospitalCode: 'HOSP-1002',
      name: 'Sahyadri Maxillofacial & Dental Institute',
      registrationNumber: 'MH-MUM-REG-2020-8823',
      address: '18 Gokhale Road, Dadar West',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400028',
      latitude: 19.0178,
      longitude: 72.8478,
      phone: '+91 22 2430 9912',
      email: 'desk@sahyadricare.org',
      facilities: [
        'Mucosal Diagnostics Lab',
        'Video Consultation Wing',
        'Maxillofacial Daycare OT',
      ],
      services: [
        'Precancerous Lesion Evaluation',
        'Oral & Maxillofacial Surgery',
        'Diagnostic Biopsy & Histopathology',
      ],
      workingHours: 'Mon–Sat: 09:00 AM – 06:30 PM',
      active: true,
      managerUserId: 'usr_mgr_2',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'hosp_3',
      hospitalCode: 'HOSP-1003',
      name: 'Indraprastha ENT & Oral Oncology Clinic',
      registrationNumber: 'DL-REG-2019-3109',
      address: '74 Ring Road, Lajpat Nagar IV',
      city: 'New Delhi',
      state: 'Delhi',
      pincode: '110024',
      latitude: 28.5677,
      longitude: 77.2433,
      phone: '+91 11 4980 2210',
      email: 'support@indraprasthaent.org',
      facilities: [
        'Endoscopy & Oral Visualization',
        'Histopathology Tie-up',
        'Emergency Triage Desk',
      ],
      services: [
        'ENT & Neck Mass Evaluation',
        'Oral Submucous Fibrosis Care',
        'Video Follow-up Consultations',
      ],
      workingHours: 'Mon–Sat: 09:00 AM – 08:00 PM',
      active: true,
      managerUserId: 'usr_mgr_3',
      createdAt: now,
      updatedAt: now,
    },
  ];

  const doctors: DoctorProfile[] = [
    {
      id: 'doc_1',
      doctorCode: 'DOC-2001',
      userId: 'usr_doc_1',
      hospitalId: 'hosp_1',
      fullName: 'Dr. Priya Sharma',
      phone: '+91 98450 11223',
      email: 'priya.sharma@narayanaoral.org',
      qualifications: 'BDS, MDS (Oral Medicine & Radiology)',
      registrationNumber: 'KDC-19482-A',
      specialization: 'Oral Medicine & Precancerous Lesions',
      yearsOfExperience: 11,
      previousHospitals: 'St. John’s Medical College, Manipal Dental Hospital',
      previousWorkDetails:
        'Led community oral mucosal screening camps across Karnataka and managed leukoplakia/OSMF clinics.',
      achievements: 'Fellow, Indian Academy of Oral Medicine & Radiology (2022)',
      areasOfExpertise: [
        'White & Red Mucosal Patches',
        'Oral Submucous Fibrosis',
        'Non-healing Oral Ulcers',
        'Biopsy Triage',
      ],
      consultationFee: 600,
      onlineConsultationAvailable: true,
      inPersonConsultationAvailable: true,
      workingStatus: 'available',
      verificationStatus: 'verified',
      verificationNotes: 'Registration KDC-19482-A and MDS certificate verified by Hospital Manager.',
      documents: [
        {
          id: 'ddoc_1',
          label: 'State Dental Council Registration',
          fileName: 'KDC_Registration_19482.pdf',
          mimeType: 'application/pdf',
          filePath: '',
          uploadedAt: now,
          verified: true,
        },
      ],
      schedule: DEFAULT_SCHEDULE,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'doc_2',
      doctorCode: 'DOC-2002',
      userId: 'usr_doc_2',
      hospitalId: 'hosp_1',
      fullName: 'Dr. Alok Kulkarni',
      phone: '+91 98450 99812',
      email: 'alok.kulkarni@narayanaoral.org',
      qualifications: 'MBBS, MS (ENT), MCh (Head & Neck Oncology)',
      registrationNumber: 'KMC-54821',
      specialization: 'Head & Neck Surgical Oncology',
      yearsOfExperience: 18,
      previousHospitals: 'Kidwai Memorial Institute of Oncology',
      previousWorkDetails:
        '18 years specializing in diagnostic staging, tongue/buccal lesion excision, and reconstructive care.',
      achievements: 'Published 34 peer-reviewed studies in early oral lesion detection.',
      areasOfExpertise: [
        'Urgent Lesion Evaluation',
        'Neck Swelling & Dysphagia',
        'Diagnostic Biopsy & Staging',
      ],
      consultationFee: 1000,
      onlineConsultationAvailable: true,
      inPersonConsultationAvailable: true,
      workingStatus: 'available',
      verificationStatus: 'verified',
      verificationNotes: 'KMC-54821 and MCh Oncology credentials verified.',
      documents: [
        {
          id: 'ddoc_2',
          label: 'Medical Council Registration',
          fileName: 'KMC_54821_Cert.pdf',
          mimeType: 'application/pdf',
          filePath: '',
          uploadedAt: now,
          verified: true,
        },
      ],
      schedule: DEFAULT_SCHEDULE,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'doc_3',
      doctorCode: 'DOC-2003',
      userId: 'usr_doc_3',
      hospitalId: 'hosp_2',
      fullName: 'Dr. Rohan Iyer',
      phone: '+91 98201 44510',
      email: 'rohan.iyer@sahyadricare.org',
      qualifications: 'BDS, MDS (Oral & Maxillofacial Surgery)',
      registrationNumber: 'MSDC-33109',
      specialization: 'Oral & Maxillofacial Surgery',
      yearsOfExperience: 8,
      previousHospitals: 'KEM Hospital Mumbai',
      previousWorkDetails:
        'Managed trauma, jaw cysts, mucosal biopsies, and tobacco-associated oral lesion follow-ups.',
      achievements: 'Best Clinical Paper Award, AOMSI 2023',
      areasOfExpertise: [
        'Incisional & Excisional Biopsy',
        'Persistent Oral Ulcers',
        'Trismus & Jaw Pain',
      ],
      consultationFee: 700,
      onlineConsultationAvailable: true,
      inPersonConsultationAvailable: true,
      workingStatus: 'available',
      verificationStatus: 'verified',
      verificationNotes: 'MSDC-33109 verified.',
      documents: [],
      schedule: DEFAULT_SCHEDULE,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'doc_4',
      doctorCode: 'DOC-2004',
      userId: 'usr_doc_4',
      hospitalId: 'hosp_3',
      fullName: 'Dr. Meera Nair',
      phone: '+91 98110 77341',
      email: 'meera.nair@indraprasthaent.org',
      qualifications: 'MBBS, DNB (ENT & Head-Neck)',
      registrationNumber: 'DMC-71029',
      specialization: 'ENT & Oral Cavity Evaluation',
      yearsOfExperience: 10,
      previousHospitals: 'Safdarjung Hospital New Delhi',
      previousWorkDetails:
        'Evaluates voice changes, dysphagia, tonsillar/oropharyngeal lesions, and urgent ENT referrals.',
      achievements: 'Lead Coordinator, Delhi Tobacco Screening Initiative',
      areasOfExpertise: [
        'Voice Change & Dysphagia',
        'Oropharyngeal Screening',
        'Urgent ENT Tele-Triage',
      ],
      consultationFee: 650,
      onlineConsultationAvailable: true,
      inPersonConsultationAvailable: true,
      workingStatus: 'available',
      verificationStatus: 'pending',
      verificationNotes: 'Awaiting Hospital Manager final verification of experience certificate.',
      documents: [],
      schedule: DEFAULT_SCHEDULE,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const settings: PlatformSettings = {
    consentText:
      'I understand that Aarogya Drishti provides an AI-assisted preliminary oral health screening for educational awareness and clinical triage only. This screening does not constitute a medical diagnosis, does not confirm or rule out oral cancer, and does not replace an in-person clinical examination or biopsy by a qualified healthcare professional. I consent to the secure storage and processing of my questionnaire responses and uploaded oral photographs by the platform and any doctor I choose to consult.',
    requireConsentBeforeScreening: true,
    enableUrgentRequests: true,
    enableVideoConsultations: true,
    maxImagesPerScreening: 3,
    otpExpiryMinutes: 5,
    updatedAt: now,
  };

  const auditLogs: AuditLogEntry[] = [
    {
      id: 'aud_init_1',
      actorUserId: 'usr_admin_1',
      actorRole: 'admin',
      actorName: 'Platform Administrator',
      action: 'PLATFORM_INITIALIZED',
      targetType: 'system',
      targetId: 'aarogya_drishti',
      justification: 'Initial registered hospital and verified specialist baseline setup',
      createdAt: now,
    },
  ];

  return {
    users,
    hospitals,
    doctors,
    patients: [],
    ashaWorkers: [],
    ashaFollowups: [],
    ashaWorkerRequests: [],
    screenings: [],
    appointments: [],
    consultations: [],
    notifications: [],
    auditLogs,
    settings,
  };
}

class DataStore {
  private state: DatabaseState;
  private mongoConnected = false;

  constructor() {
    ensureDirs();
    this.state = this.loadLocal();
  }

  private loadLocal(): DatabaseState {
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseState;
        return {
          ...parsed,
          ashaWorkers: parsed.ashaWorkers || [],
          ashaFollowups: parsed.ashaFollowups || [],
          ashaWorkerRequests: parsed.ashaWorkerRequests || [],
        };
      } catch {
        const seed = createSeedState();
        this.saveLocal(seed);
        return seed;
      }
    }
    const seed = createSeedState();
    this.saveLocal(seed);
    return seed;
  }

  private saveLocal(nextState: DatabaseState) {
    ensureDirs();
    fs.writeFileSync(DB_FILE, JSON.stringify(nextState, null, 2), 'utf-8');
  }

  public async initMongoIfConfigured() {
    const uri = (process.env.MONGODB_URI || '').trim();
    if (!uri || (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://'))) {
      this.mongoConnected = false;
      return;
    }
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      this.mongoConnected = true;
      const count = await MongoModels.User.countDocuments();
      if (count === 0) {
        const seed = createSeedState();
        await Promise.all([
          MongoModels.User.insertMany(seed.users),
          MongoModels.Hospital.insertMany(seed.hospitals),
          MongoModels.Doctor.insertMany(seed.doctors),
          MongoModels.AuditLog.insertMany(seed.auditLogs),
          MongoModels.Settings.create({ key: 'default', ...seed.settings }),
        ]);
      } else {
        await this.syncFromMongo();
      }
      console.log('Connected to MongoDB for Aarogya Drishti MERN persistence.');
    } catch {
      console.log('MongoDB unreachable; using persistent local JSON store (.data/aarogya_drishti_db.json).');
      this.mongoConnected = false;
    }
  }

  private async syncFromMongo() {
    if (!this.mongoConnected) return;
    const [
      users,
      hospitals,
      doctors,
      patients,
      ashaWorkers,
      ashaFollowups,
      ashaWorkerRequests,
      screenings,
      appointments,
      consultations,
      notifications,
      auditLogs,
      settingsDoc,
    ] = await Promise.all([
      MongoModels.User.find().lean(),
      MongoModels.Hospital.find().lean(),
      MongoModels.Doctor.find().lean(),
      MongoModels.Patient.find()
        .select('+aadhaarNumberEncrypted +aadhaarCardPhotoEncrypted')
        .lean(),
      MongoModels.AshaWorker.find().lean(),
      MongoModels.AshaFollowup.find().lean(),
      MongoModels.AshaWorkerRequest.find().lean(),
      MongoModels.Screening.find().lean(),
      MongoModels.Appointment.find().lean(),
      MongoModels.Consultation.find().lean(),
      MongoModels.Notification.find().lean(),
      MongoModels.AuditLog.find().lean(),
      MongoModels.Settings.findOne({ key: 'default' }).lean(),
    ]);
    this.state = {
      users: users as unknown as UserAccount[],
      hospitals: hospitals as unknown as Hospital[],
      doctors: doctors as unknown as DoctorProfile[],
      patients: patients as unknown as PatientProfile[],
      ashaWorkers: ashaWorkers as unknown as AshaWorker[],
      ashaFollowups: ashaFollowups as unknown as AshaFollowup[],
      ashaWorkerRequests: ashaWorkerRequests as unknown as AshaWorkerRequest[],
      screenings: screenings as unknown as ScreeningSession[],
      appointments: appointments as unknown as Appointment[],
      consultations: consultations as unknown as ConsultationRecord[],
      notifications: notifications as unknown as NotificationItem[],
      auditLogs: auditLogs as unknown as AuditLogEntry[],
      settings: (settingsDoc as unknown as PlatformSettings) || this.state.settings,
    };
  }

  public getState(): DatabaseState {
    return this.state;
  }

  public persist() {
    this.saveLocal(this.state);
    if (this.mongoConnected) {
      void this.mirrorToMongo();
    }
  }

  private async mirrorToMongo() {
    try {
      const s = this.state;
      await Promise.all([
        ...s.users.map((u) => MongoModels.User.updateOne({ id: u.id }, u, { upsert: true })),
        ...s.hospitals.map((h) => MongoModels.Hospital.updateOne({ id: h.id }, h, { upsert: true })),
        ...s.doctors.map((d) => MongoModels.Doctor.updateOne({ id: d.id }, d, { upsert: true })),
        ...s.patients.map((p) => MongoModels.Patient.updateOne({ id: p.id }, p, { upsert: true })),
        ...s.ashaWorkers.map((w) => MongoModels.AshaWorker.updateOne({ id: w.id }, w, { upsert: true })),
        ...s.ashaFollowups.map((f) => MongoModels.AshaFollowup.updateOne({ id: f.id }, f, { upsert: true })),
        ...s.ashaWorkerRequests.map((r) =>
          MongoModels.AshaWorkerRequest.updateOne({ id: r.id }, r, { upsert: true })
        ),
        ...s.screenings.map((sc) => MongoModels.Screening.updateOne({ id: sc.id }, sc, { upsert: true })),
        ...s.appointments.map((a) => MongoModels.Appointment.updateOne({ id: a.id }, a, { upsert: true })),
        ...s.consultations.map((c) => MongoModels.Consultation.updateOne({ id: c.id }, c, { upsert: true })),
        ...s.notifications.map((n) => MongoModels.Notification.updateOne({ id: n.id }, n, { upsert: true })),
        ...s.auditLogs.map((l) => MongoModels.AuditLog.updateOne({ id: l.id }, l, { upsert: true })),
        MongoModels.Settings.updateOne({ key: 'default' }, { key: 'default', ...s.settings }, { upsert: true }),
      ]);
    } catch (err) {
      console.error('MongoDB sync error:', err);
    }
  }

  public addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): AuditLogEntry {
    const log: AuditLogEntry = {
      ...entry,
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    this.state.auditLogs.unshift(log);
    if (this.state.auditLogs.length > 2000) {
      this.state.auditLogs = this.state.auditLogs.slice(0, 2000);
    }
    this.persist();
    return log;
  }

  public createNotification(
    item: Omit<NotificationItem, 'id' | 'read' | 'createdAt'>,
    pushFn?: (userId: string, payload: unknown) => void
  ): NotificationItem {
    const notification: NotificationItem = {
      ...item,
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.state.notifications.unshift(notification);
    this.persist();
    if (pushFn) {
      pushFn(notification.userId, { type: 'notification', notification });
    }
    return notification;
  }

  public isMongoActive(): boolean {
    return this.mongoConnected;
  }
}

export const dbStore = new DataStore();
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeString(val: unknown, maxLen = 1000): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

export function findUserByIdentifier(identifier: string, role?: UserRole): UserAccount | undefined {
  const clean = identifier.trim().toLowerCase();
  return dbStore.getState().users.find(
    (u) =>
      (!role || u.role === role) &&
      (u.identifier.toLowerCase() === clean ||
        (u.email && u.email.toLowerCase() === clean) ||
        (u.mobile && u.mobile === identifier.trim()))
  );
}
