import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  Calendar,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileText,
  HeartPulse,
  History,
  Hospital,
  Mic,
  MapPin,
  Printer,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
  User,
  Users,
  Video,
  Volume2,
} from 'lucide-react';
import { apiRequest, authenticatedFileUrl } from '../../utils/api.js';
import type {
  Appointment,
  AshaFollowup,
  AshaWorker,
  AshaWorkerRequest,
  ConsultationRecord,
  PatientProfile,
  ScreeningQuestionnaire,
  ScreeningSession,
} from '../../../../shared/types/index.js';
import {
  HospitalDiscovery,
  type DiscoveredDoctor,
  type DiscoveredHospital,
} from '../HospitalDiscovery.js';
import { VideoConsultationRoom } from '../VideoConsultationRoom.js';
import { VoiceDictationButton } from '../VoiceDictationButton.js';
import type { WsSignalMessage } from '../../hooks/useWebSocket.js';
import { SignatureCard, getVariantByIndex } from '../ui/SignatureCard.js';
import {
  getAgeCategory,
  getAgeCategoryLabel,
  getAgeFromDateOfBirth,
  PATIENT_AGE_CATEGORIES,
} from '../../../../shared/utils/ageClassification.js';

interface PatientDashboardProps {
  userName: string;
  activeTab: string;
  onChangeTab: (tab: string) => void;
  sendWsMessage: (payload: Record<string, unknown>) => void;
  lastSignalMessage: WsSignalMessage | null;
}

interface PatientAppointmentView extends Appointment {
  hospitalName: string;
  hospitalAddress: string;
  hospitalPhone: string;
  doctorName: string;
  doctorSpecialization: string;
  doctorVerified: boolean;
  consultation: ConsultationRecord | null;
}

interface PatientConsultationView extends ConsultationRecord {
  doctorName: string;
  doctorSpecialization: string;
  hospitalName: string;
}

interface PendingUploadImage {
  file: File;
  previewUrl: string;
  oralRegion: string;
}

const INITIAL_QUESTIONNAIRE: ScreeningQuestionnaire = {
  age: undefined,
  gender: 'prefer_not_to_say',
  generalLocation: '',
  previousOralProblems: '',
  usesTobacco: 'no',
  tobaccoTypes: [],
  tobaccoFrequencyDuration: '',
  consumesAlcohol: 'no',
  alcoholFrequencyDuration: '',
  chewsBetelOrArecaNut: 'no',
  betelFrequencyDuration: '',
  symptoms: {
    whitePatches: false,
    redPatches: false,
    nonHealingUlcers: false,
    unusualGrowthsOrLumps: false,
    difficultyOpeningMouth: false,
    difficultySwallowing: false,
    painWhileChewing: false,
    bleedingInsideMouth: false,
    persistentPainOrNumbness: false,
    voiceChangeOrNeckSwelling: false,
  },
  symptomDuration: 'Less than one week',
  otherSymptomsDescription: '',
  severeOrRapidlyWorsening: false,
};

const ORAL_REGIONS = [
  'Tongue',
  'Inner Cheeks (Buccal Mucosa)',
  'Gums (Gingiva)',
  'Lips',
  'Floor of the Mouth',
  'Roof of the Mouth (Palate)',
  'Other Affected Area',
];

const TOBACCO_TYPE_OPTIONS = [
  'Cigarettes',
  'Cigars / Bidi',
  'Chewing Tobacco',
  'Gutka',
  'Khaini',
  'Pan Masala with Tobacco',
  'Other',
];

function RiskBadgeText({ category }: { category?: string }) {
  if (!category) return <span className="text-slate-500">Pending</span>;
  const colorMap: Record<string, string> = {
    'Low Risk': 'text-emerald-700',
    'Moderate Risk': 'text-amber-700',
    'High Risk': 'text-orange-700',
    'Urgent Clinical Evaluation Recommended': 'text-red-700',
  };
  return (
    <span className={`font-semibold ${colorMap[category] || 'text-slate-800'}`}>{category}</span>
  );
}

export function PatientDashboard({
  userName,
  activeTab,
  onChangeTab,
  sendWsMessage,
  lastSignalMessage,
}: PatientDashboardProps) {
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [screenings, setScreenings] = useState<ScreeningSession[]>([]);
  const [appointments, setAppointments] = useState<PatientAppointmentView[]>([]);
  const [consultations, setConsultations] = useState<PatientConsultationView[]>([]);
  const [ashaCare, setAshaCare] = useState<{
    ashaWorkers: Array<
      Pick<AshaWorker, 'id' | 'fullName' | 'phone' | 'village' | 'mandal'> & {
        hospitalName: string;
      }
    >;
    followups: Array<AshaFollowup & { ashaWorkerName: string }>;
    request: Pick<AshaWorkerRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'> | null;
  }>({ ashaWorkers: [], followups: [], request: null });
  const [ashaRequestSubmitting, setAshaRequestSubmitting] = useState(false);
  const [ashaRequestError, setAshaRequestError] = useState<string | null>(null);
  const [ashaRequestFormOpen, setAshaRequestFormOpen] = useState(false);
  const [ashaRequestFacilities, setAshaRequestFacilities] = useState<
    Array<{ id: string; name: string; city: string; state: string }>
  >([]);
  const [ashaRequestHospitalId, setAshaRequestHospitalId] = useState('');
  const [ashaFacilitiesLoading, setAshaFacilitiesLoading] = useState(false);
  const [consentText, setConsentText] = useState('');
  const [loading, setLoading] = useState(true);

  // Screening Wizard State
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [questionnaire, setQuestionnaire] = useState<ScreeningQuestionnaire>(INITIAL_QUESTIONNAIRE);
  const [pendingImages, setPendingImages] = useState<(PendingUploadImage | null)[]>([]);
  const stagedImages = pendingImages.filter(
    (image): image is PendingUploadImage => image !== null
  );
  const stagedImage = pendingImages[0] ?? null;
  const hasCompletedPriorStages = (slotIndex: number) =>
    pendingImages.length >= slotIndex &&
    pendingImages.slice(0, slotIndex).every(Boolean);
  const [selectedRegion, setSelectedRegion] = useState(ORAL_REGIONS[0]);
  const [submittingScreening, setSubmittingScreening] = useState(false);
  const [screeningError, setScreeningError] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<ScreeningSession | null>(null);

  // Live Camera Capture State
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraTargetIndex, setCameraTargetIndex] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Booking / Urgent Modals
  const [bookingContext, setBookingContext] = useState<{
    hospital: DiscoveredHospital;
    doctor: DiscoveredDoctor;
  } | null>(null);
  const [bookingDate, setBookingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bookingSlots, setBookingSlots] = useState<Array<{ time: string; available: boolean }>>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [bookingMode, setBookingMode] = useState<'video' | 'in_person'>('video');
  const [bookingReason, setBookingReason] = useState('');
  const [bookingScreeningId, setBookingScreeningId] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingFeedback, setBookingFeedback] = useState<string | null>(null);

  const [urgentContext, setUrgentContext] = useState<{
    hospital: DiscoveredHospital;
    doctor?: DiscoveredDoctor;
  } | null>(null);
  const [urgentReason, setUrgentReason] = useState('');
  const [urgentMode, setUrgentMode] = useState<'video' | 'in_person'>('video');
  const [urgentScreeningId, setUrgentScreeningId] = useState('');

  // Video Consultation Room State
  const [activeCallAppointment, setActiveCallAppointment] =
    useState<PatientAppointmentView | null>(null);

  // Profile form state
  const [profileSavedMsg, setProfileSavedMsg] = useState<string | null>(null);
  const [ageClassificationMsg, setAgeClassificationMsg] = useState<string | null>(null);

  // Report TTS Audio state
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Voice Auto-Fill Symptom Intake state
  const [intakeRecording, setIntakeRecording] = useState(false);
  const [intakeExtracting, setIntakeExtracting] = useState(false);
  const [intakeFeedback, setIntakeFeedback] = useState<{
    transcript: string;
    highlights: string[];
  } | null>(null);
  const intakeRecorderRef = useRef<MediaRecorder | null>(null);
  const intakeChunksRef = useRef<Blob[]>([]);

  const stopReportAudio = () => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    setTtsPlaying(false);
  };

  useEffect(() => {
    return () => {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      if (intakeRecorderRef.current && intakeRecorderRef.current.state !== 'inactive') {
        intakeRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const handleToggleVoiceIntake = async () => {
    if (intakeRecording) {
      intakeRecorderRef.current?.stop();
      setIntakeRecording(false);
      return;
    }

    setScreeningError(null);
    setIntakeFeedback(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      intakeChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) intakeChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(intakeChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size === 0) return;
        setIntakeExtracting(true);
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'symptom_intake.webm');
          const res = await apiRequest<{
            transcript: string;
            extractedFields: Partial<ScreeningQuestionnaire> & {
              detectedHighlights?: string[];
            };
          }>('/api/voice/intake-extract', { method: 'POST', body: fd });

          const ext = res.extractedFields || {};
          setQuestionnaire((prev) => ({
            ...prev,
            ...(typeof ext.age === 'number' ? { age: ext.age } : {}),
            ...(ext.gender ? { gender: ext.gender } : {}),
            ...(ext.generalLocation ? { generalLocation: ext.generalLocation } : {}),
            ...(ext.usesTobacco ? { usesTobacco: ext.usesTobacco } : {}),
            ...(Array.isArray(ext.tobaccoTypes) && ext.tobaccoTypes.length > 0
              ? { tobaccoTypes: ext.tobaccoTypes }
              : {}),
            ...(ext.tobaccoFrequencyDuration
              ? { tobaccoFrequencyDuration: ext.tobaccoFrequencyDuration }
              : {}),
            ...(ext.consumesAlcohol ? { consumesAlcohol: ext.consumesAlcohol } : {}),
            ...(ext.chewsBetelOrArecaNut
              ? { chewsBetelOrArecaNut: ext.chewsBetelOrArecaNut }
              : {}),
            ...(ext.betelFrequencyDuration
              ? { betelFrequencyDuration: ext.betelFrequencyDuration }
              : {}),
            ...(ext.symptomDuration ? { symptomDuration: ext.symptomDuration } : {}),
            ...(ext.otherSymptomsDescription
              ? { otherSymptomsDescription: ext.otherSymptomsDescription }
              : {}),
            ...(typeof ext.severeOrRapidlyWorsening === 'boolean'
              ? { severeOrRapidlyWorsening: ext.severeOrRapidlyWorsening }
              : {}),
            symptoms: {
              ...prev.symptoms,
              ...(ext.symptoms || {}),
            },
          }));
          setIntakeFeedback({
            transcript: res.transcript,
            highlights: ext.detectedHighlights || [],
          });
        } catch (err) {
          setScreeningError(
            err instanceof Error ? err.message : 'Unable to extract symptoms from voice.'
          );
        } finally {
          setIntakeExtracting(false);
        }
      };
      intakeRecorderRef.current = recorder;
      recorder.start();
      setIntakeRecording(true);
    } catch {
      setScreeningError('Microphone permission denied. You can fill out the form manually.');
    }
  };

  const handleToggleReportAudio = async (session: ScreeningSession) => {
    if (ttsPlaying) {
      stopReportAudio();
      return;
    }
    if (!session.aiReport) return;

    setTtsError(null);
    setTtsLoading(true);
    try {
      const r = session.aiReport;
      const summaryText =
        r.imageQuality === 'inadequate'
          ? `Aarogya Drishti Preliminary Screening Notice. Photo clarity was insufficient for reliable review. ${r.imageQualityReason}. Please upload a clearer, brightly lit photograph.`
          : `Aarogya Drishti Preliminary Screening Summary. Region reviewed: ${r.reportedOralRegion}. Preliminary triage category: ${r.preliminaryRiskCategory}. ${r.urgencyOfAssessment}. Key findings: ${r.riskExplanation}. Recommended next steps: ${r.recommendedNextSteps.join('. ')}. Remember, this preliminary screening does not diagnose cancer and cannot replace an evaluation by a qualified specialist.`;

      const res = await apiRequest<{ audioBase64: string; mimeType: string }>('/api/voice/tts', {
        method: 'POST',
        body: JSON.stringify({ text: summaryText }),
      });

      const audio = new Audio(`data:${res.mimeType || 'audio/wav'};base64,${res.audioBase64}`);
      ttsAudioRef.current = audio;
      audio.onended = () => {
        setTtsPlaying(false);
        ttsAudioRef.current = null;
      };
      audio.onerror = () => {
        setTtsPlaying(false);
        setTtsError('Unable to play synthesized audio.');
      };
      setTtsPlaying(true);
      await audio.play();
    } catch (err) {
      setTtsPlaying(false);
      setTtsError(err instanceof Error ? err.message : 'Unable to synthesize speech.');
    } finally {
      setTtsLoading(false);
    }
  };

  const loadAllPatientData = async () => {
    setLoading(true);
    try {
      const [profRes, scrRes, aptRes, consRes, pubRes, ashaRes] = await Promise.all([
        apiRequest<{ patient: PatientProfile }>('/api/patient/profile'),
        apiRequest<{ screenings: ScreeningSession[] }>('/api/patient/screenings'),
        apiRequest<{ appointments: PatientAppointmentView[] }>('/api/patient/appointments'),
        apiRequest<{ consultations: PatientConsultationView[] }>('/api/patient/consultations'),
        apiRequest<{ consentText: string }>('/api/public/settings'),
        apiRequest<typeof ashaCare>('/api/patient/asha-followups'),
      ]);
      setProfile(profRes.patient);
      setScreenings(scrRes.screenings || []);
      setAppointments(aptRes.appointments || []);
      setConsultations(consRes.consultations || []);
      setConsentText(pubRes.consentText);
      setAshaCare(ashaRes);
      if (scrRes.screenings?.[0]) {
        setBookingScreeningId(scrRes.screenings[0].id);
        setUrgentScreeningId(scrRes.screenings[0].id);
      }
    } catch {
      // handled per section
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAllPatientData();
  }, []);

  useEffect(() => {
    if (lastSignalMessage?.type === 'asha-update') void loadAllPatientData();
  }, [lastSignalMessage]);

  // Load slots when booking doctor or date changes
  useEffect(() => {
    if (!bookingContext || !bookingDate) return;
    setSelectedSlot('');
    apiRequest<{ slots: Array<{ time: string; available: boolean }> }>(
      `/api/patient/doctors/${bookingContext.doctor.id}/slots?date=${bookingDate}`
    )
      .then((res) => setBookingSlots(res.slots || []))
      .catch(() => setBookingSlots([]));
  }, [bookingContext, bookingDate]);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
    setCameraTargetIndex(null);
  };

  const startCamera = async (targetIndex: number) => {
    setScreeningError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraTargetIndex(targetIndex);
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    } catch (error) {
      setScreeningError(
        error instanceof Error && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name)
          ? 'Camera permission is blocked. Allow camera access in your browser settings, or upload a photo.'
          : 'Unable to access device camera. Please upload a photo file instead.'
      );
    }
  };

  const capturePhotoFromCamera = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `oral_capture_${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
      const targetIndex = cameraTargetIndex ?? 0;
      const image = {
        file,
        previewUrl: URL.createObjectURL(file),
        oralRegion: selectedRegion,
      };
      if (!hasCompletedPriorStages(targetIndex)) {
        URL.revokeObjectURL(image.previewUrl);
        setScreeningError('Complete the previous photo stage before capturing this one.');
        stopCamera();
        return;
      }
      const previousImage = pendingImages[targetIndex];
      if (previousImage) URL.revokeObjectURL(previousImage.previewUrl);
      setPendingImages((prev) => {
        const next = [...prev];
        while (next.length <= targetIndex) next.push(null);
        next[targetIndex] = image;
        return next;
      });
        stopCamera();
      },
      'image/jpeg',
      0.9
    );
  };

  const handleImageFileSelectAtSlot = (
    e: ChangeEvent<HTMLInputElement>,
    slotIndex: number
  ) => {
    const file = e.target.files?.[0];
    setScreeningError(null);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setScreeningError('Only JPG, PNG, or WEBP photos are supported.');
      e.target.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setScreeningError('Each image must be smaller than 8 MB.');
      e.target.value = '';
      return;
    }
    if (!hasCompletedPriorStages(slotIndex)) {
      setScreeningError('Complete the previous photo stage before adding this one.');
      e.target.value = '';
      return;
    }

    const previousImage = pendingImages[slotIndex];
    if (previousImage) URL.revokeObjectURL(previousImage.previewUrl);
    const image = {
      file,
      previewUrl: URL.createObjectURL(file),
      oralRegion: selectedRegion,
    };
    setPendingImages((prev) => {
      const next = [...prev];
      while (next.length <= slotIndex) next.push(null);
      next[slotIndex] = image;
      return next;
    });
    e.target.value = '';
  };

  const removeStagedImage = (slotIndex: number) => {
    const image = pendingImages[slotIndex];
    if (image) URL.revokeObjectURL(image.previewUrl);
    setPendingImages((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  };

  const submitScreening = async () => {
    if (stagedImages.length === 0) {
      setScreeningError('Please capture or upload at least one oral photograph.');
      return;
    }
    setSubmittingScreening(true);
    setScreeningError(null);
    try {
      const formData = new FormData();
      formData.append('consentAccepted', String(consentAccepted));
      formData.append('questionnaire', JSON.stringify(questionnaire));
      formData.append(
        'regions',
        JSON.stringify(stagedImages.map((img) => img.oralRegion))
      );
      for (const img of stagedImages) {
        formData.append('images', img.file);
      }

      const res = await apiRequest<{ screening: ScreeningSession }>(
        '/api/patient/screenings',
        {
          method: 'POST',
          body: formData,
        }
      );
      setActiveReport(res.screening);
      setWizardStep(4);
      setPendingImages([]);
      await loadAllPatientData();
    } catch (err) {
      setScreeningError(
        err instanceof Error ? err.message : 'Unable to analyze screening images.'
      );
    } finally {
      setSubmittingScreening(false);
    }
  };

  const handleRetakeImages = async (screeningId: string) => {
    if (stagedImages.length === 0) {
      setScreeningError('Please upload a clearer replacement photograph first.');
      return;
    }
    setSubmittingScreening(true);
    setScreeningError(null);
    try {
      const formData = new FormData();
      formData.append(
        'regions',
        JSON.stringify(stagedImages.map((img) => img.oralRegion))
      );
      for (const img of stagedImages) {
        formData.append('images', img.file);
      }
      const res = await apiRequest<{ screening: ScreeningSession }>(
        `/api/patient/screenings/${screeningId}/retake`,
        {
          method: 'POST',
          body: formData,
        }
      );
      setActiveReport(res.screening);
      setPendingImages([]);
      await loadAllPatientData();
    } catch (err) {
      setScreeningError(err instanceof Error ? err.message : 'Failed to analyze replacement photo.');
    } finally {
      setSubmittingScreening(false);
    }
  };

  const openAppointmentFinder = () => {
    onChangeTab('discover');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleConfirmBooking = async (e: FormEvent) => {
    e.preventDefault();
    if (!bookingContext || !selectedSlot) return;
    setBookingLoading(true);
    setBookingFeedback(null);
    try {
      await apiRequest('/api/patient/appointments', {
        method: 'POST',
        body: JSON.stringify({
          hospitalId: bookingContext.hospital.id,
          doctorId: bookingContext.doctor.id,
          screeningId: bookingScreeningId || undefined,
          type: 'normal',
          mode: bookingMode,
          date: bookingDate,
          timeSlot: selectedSlot,
          reason: bookingReason || 'Preliminary oral screening consultation',
        }),
      });
      setBookingContext(null);
      setBookingReason('');
      await loadAllPatientData();
      onChangeTab('appointments');
    } catch (err) {
      setBookingFeedback(err instanceof Error ? err.message : 'Unable to book slot.');
    } finally {
      setBookingLoading(false);
    }
  };

  const handleSubmitUrgent = async (e: FormEvent) => {
    e.preventDefault();
    if (!urgentContext) return;
    setBookingLoading(true);
    setBookingFeedback(null);
    try {
      await apiRequest('/api/patient/appointments', {
        method: 'POST',
        body: JSON.stringify({
          hospitalId: urgentContext.hospital.id,
          doctorId: urgentContext.doctor?.id,
          screeningId: urgentScreeningId || undefined,
          type: 'urgent',
          mode: urgentMode,
          reason: urgentReason,
        }),
      });
      setUrgentContext(null);
      setUrgentReason('');
      await loadAllPatientData();
      onChangeTab('appointments');
    } catch (err) {
      setBookingFeedback(err instanceof Error ? err.message : 'Unable to submit urgent request.');
    } finally {
      setBookingLoading(false);
    }
  };

  const handleCancelAppointment = async (id: string) => {
    try {
      await apiRequest(`/api/patient/appointments/${id}/cancel`, { method: 'PATCH' });
      await loadAllPatientData();
    } catch {
      // ignore
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setProfileSavedMsg(null);
    setAshaRequestError(null);
    try {
      const res = await apiRequest<{ patient: PatientProfile }>('/api/patient/profile', {
        method: 'PUT',
        body: JSON.stringify(profile),
      });
      setProfile(res.patient);
      try {
        const ashaRes = await apiRequest<typeof ashaCare>('/api/patient/asha-followups');
        setAshaCare(ashaRes);
      } catch {
        setAshaRequestError('Profile updated, but ASHA assignment status could not be refreshed.');
      }
      setProfileSavedMsg('Personal profile updated.');
    } catch (err) {
      setProfileSavedMsg(err instanceof Error ? err.message : 'Failed to save profile.');
    }
  };

  const handleRequestAshaWorker = async () => {
    setAshaRequestError(null);
    if (!ashaRequestHospitalId) {
      setAshaRequestError('Choose a PHC/Hospital for your request.');
      return;
    }
    setAshaRequestSubmitting(true);
    try {
      const result = await apiRequest<{ request: NonNullable<typeof ashaCare.request> }>(
        '/api/patient/asha-requests',
        {
          method: 'POST',
          body: JSON.stringify({ hospitalId: ashaRequestHospitalId }),
        }
      );
      setAshaCare((current) => ({ ...current, request: result.request }));
      setAshaRequestFormOpen(false);
    } catch (error) {
      setAshaRequestError(
        error instanceof Error ? error.message : 'Unable to request an ASHA Worker.'
      );
    } finally {
      setAshaRequestSubmitting(false);
    }
  };

  const openAshaRequestForm = async () => {
    setAshaRequestError(null);
    setAshaFacilitiesLoading(true);
    try {
      const result = await apiRequest<{
        hospitals: Array<{ id: string; name: string; city: string; state: string }>;
      }>('/api/patient/discover');
      setAshaRequestFacilities(result.hospitals || []);
      setAshaRequestHospitalId('');
      setAshaRequestFormOpen(true);
    } catch (error) {
      setAshaRequestError(
        error instanceof Error ? error.message : 'Unable to load PHC/Hospital options.'
      );
    } finally {
      setAshaFacilitiesLoading(false);
    }
  };

  const handleSaveAgeClassification = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setAgeClassificationMsg(null);

    const age = getAgeFromDateOfBirth(profile.dateOfBirth || '');
    const recommendedCategory = age === null ? null : getAgeCategory(age);
    if (age === null || !recommendedCategory) {
      setAgeClassificationMsg('Enter a valid date of birth that is not in the future.');
      return;
    }
    if (!profile.ageCategory) {
      setAgeClassificationMsg('Select an age category to continue.');
      return;
    }
    if (profile.ageCategory !== recommendedCategory) {
      setAgeClassificationMsg(
        `Based on your date of birth, the recommended category is ${getAgeCategoryLabel(
          recommendedCategory
        )}. Please select it before saving.`
      );
      return;
    }

    try {
      const res = await apiRequest<{ patient: PatientProfile }>('/api/patient/profile', {
        method: 'PUT',
        body: JSON.stringify({
          dateOfBirth: profile.dateOfBirth,
          ageCategory: profile.ageCategory,
        }),
      });
      setProfile(res.patient);
      setAgeClassificationMsg('Age classification saved to your patient profile.');
    } catch (error) {
      setAgeClassificationMsg(
        error instanceof Error ? error.message : 'Unable to save age classification.'
      );
    }
  };

  const calculatedProfileAge = profile?.dateOfBirth
    ? getAgeFromDateOfBirth(profile.dateOfBirth)
    : null;
  const recommendedAgeCategory =
    calculatedProfileAge === null ? null : getAgeCategory(calculatedProfileAge);

  const latestScreening = screenings[0];
  const upcomingCount = appointments.filter((a) => a.status === 'accepted').length;

  return (
    <div className="space-y-6">
      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <SignatureCard
            variant="teal"
            topRightBadge="Patient Portal"
            icon={<HeartPulse className="w-6 h-6" />}
            pillLabel="Aarogya Drishti Care"
            title={`Welcome, ${profile?.fullName || userName}`}
            meta="Complete an AI-assisted preliminary oral screening, track your chronological history, or connect with verified specialists."
            tags={['Private Health Vault', 'AI Triage Support', 'Verified Specialists']}
            metrics={[
              { value: screenings.length, label: 'Screenings' },
              { value: upcomingCount, label: 'Upcoming' },
              { value: consultations.length, label: 'Doctor Notes' },
            ]}
            footer={{
              label: 'Guided oral screening',
              value: 'AI-assisted intake takes ~3 minutes',
              dotTone: 'emerald',
              ctaLabel: 'Start Oral Screening',
              onCtaClick: () => {
                setWizardStep(1);
                setActiveReport(null);
                onChangeTab('screening');
              },
            }}
          />

          <SignatureCard
            variant="navy"
            topRightBadge={getAgeCategoryLabel(profile?.ageCategory)}
            icon={<Users className="w-6 h-6" />}
            pillLabel="Patient Age Classification"
            title="Age Classification"
            meta="Confirm your date of birth and age group. Your selected category is saved to your patient profile."
            metrics={[
              { value: calculatedProfileAge ?? '—', label: 'Calculated Age' },
              { value: profile?.dateOfBirth || 'Not provided', label: 'Date of Birth' },
              {
                value: getAgeCategoryLabel(profile?.ageCategory),
                label: 'Selected Category',
              },
            ]}
            footer={{
              label: 'Recommended category',
              value: getAgeCategoryLabel(recommendedAgeCategory ?? undefined),
              ctaLabel: 'Age Classification',
              onCtaClick: () => onChangeTab('age-classification'),
            }}
          />

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <SignatureCard
              variant="teal"
              topRightBadge="Records"
              icon={<FileText className="w-6 h-6" />}
              pillLabel="Screening Vault"
              title={`${screenings.length} Completed`}
              meta="Structured AI triage sessions"
              metrics={[
                { value: screenings.length, label: 'Total' },
                { value: screenings[0]?.reportCode || '—', label: 'Latest ID' },
                { value: 'Private', label: 'Access' },
              ]}
              footer={{
                label: 'Chronological log',
                value: `${screenings.length} saved session(s)`,
                ctaLabel: 'History',
                onCtaClick: () => onChangeTab('history'),
              }}
            />

            <SignatureCard
              variant="saffron"
              topRightBadge="Triage Status"
              icon={<ShieldAlert className="w-6 h-6" />}
              pillLabel="Latest Preliminary Status"
              title={
                <RiskBadgeText
                  category={latestScreening?.aiReport?.preliminaryRiskCategory}
                />
              }
              meta={
                latestScreening
                  ? `${latestScreening.reportCode} · ${new Date(
                      latestScreening.createdAt
                    ).toLocaleDateString()}`
                  : 'No completed oral screening yet'
              }
              metrics={[
                {
                  value: latestScreening?.aiReport?.imageQuality || '—',
                  label: 'Photo',
                },
                {
                  value: latestScreening?.aiReport?.reportedOralRegion
                    ? latestScreening.aiReport.reportedOralRegion.split(' ')[0]
                    : '—',
                  label: 'Region',
                },
                {
                  value: latestScreening ? 'Ready' : 'New',
                  label: 'Report',
                },
              ]}
              footer={{
                label: 'Preliminary status',
                value:
                  latestScreening?.aiReport?.preliminaryRiskCategory ||
                  'Start first screening',
                dotTone:
                  latestScreening?.aiReport?.preliminaryRiskCategory?.includes('Urgent') ||
                  latestScreening?.aiReport?.preliminaryRiskCategory?.includes('High')
                    ? 'rose'
                    : latestScreening?.aiReport?.preliminaryRiskCategory?.includes('Moderate')
                    ? 'amber'
                    : 'emerald',
                ctaLabel: latestScreening ? 'Open' : 'Start',
                onCtaClick: () => {
                  if (latestScreening) {
                    setActiveReport(latestScreening);
                    setWizardStep(4);
                  } else {
                    setWizardStep(1);
                    setActiveReport(null);
                  }
                  onChangeTab('screening');
                },
              }}
            />

            <SignatureCard
              variant="navy"
              topRightBadge="Consults"
              icon={<Calendar className="w-6 h-6" />}
              pillLabel="Scheduled Care"
              title={`${upcomingCount} Upcoming`}
              meta="Confirmed video & hospital visits"
              metrics={[
                { value: upcomingCount, label: 'Accepted' },
                {
                  value: appointments.filter((a) => a.status === 'pending').length,
                  label: 'Pending',
                },
                { value: appointments.length, label: 'Total' },
              ]}
              footer={{
                label: 'Consultation queue',
                value: `${appointments.length} total booking(s)`,
                ctaLabel: 'Manage',
                onCtaClick: () => onChangeTab('appointments'),
              }}
            />

            <SignatureCard
              variant="teal"
              topRightBadge="Follow-Ups"
              icon={<ClipboardList className="w-6 h-6" />}
              pillLabel="Specialist Notes"
              title={`${consultations.length} Notes`}
              meta="Clinical advice & follow-up plans"
              metrics={[
                { value: consultations.length, label: 'Notes' },
                {
                  value: consultations.filter((c) => c.followUpDate).length,
                  label: 'Follow-ups',
                },
                { value: 'Verified', label: 'Doctors' },
              ]}
              footer={{
                label: 'Doctor recommendations',
                value: `${consultations.length} clinical record(s)`,
                ctaLabel: 'View',
                onCtaClick: () => onChangeTab('history'),
              }}
            />
          </div>

          {/* Recent Screening or Quick Start */}
          <div className="grid lg:grid-cols-2 gap-6">
            <SignatureCard
              variant="navy"
              topRightBadge={latestScreening?.reportCode || 'New'}
              icon={<FileText className="w-6 h-6" />}
              pillLabel="Preliminary Screening"
              title="Latest Screening Summary"
              meta={
                latestScreening
                  ? `${latestScreening.reportCode} · ${new Date(
                      latestScreening.createdAt
                    ).toLocaleDateString()}`
                  : 'Complete a guided 4-step screening anytime'
              }
              footer={{
                label: 'Chronological vault',
                value: latestScreening
                  ? latestScreening.aiReport?.preliminaryRiskCategory || 'Report saved'
                  : 'No screenings yet',
                ctaLabel: 'View All History',
                onCtaClick: () => onChangeTab('history'),
              }}
            >
              {loading ? (
                <p className="text-sm text-gray-500">Loading your records...</p>
              ) : latestScreening ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-800">
                    Category:{' '}
                    <RiskBadgeText
                      category={latestScreening.aiReport?.preliminaryRiskCategory}
                    />
                  </p>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {latestScreening.aiReport?.riskExplanation ||
                      'Awaiting clear photograph upload.'}
                  </p>
                  <div className="pt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveReport(latestScreening);
                        setWizardStep(4);
                        onChangeTab('screening');
                      }}
                      className="px-3.5 py-2 text-xs font-semibold border border-gray-200 bg-white rounded-xl hover:bg-gray-50 cursor-pointer"
                    >
                      Open Full Report
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeTab('discover')}
                      className="ad-btn-teal px-3.5 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer"
                    >
                      Find Nearby Doctors
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-4 text-center space-y-3">
                  <p className="text-sm text-gray-600">
                    You have not completed an oral screening yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => onChangeTab('screening')}
                    className="ad-btn-teal px-4 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer"
                  >
                    Begin First Screening
                  </button>
                </div>
              )}
            </SignatureCard>

            <SignatureCard
              variant="saffron"
              topRightBadge={`${appointments.length} Total`}
              icon={<Video className="w-6 h-6" />}
              pillLabel="Tele-Consultation"
              title="Appointments & Video Calls"
              meta="Connect with verified hospital specialists online or in person"
              footer={{
                label: 'Appointment tracker',
                value: `${upcomingCount} confirmed visit(s)`,
                ctaLabel: 'Manage Appointments',
                onCtaClick: () => onChangeTab('appointments'),
              }}
            >
              {appointments.length === 0 ? (
                <div className="py-4 text-center space-y-3">
                  <p className="text-sm text-gray-600">No appointments scheduled yet.</p>
                  <button
                    type="button"
                    onClick={() => onChangeTab('discover')}
                    className="px-4 py-2 text-xs font-semibold border border-gray-200 bg-white rounded-xl hover:bg-gray-50 cursor-pointer"
                  >
                    Browse Registered Hospitals
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {appointments.slice(0, 3).map((apt) => (
                    <div
                      key={apt.id}
                      className="p-3.5 rounded-2xl border border-gray-200/80 bg-[#FBFBFA] flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {apt.doctorName}
                        </p>
                        <p className="text-xs text-gray-500 tabular-nums truncate">
                          {apt.hospitalName} · {apt.date} at {apt.timeSlot} ·{' '}
                          <span className="capitalize font-medium text-gray-700">
                            {apt.status}
                          </span>
                        </p>
                      </div>
                      {apt.status === 'accepted' && apt.mode === 'video' && (
                        <button
                          type="button"
                          onClick={() => setActiveCallAppointment(apt)}
                          className="ad-btn-teal inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-xl cursor-pointer shrink-0"
                        >
                          <Video className="w-3.5 h-3.5" />
                          Join Call
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SignatureCard>
          </div>
        </div>
      )}

      {/* START ORAL SCREENING WIZARD */}
      {activeTab === 'screening' && (
        <div className="space-y-6 max-w-4xl">
          <SignatureCard
            variant="teal"
            topRightBadge={`Step 0${wizardStep} / 04`}
            icon={<ClipboardList className="w-6 h-6" />}
            pillLabel="Guided Clinical Pathway"
            title="Preliminary Oral Screening & AI Triage"
            meta="Follow the 4 guided steps carefully for a structured preliminary observation report"
          >
            {/* Stepper */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              {[
                [1, '01. Consent'],
                [2, '02. Questionnaire'],
                [3, '03. Oral Photo'],
                [4, '04. Preliminary Report'],
              ].map(([stepNum, label]) => {
                const isActive = wizardStep === stepNum;
                const isDone = wizardStep > Number(stepNum);
                return (
                  <span
                    key={String(stepNum)}
                    className={`px-3 py-1.5 rounded-full border transition-colors ${
                      isActive
                        ? 'bg-[#0D5C58] text-white border-[#0D5C58] shadow-xs'
                        : isDone
                        ? 'bg-[#ECFDF5] text-[#0D5C58] border-emerald-200'
                        : 'bg-[#FBFBFA] text-gray-400 border-gray-200'
                    }`}
                  >
                    {label}
                  </span>
                );
              })}
            </div>

            {screeningError && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800">
                {screeningError}
              </div>
            )}
          </SignatureCard>

          {/* Step 1: Consent */}
          {wizardStep === 1 && (
            <SignatureCard
              variant="navy"
              topRightBadge="Step 01"
              icon={<ShieldAlert className="w-6 h-6" />}
              pillLabel="Informed Consent & Scope"
              title="Preliminary Oral Health Screening & Informed Consent"
              meta="Please read the purpose and limitations carefully before providing your health details and photograph."
              tags={['Non-Diagnostic Aid', 'Private Health Vault', 'Consent Required']}
              footer={{
                label: 'Consent status',
                value: consentAccepted ? 'Consent accepted — ready to continue' : 'Please review and tick consent above',
                dotTone: consentAccepted ? 'emerald' : 'amber',
                ctaLabel: 'Continue to Questionnaire',
                ctaDisabled: !consentAccepted,
                onCtaClick: () => setWizardStep(2),
              }}
            >
              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-[#FBFBFA] border border-gray-200/80 text-sm text-gray-700 leading-relaxed">
                  {consentText ||
                    'This preliminary screening combines your symptom answers with AI-assisted visual observation. It is not a medical diagnosis or cancer staging tool.'}
                </div>

                <label className="flex items-start gap-3 p-4 rounded-2xl border border-gray-200 bg-white cursor-pointer hover:bg-[#ECFDF5]/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-1 rounded border-gray-300 text-[#0D5C58] focus:ring-[#0D5C58]"
                  />
                  <span className="text-sm text-gray-800">
                    I have read and understood the screening purpose, limitations, and privacy
                    notice, and I consent to share my responses and uploaded oral photograph for
                    preliminary assessment.
                  </span>
                </label>
              </div>
            </SignatureCard>
          )}

          {/* Step 2: Questionnaire */}
          {wizardStep === 2 && (
            <SignatureCard
              variant="teal"
              topRightBadge="Step 02"
              icon={<ClipboardList className="w-6 h-6" />}
              pillLabel="Habit & Symptom Intake"
              title="Personal, Lifestyle & Symptom Questionnaire"
              meta='We collect habit and symptom duration context to improve triage guidance. Select "Unsure" if you do not know an answer.'
              tags={['Voice Auto-Fill Ready', 'Lifestyle Context', 'Symptom Duration']}
            >
            <div className="space-y-6">
              {/* New Feature: Gemini Voice Auto-Fill Symptom Intake */}
              <div className="p-4 rounded-2xl border border-emerald-200/80 bg-[#ECFDF5]/80 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-[#0D5C58]">
                      Voice Auto-Fill Symptoms (Gemini AI)
                    </p>
                    <p className="text-[11px] text-gray-700">
                      Speak naturally about your age, city, tobacco/betel habits, and symptoms to
                      fill out this questionnaire automatically.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={intakeExtracting}
                    onClick={() => void handleToggleVoiceIntake()}
                    className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl whitespace-nowrap cursor-pointer ${
                      intakeRecording
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'ad-btn-teal text-white disabled:opacity-60'
                    }`}
                  >
                    {intakeRecording ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-current" />
                        Stop &amp; Auto-Fill
                      </>
                    ) : (
                      <>
                        <Mic className="w-3.5 h-3.5" />
                        {intakeExtracting ? 'Analyzing Speech...' : 'Speak Symptoms'}
                      </>
                    )}
                  </button>
                </div>
                {intakeFeedback && (
                  <div className="p-3 rounded-xl bg-white border border-emerald-200 text-xs space-y-1.5">
                    <p className="text-gray-600">
                      <strong className="text-gray-900">Heard:</strong> &ldquo;
                      {intakeFeedback.transcript}&rdquo;
                    </p>
                    {intakeFeedback.highlights.length > 0 && (
                      <p className="text-[#0D5C58] font-medium">
                        Auto-filled: {intakeFeedback.highlights.join(' · ')}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Age</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={questionnaire.age ?? ''}
                    onChange={(e) =>
                      setQuestionnaire((q) => ({
                        ...q,
                        age: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    placeholder="Years"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Gender</label>
                  <select
                    value={questionnaire.gender}
                    onChange={(e) =>
                      setQuestionnaire((q) => ({ ...q, gender: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="prefer_not_to_say">Prefer not to say</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    City / General Area (Optional)
                  </label>
                  <input
                    type="text"
                    value={questionnaire.generalLocation || ''}
                    onChange={(e) =>
                      setQuestionnaire((q) => ({ ...q, generalLocation: e.target.value }))
                    }
                    placeholder="For nearby hospital matching"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Previous oral health problems or medical history
                </label>
                <input
                  type="text"
                  value={questionnaire.previousOralProblems || ''}
                  onChange={(e) =>
                    setQuestionnaire((q) => ({ ...q, previousOralProblems: e.target.value }))
                  }
                  placeholder="e.g., recurring mouth ulcers, dental extractions, diabetes..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {/* Lifestyle Risk Factors */}
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Lifestyle &amp; Habit Factors</h3>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Do you use tobacco?
                    </label>
                    <select
                      value={questionnaire.usesTobacco}
                      onChange={(e) =>
                        setQuestionnaire((q) => ({
                          ...q,
                          usesTobacco: e.target.value as 'yes' | 'no' | 'unsure',
                        }))
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                      <option value="unsure">Prefer not to say / Unsure</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Do you consume alcohol?
                    </label>
                    <select
                      value={questionnaire.consumesAlcohol}
                      onChange={(e) =>
                        setQuestionnaire((q) => ({
                          ...q,
                          consumesAlcohol: e.target.value as
                            | 'yes'
                            | 'no'
                            | 'occasionally'
                            | 'unsure',
                        }))
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="no">No</option>
                      <option value="occasionally">Occasionally</option>
                      <option value="yes">Yes</option>
                      <option value="unsure">Unsure</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Chew betel nut or areca nut?
                    </label>
                    <select
                      value={questionnaire.chewsBetelOrArecaNut}
                      onChange={(e) =>
                        setQuestionnaire((q) => ({
                          ...q,
                          chewsBetelOrArecaNut: e.target.value as 'yes' | 'no' | 'unsure',
                        }))
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                      <option value="unsure">Unsure</option>
                    </select>
                  </div>
                </div>

                {questionnaire.usesTobacco === 'yes' && (
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                    <p className="text-xs font-semibold text-slate-700">
                      Select tobacco forms used:
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {TOBACCO_TYPE_OPTIONS.map((opt) => (
                        <label key={opt} className="inline-flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={questionnaire.tobaccoTypes.includes(opt)}
                            onChange={(e) =>
                              setQuestionnaire((q) => ({
                                ...q,
                                tobaccoTypes: e.target.checked
                                  ? [...q.tobaccoTypes, opt]
                                  : q.tobaccoTypes.filter((x) => x !== opt),
                              }))
                            }
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={questionnaire.tobaccoFrequencyDuration || ''}
                      onChange={(e) =>
                        setQuestionnaire((q) => ({
                          ...q,
                          tobaccoFrequencyDuration: e.target.value,
                        }))
                      }
                      placeholder="Frequency & duration (e.g. 5 times/day for 6 years)"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                )}

                {questionnaire.chewsBetelOrArecaNut === 'yes' && (
                  <input
                    type="text"
                    value={questionnaire.betelFrequencyDuration || ''}
                    onChange={(e) =>
                      setQuestionnaire((q) => ({
                        ...q,
                        betelFrequencyDuration: e.target.value,
                      }))
                    }
                    placeholder="Betel/areca nut frequency & duration (e.g. daily for 4 years)"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                )}
              </div>

              {/* Symptoms */}
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Describe Symptoms</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Symptom Duration
                    </label>
                    <select
                      value={questionnaire.symptomDuration}
                      onChange={(e) =>
                        setQuestionnaire((q) => ({ ...q, symptomDuration: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Less than one week">Less than one week</option>
                      <option value="1–2 weeks">1–2 weeks</option>
                      <option value="2–4 weeks">2–4 weeks</option>
                      <option value="1–3 months">1–3 months</option>
                      <option value="More than 3 months">More than 3 months</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="block text-xs font-semibold text-slate-700">
                        Describe any oral symptoms or concerns
                      </label>
                      <VoiceDictationButton
                        initialText={questionnaire.otherSymptomsDescription || ''}
                        contextHint="Patient describing oral health symptoms"
                        onLiveTranscript={(text) =>
                          setQuestionnaire((q) => ({ ...q, otherSymptomsDescription: text }))
                        }
                        onTranscript={(text) =>
                          setQuestionnaire((q) => ({ ...q, otherSymptomsDescription: text }))
                        }
                      />
                    </div>
                    <textarea
                      rows={3}
                      value={questionnaire.otherSymptomsDescription || ''}
                      onChange={(e) =>
                        setQuestionnaire((q) => ({
                          ...q,
                          otherSymptomsDescription: e.target.value,
                        }))
                      }
                      placeholder="Describe any symptoms, where they occur, and how long you have had them. You can type or use Dictate."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50/70 border border-red-200 text-xs text-red-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={questionnaire.severeOrRapidlyWorsening}
                    onChange={(e) =>
                      setQuestionnaire((q) => ({
                        ...q,
                        severeOrRapidlyWorsening: e.target.checked,
                      }))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <strong>Severe or rapidly worsening symptoms:</strong> Check if you have active
                    uncontrolled bleeding, severe breathing/swallowing difficulty, or sudden painful
                    neck swelling.
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep(3)}
                  className="ad-btn-teal px-6 py-2.5 text-sm font-semibold text-white rounded-xl cursor-pointer"
                >
                  Continue to Image Capture
                </button>
              </div>
            </div>
            </SignatureCard>
          )}

          {/* Step 3: Oral Image Capture & Upload */}
          {wizardStep === 3 && (
            <SignatureCard
              variant="navy"
              topRightBadge="Step 03"
              icon={<Camera className="w-6 h-6" />}
              pillLabel="Intraoral Photo Capture"
              title="Oral Image Capture & Upload"
              meta="Use bright white light, hold 15–20 cm away, and keep the oral region in sharp focus"
              tags={['JPG / PNG / WEBP', '1 Photo Only', 'AI Clarity Check']}
              footer={{
                label: 'Photo status',
                value: stagedImage ? '1 / 1 photo attached' : 'No photo added',
                dotTone: stagedImages.length > 0 ? 'emerald' : 'amber',
                rightSlot: (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={submittingScreening || stagedImages.length === 0}
                      onClick={() => void submitScreening()}
                      className="ad-btn-teal px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 rounded-xl cursor-pointer whitespace-nowrap"
                    >
                      {submittingScreening
                        ? 'Analyzing with Gemini AI...'
                        : 'Submit Screening'}
                    </button>
                  </div>
                ),
              }}
            >
            <div className="space-y-6">
              <div className="grid md:grid-cols-12 gap-6 items-center bg-[#FBFBFA] border border-gray-200/80 rounded-2xl p-5">
                <div className="md:col-span-4 rounded-2xl overflow-hidden border border-[#2CD6A7]/30 bg-gradient-to-br from-[#0B2528] to-[#0E5C63] p-4 flex items-center justify-center h-36">
                  <svg
                    viewBox="0 0 180 110"
                    className="w-full h-full"
                    role="img"
                    aria-label="Geometric intraoral lighting and framing diagram"
                  >
                    <circle cx="90" cy="55" r="42" fill="none" stroke="#2CD6A7" strokeOpacity="0.35" strokeWidth="1.2" />
                    <circle cx="90" cy="55" r="24" fill="none" stroke="#38E2B2" strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="3 3" />
                    <path d="M55 68 C55 32, 125 32, 125 68" fill="none" stroke="#E6FAF4" strokeWidth="1.6" strokeOpacity="0.7" />
                    <line x1="90" y1="8" x2="90" y2="102" stroke="#E6FAF4" strokeOpacity="0.22" strokeWidth="1" />
                    <line x1="36" y1="55" x2="144" y2="55" stroke="#E6FAF4" strokeOpacity="0.22" strokeWidth="1" />
                    <circle cx="90" cy="55" r="4" fill="#38E2B2" />
                    <text x="90" y="102" textAnchor="middle" fill="#E6FAF4" fontSize="8" fontFamily="monospace">
                      15–20 CM · STEADY LIGHT
                    </text>
                  </svg>
                </div>
                <div className="md:col-span-8 space-y-1.5">
                  <h2 className="text-base font-bold text-[#0B2528] font-display">
                    Oral Image Capture Guidance
                  </h2>
                  <p className="text-xs text-[#4A6468] leading-relaxed">
                    Use bright white light or a phone flashlight, keep the camera 15–20 cm away
                    until sharp focus locks, retract cheek/lips gently with clean fingers or a
                    spoon, and avoid blurry or dark photos.
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Oral Region Photographed
                  </label>
                  <select
                    value={selectedRegion}
                    onChange={(e) => setSelectedRegion(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {ORAL_REGIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

              </div>

                <div className="grid gap-4">
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                      <h3 className="text-xs font-bold text-slate-800">Oral Photo</h3>
                      <span className={`text-[10px] font-semibold ${stagedImage ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {stagedImage ? 'Photo ready' : 'Photo needed'}
                      </span>
                    </div>
                    {stagedImage ? (
                      <img
                        src={stagedImage.previewUrl}
                        alt={`Oral photo: ${stagedImage.oralRegion}`}
                        className="h-48 w-full bg-slate-100 object-contain"
                      />
                    ) : (
                      <div className="flex h-48 items-center justify-center bg-slate-50 text-xs text-slate-400">
                        Take or upload one oral photo
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 p-3">
                      <button
                        type="button"
                        disabled={cameraOpen || submittingScreening}
                        onClick={() => void startCamera(0)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Camera className="h-3.5 w-3.5" />
                        {stagedImage ? 'Retake Photo' : 'Take Photo'}
                      </button>
                      <label className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 ${cameraOpen || submittingScreening ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                        <Upload className="h-3.5 w-3.5 text-teal-700" />
                        {stagedImage ? 'Replace Photo' : 'Upload Photo'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={cameraOpen || submittingScreening}
                          onChange={(event) => handleImageFileSelectAtSlot(event, 0)}
                          className="hidden"
                        />
                      </label>
                      {stagedImage && (
                        <button
                          type="button"
                          disabled={cameraOpen || submittingScreening}
                          onClick={() => removeStagedImage(0)}
                          aria-label="Remove oral photo"
                          className="ml-auto rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {stagedImage && (
                      <p className="px-3 pb-3 text-[10px] text-slate-500">{stagedImage.oralRegion}</p>
                    )}
                  </section>
                </div>

              {cameraOpen && (
                <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 space-y-3">
                    <p className="text-sm font-semibold text-white">
                      Capture Photo Stage {(cameraTargetIndex ?? 0) + 1}
                    </p>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full max-h-72 object-contain rounded-lg"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-200 border border-slate-600 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={capturePhotoFromCamera}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-teal-600 rounded-lg cursor-pointer"
                    >
                      Capture Photo ({selectedRegion})
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-gray-500">
                Add one clear photo. You can retake, replace, or remove it before submitting.
              </p>
            </div>
            </SignatureCard>
          )}

          {/* Step 4: Structured Screening Result */}
          {wizardStep === 4 && activeReport && activeReport.aiReport && (
            <SignatureCard
              variant={
                activeReport.aiReport.emergencyGuidanceRequired ||
                activeReport.questionnaire.severeOrRapidlyWorsening
                  ? 'saffron'
                  : 'teal'
              }
              topRightBadge={activeReport.reportCode}
              icon={<FileText className="w-6 h-6" />}
              pillLabel="AI Preliminary Observation"
              title="Preliminary Oral Screening Report"
              meta={`Generated ${new Date(activeReport.createdAt).toLocaleString()} · Region: ${
                activeReport.aiReport.reportedOralRegion
              }`}
              tags={[
                activeReport.aiReport.preliminaryRiskCategory,
                `Quality: ${activeReport.aiReport.imageQuality}`,
                activeReport.aiReport.reportedOralRegion,
              ]}
              metrics={[
                {
                  value: activeReport.aiReport.preliminaryRiskCategory.replace(' Risk', ''),
                  label: 'Triage Level',
                },
                {
                  value: activeReport.aiReport.imageQuality,
                  label: 'Photo Clarity',
                },
                {
                  value: activeReport.images.length,
                  label: 'Images Reviewed',
                },
              ]}
              footer={{
                label: 'Next clinical step',
                value: 'Share this preliminary report with a verified specialist',
                dotTone:
                  activeReport.aiReport.emergencyGuidanceRequired ||
                  activeReport.questionnaire.severeOrRapidlyWorsening
                    ? 'rose'
                    : 'emerald',
                rightSlot: (
                  <div className="no-print flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setWizardStep(1);
                        setActiveReport(null);
                        setConsentAccepted(false);
                        setQuestionnaire(INITIAL_QUESTIONNAIRE);
                      }}
                      className="px-3.5 py-2 text-xs font-semibold bg-white border border-gray-200 hover:bg-gray-50 rounded-xl cursor-pointer"
                    >
                      New Screening
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBookingScreeningId(activeReport.id);
                        setUrgentScreeningId(activeReport.id);
                        onChangeTab('discover');
                      }}
                      className="ad-btn-teal px-4 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer whitespace-nowrap"
                    >
                      Find Nearby Doctors
                    </button>
                  </div>
                ),
              }}
            >
            <div className="space-y-6">
              <div className="no-print flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200">
                <span className="text-xs font-mono text-gray-500">
                  {activeReport.reportCode}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={ttsLoading}
                    onClick={() => void handleToggleReportAudio(activeReport)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border cursor-pointer ${
                      ttsPlaying
                        ? 'bg-[#ECFDF5] border-emerald-300 text-[#0D5C58]'
                        : 'bg-white border-gray-200 text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    {ttsPlaying ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-current" />
                        Stop Audio
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5 text-teal-700" />
                        {ttsLoading ? 'Preparing Audio...' : 'Listen to Report'}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print / Save PDF
                  </button>
                </div>
              </div>
              {ttsError && (
                <div className="no-print p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  {ttsError}
                </div>
              )}

              {/* Emergency Warning */}
              {(activeReport.aiReport.emergencyGuidanceRequired ||
                activeReport.questionnaire.severeOrRapidlyWorsening) && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    <p className="font-bold text-sm mb-1">
                      Prompt Clinical or Emergency Assessment Advised
                    </p>
                    <p>
                      If you are experiencing severe bleeding, acute difficulty swallowing or
                      breathing, or rapidly worsening neck swelling, please contact local emergency
                      services (108 / 112) or visit the nearest hospital emergency department
                      immediately.
                    </p>
                  </div>
                </div>
              )}

              {/* Inadequate Image Quality Retake Flow */}
              {activeReport.aiReport.imageQuality === 'inadequate' ? (
                <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-bold text-amber-950">
                        Photo Clarity Insufficient — Please Retake Photograph
                      </h3>
                      <p className="text-xs text-amber-900 mt-1">
                        {activeReport.aiReport.imageQualityReason}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-white border border-amber-300 rounded-xl cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      Select Clearer Photo
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => handleImageFileSelectAtSlot(event, 0)}
                        className="hidden"
                      />
                    </label>
                    {stagedImages.length > 0 && (
                      <button
                        type="button"
                        disabled={submittingScreening}
                        onClick={() => void handleRetakeImages(activeReport.id)}
                        className="ad-btn-teal px-4 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer"
                      >
                        {submittingScreening
                          ? 'Re-analyzing...'
                          : `Re-analyze (${stagedImages.length} photo)`}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl border border-gray-200/80 bg-[#FBFBFA]">
                      <p className="text-xs font-medium text-gray-500">
                        Preliminary Triage Category
                      </p>
                      <p className="text-lg mt-1">
                        <RiskBadgeText
                          category={activeReport.aiReport.preliminaryRiskCategory}
                        />
                      </p>
                      <p className="text-xs text-gray-600 mt-2">
                        {activeReport.aiReport.urgencyOfAssessment}
                      </p>
                    </div>
                    <div className="p-4 rounded-2xl border border-gray-200/80 bg-[#FBFBFA]">
                      <p className="text-xs font-medium text-gray-500">
                        Image Quality &amp; Region
                      </p>
                      <p className="text-sm font-semibold text-gray-900 mt-1 capitalize">
                        {activeReport.aiReport.imageQuality} ·{' '}
                        {activeReport.aiReport.reportedOralRegion}
                      </p>
                      <p className="text-xs text-gray-600 mt-2">
                        {activeReport.aiReport.imageQualityReason}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 text-sm">
                    <div>
                      <h3 className="font-bold text-gray-900 mb-1.5">
                        Observed Visible Features (Neutral Description)
                      </h3>
                      <ul className="list-disc pl-5 space-y-1 text-gray-700 text-xs">
                        {activeReport.aiReport.observedVisibleFeatures.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h3 className="font-bold text-gray-900 mb-1">Preliminary Assessment</h3>
                      <p className="text-xs text-gray-700 leading-relaxed">
                        {activeReport.aiReport.riskExplanation}
                      </p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4 pt-2">
                      <div className="p-4 rounded-2xl border border-gray-200/80 bg-[#FBFBFA]">
                        <p className="text-xs font-bold text-gray-800 mb-1">
                          Reported Symptoms &amp; Duration
                        </p>
                        <p className="text-xs text-gray-600">
                          {activeReport.aiReport.patientReportedSymptomsSummary}
                        </p>
                      </div>
                      <div className="p-4 rounded-2xl border border-gray-200/80 bg-[#FBFBFA]">
                        <p className="text-xs font-bold text-gray-800 mb-1">
                          Reported Lifestyle Factors
                        </p>
                        <p className="text-xs text-gray-600">
                          {activeReport.aiReport.lifestyleRiskFactorsSummary}
                        </p>
                      </div>
                    </div>

                    <div>
                      <h3 className="font-bold text-gray-900 mb-1.5">Recommended Next Steps</h3>
                      <ul className="list-disc pl-5 space-y-1 text-xs text-gray-700">
                        {activeReport.aiReport.recommendedNextSteps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-4 rounded-2xl bg-[#FEF4EB]/70 border border-amber-200/80 text-xs text-gray-700">
                      <strong className="text-gray-900">Limitations &amp; Uncertainty:</strong>{' '}
                      {activeReport.aiReport.uncertaintyAndLimitations}
                    </div>
                  </div>
                </>
              )}
            </div>
            </SignatureCard>
          )}
        </div>
      )}

      {/* HISTORY & CLINICAL NOTES TAB */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          <SignatureCard
            variant="teal"
            topRightBadge={`${screenings.length} Screenings`}
            icon={<History className="w-6 h-6" />}
            pillLabel="Longitudinal Medical History"
            title="Chronological Screening History"
            meta="All screening reports, uploaded oral photographs, and AI triage observations are privately linked to your account."
            metrics={[
              { value: screenings.length, label: 'Screenings' },
              { value: consultations.length, label: 'Doctor Notes' },
              { value: 'Encrypted', label: 'Privacy' },
            ]}
            footer={{
              label: 'New observation',
              value: 'Add a fresh oral screening anytime',
              ctaLabel: 'Start Screening',
              onCtaClick: () => {
                setWizardStep(1);
                setActiveReport(null);
                onChangeTab('screening');
              },
            }}
          />

          {screenings.length === 0 ? (
            <SignatureCard
              variant="navy"
              icon={<FileText className="w-6 h-6" />}
              pillLabel="No Records"
              title="No screening records found yet"
              meta="Complete your first guided screening to build your private longitudinal timeline."
              footer={{
                label: 'Guided wizard',
                value: 'Step-by-step intake & photo check',
                ctaLabel: 'Begin Screening',
                onCtaClick: () => onChangeTab('screening'),
              }}
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {screenings.map((sc, idx) => (
                <SignatureCard
                  key={sc.id}
                  variant={getVariantByIndex(idx)}
                  topRightBadge={sc.reportCode}
                  icon={<FileText className="w-6 h-6" />}
                  pillLabel={sc.aiReport?.preliminaryRiskCategory || sc.status.replace(/_/g, ' ')}
                  title={
                    <RiskBadgeText category={sc.aiReport?.preliminaryRiskCategory} />
                  }
                  meta={`${new Date(sc.createdAt).toLocaleString()} · Status: ${sc.status.replace(
                    /_/g,
                    ' '
                  )}`}
                  tags={[
                    sc.reportCode,
                    sc.aiReport?.reportedOralRegion || 'Oral Region',
                    `${sc.images.length} Photo(s)`,
                  ]}
                  footer={{
                    label: 'Full clinical PDF',
                    value: 'View report & listen to TTS summary',
                    ctaLabel: 'Open Report',
                    onCtaClick: () => {
                      setActiveReport(sc);
                      setWizardStep(4);
                      onChangeTab('screening');
                    },
                  }}
                >
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {sc.aiReport?.riskExplanation || 'Preliminary observation saved.'}
                  </p>
                  {sc.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {sc.images.map((img) => (
                        <div key={img.id} className="w-24">
                          <img
                            src={authenticatedFileUrl(
                              `/api/files/screening/${sc.id}/${img.id}`
                            )}
                            alt={img.oralRegion}
                            className="w-24 h-20 object-cover rounded-xl border border-gray-200"
                          />
                          <p className="text-[10px] text-gray-500 truncate mt-1">
                            {img.oralRegion}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </SignatureCard>
              ))}
            </div>
          )}

          {/* Consultation Notes & Follow-ups */}
          <SignatureCard
            variant="saffron"
            topRightBadge={`${consultations.length} Notes`}
            icon={<ClipboardList className="w-6 h-6" />}
            pillLabel="Specialist Follow-Ups"
            title="Doctor Consultation Notes & Follow-Ups"
            meta="Clinical observations, biopsy/diagnostic referrals, and follow-up dates shared by your doctors."
          />

          {consultations.length === 0 ? (
            <SignatureCard
              variant="teal"
              icon={<ClipboardList className="w-6 h-6" />}
              pillLabel="Awaiting Consult"
              title="No doctor consultation notes recorded yet"
              meta="Doctor notes appear here automatically after an online or hospital consultation."
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {consultations.map((c, idx) => (
                <SignatureCard
                  key={c.id}
                  variant={getVariantByIndex(idx + 1)}
                  topRightBadge={new Date(c.createdAt).toLocaleDateString()}
                  icon={<ClipboardList className="w-6 h-6" />}
                  pillLabel={c.doctorSpecialization || 'Specialist Review'}
                  title={c.doctorName}
                  meta={c.hospitalName}
                  tags={[
                    ...(c.diagnosticTestsSuggested || []).slice(0, 2),
                    ...(c.referralRecommended ? ['Referral Recommended'] : []),
                  ]}
                  footer={{
                    label: 'Follow-up schedule',
                    value: c.followUpDate
                      ? `${c.followUpDate}${c.followUpInstructions ? ` — ${c.followUpInstructions}` : ''}`
                      : 'No specific follow-up date set',
                    dotTone: c.referralRecommended ? 'amber' : 'emerald',
                  }}
                >
                  <div className="space-y-1.5 text-xs text-gray-700">
                    <p>
                      <strong className="text-gray-900">Clinical Observations:</strong>{' '}
                      {c.clinicalObservations || '—'}
                    </p>
                    <p>
                      <strong className="text-gray-900">Recommendations:</strong>{' '}
                      {c.recommendations || '—'}
                    </p>
                    {c.diagnosticTestsSuggested && c.diagnosticTestsSuggested.length > 0 && (
                      <p>
                        <strong className="text-gray-900">Suggested Tests:</strong>{' '}
                        {c.diagnosticTestsSuggested.join(', ')}
                      </p>
                    )}
                    {c.referralRecommended && (
                      <p className="text-amber-800 font-medium">
                        Referral Recommended: {c.referralDetails}
                      </p>
                    )}
                  </div>
                </SignatureCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* DISCOVER HOSPITALS & DOCTORS */}
      {activeTab === 'discover' && (
        <HospitalDiscovery
          onBookAppointment={(hospital, doctor) => {
            setBookingFeedback(null);
            setBookingContext({ hospital, doctor });
          }}
          onRequestUrgent={(hospital, doctor) => {
            setBookingFeedback(null);
            setUrgentContext({ hospital, doctor });
          }}
        />
      )}

      {/* APPOINTMENTS TAB */}
      {activeTab === 'appointments' && (
        <div className="space-y-6">
          <SignatureCard
            variant="navy"
            topRightBadge={`${appointments.length} Total`}
            icon={<Calendar className="w-6 h-6" />}
            pillLabel="Care Coordination"
            title="Appointments & Urgent Requests"
            meta="Track booking confirmations, urgent triage responses, and launch encrypted video consultations."
            metrics={[
              { value: upcomingCount, label: 'Accepted' },
              {
                value: appointments.filter((a) => a.status === 'pending').length,
                label: 'Pending',
              },
              {
                value: appointments.filter((a) => a.type === 'urgent').length,
                label: 'Urgent',
              },
            ]}
            footer={{
              label: 'Need a specialist?',
              value: 'Compare verified hospitals & slots',
              ctaLabel: 'Book New Appointment',
              onCtaClick: openAppointmentFinder,
            }}
          />

          {appointments.length === 0 ? (
            <SignatureCard
              variant="saffron"
              icon={<Calendar className="w-6 h-6" />}
              pillLabel="No Bookings"
              title="No appointments booked yet"
              meta="Find a registered hospital to book a normal or urgent specialist consultation."
              footer={{
                label: 'Hospital directory',
                value: 'Video & in-person slots available',
                ctaLabel: 'Explore Hospitals',
                onCtaClick: openAppointmentFinder,
              }}
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {appointments.map((apt, idx) => (
                <SignatureCard
                  key={apt.id}
                  variant={apt.type === 'urgent' ? 'saffron' : getVariantByIndex(idx)}
                  topRightBadge={apt.type === 'urgent' ? 'URGENT' : apt.appointmentCode}
                  icon={
                    apt.mode === 'video' ? (
                      <Video className="w-6 h-6" />
                    ) : (
                      <Calendar className="w-6 h-6" />
                    )
                  }
                  pillLabel={`Status: ${apt.status}`}
                  title={apt.doctorName}
                  meta={`${apt.hospitalName} · ${apt.hospitalPhone}`}
                  tags={[
                    apt.appointmentCode,
                    apt.mode === 'video' ? 'Video Consultation' : 'In-Person Visit',
                    apt.type === 'urgent' ? 'Urgent Triage' : 'Standard Slot',
                  ]}
                  metrics={[
                    { value: apt.date, label: 'Date' },
                    { value: apt.timeSlot, label: 'Time' },
                    { value: apt.status, label: 'Status' },
                  ]}
                  footer={{
                    label: 'Consultation action',
                    value:
                      apt.status === 'accepted' && apt.mode === 'video'
                        ? 'Video room ready'
                        : `Status: ${apt.status}`,
                    dotTone:
                      apt.type === 'urgent'
                        ? 'rose'
                        : apt.status === 'accepted'
                        ? 'emerald'
                        : 'amber',
                    rightSlot: (
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {apt.status === 'accepted' && apt.mode === 'video' && (
                          <button
                            type="button"
                            onClick={() => setActiveCallAppointment(apt)}
                            className="ad-btn-teal inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white rounded-xl cursor-pointer"
                          >
                            <Video className="w-3.5 h-3.5" />
                            Join Video
                          </button>
                        )}
                        {['pending', 'accepted'].includes(apt.status) && (
                          <button
                            type="button"
                            onClick={() => void handleCancelAppointment(apt.id)}
                            className="px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl cursor-pointer"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    ),
                  }}
                >
                  <div className="space-y-1 text-xs text-gray-600">
                    <p>
                      <strong className="text-gray-800">Reason:</strong> {apt.reason}
                    </p>
                    {apt.doctorResponseNotes && (
                      <p className="text-[#0D5C58] font-medium">
                        Doctor Note: {apt.doctorResponseNotes}
                      </p>
                    )}
                    {apt.redirectedHospitalOrDoctor && (
                      <p className="text-amber-800 font-medium">
                        Redirected to: {apt.redirectedHospitalOrDoctor}
                      </p>
                    )}
                  </div>
                </SignatureCard>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'age-classification' && profile && (
        <form onSubmit={handleSaveAgeClassification} className="max-w-4xl">
          <SignatureCard
            variant="navy"
            topRightBadge={getAgeCategoryLabel(profile.ageCategory)}
            icon={<Users className="w-6 h-6" />}
            pillLabel="Patient Age Classification"
            title="Age Classification"
            meta="Your age is calculated from your date of birth. The matching age category is recommended and saved to your patient profile."
            metrics={[
              { value: calculatedProfileAge ?? '—', label: 'Calculated Age' },
              {
                value: getAgeCategoryLabel(recommendedAgeCategory ?? undefined),
                label: 'Recommended Category',
              },
              {
                value: getAgeCategoryLabel(profile.ageCategory),
                label: 'Selected Category',
              },
            ]}
          >
            <div className="space-y-5">
              {ageClassificationMsg && (
                <p
                  role="status"
                  className={`rounded-xl border p-3 text-xs font-medium ${
                    ageClassificationMsg.startsWith('Age classification saved')
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  {ageClassificationMsg}
                </p>
              )}
              <div className="max-w-sm">
                <label
                  htmlFor="patient-date-of-birth"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Date of Birth
                </label>
                <input
                  id="patient-date-of-birth"
                  type="date"
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  value={profile.dateOfBirth || ''}
                  onChange={(event) => {
                    const dateOfBirth = event.target.value;
                    const age = getAgeFromDateOfBirth(dateOfBirth);
                    setProfile({
                      ...profile,
                      dateOfBirth,
                      age: age ?? undefined,
                      ageCategory: age === null ? undefined : getAgeCategory(age) ?? undefined,
                    });
                    setAgeClassificationMsg(null);
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100"
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {calculatedProfileAge === null
                    ? 'Enter your date of birth to calculate your age and receive a recommendation.'
                    : `Calculated age: ${calculatedProfileAge} years`}
                </p>
              </div>

              <fieldset>
                <legend className="mb-2 text-xs font-semibold text-slate-700">
                  Select your age category
                </legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {PATIENT_AGE_CATEGORIES.map((category) => {
                    const selected = profile.ageCategory === category.value;
                    const recommended = recommendedAgeCategory === category.value;
                    return (
                      <button
                        key={category.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setProfile({ ...profile, ageCategory: category.value });
                          setAgeClassificationMsg(null);
                        }}
                        className={`rounded-2xl border p-4 text-left transition-colors ${
                          selected
                            ? 'border-teal-700 bg-teal-50 ring-2 ring-teal-100'
                            : 'border-slate-200 bg-white hover:border-teal-300'
                        }`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {category.label}
                          </span>
                          {recommended && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">
                              Recommended
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs text-slate-600">{category.range}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <p className="max-w-xl text-[11px] text-slate-500">
                  The category is based on your age. It helps organize your profile and does not
                  replace clinical assessment.
                </p>
                <button
                  type="submit"
                  disabled={
                    !profile.dateOfBirth ||
                    calculatedProfileAge === null ||
                    !profile.ageCategory ||
                    !recommendedAgeCategory
                  }
                  className="ad-btn-teal rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save Age Classification
                </button>
              </div>
            </div>
          </SignatureCard>
        </form>
      )}

      {/* PROFILE TAB */}
      {activeTab === 'profile' && profile && (
        <form onSubmit={handleSaveProfile} className="max-w-3xl">
          <SignatureCard
            variant="teal"
            topRightBadge="Verified Mobile"
            icon={<User className="w-6 h-6" />}
            pillLabel="Patient Health Profile"
            title={profile.fullName || 'Personal Patient Profile'}
            meta={`Registered Mobile: ${profile.mobile}`}
            metrics={[
              { value: profile.age ?? '—', label: 'Age' },
              {
                value: getAgeCategoryLabel(profile.ageCategory),
                label: 'Age Classification',
              },
              { value: profile.city || '—', label: 'City' },
              { value: screenings.length, label: 'Screenings' },
            ]}
          >
            <div className="space-y-4">
              {profileSavedMsg && (
                <div className="p-3 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-xs font-medium text-[#0D5C58] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {profileSavedMsg}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={profile.fullName}
                    onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Registered Mobile
                  </label>
                  <input
                    type="text"
                    disabled
                    value={profile.mobile}
                    className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-100 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Calculated Age
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={
                        profile.dateOfBirth
                          ? profile.age ?? '—'
                          : 'Add date of birth'
                      }
                      className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => onChangeTab('age-classification')}
                      className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                    >
                      Age Classification
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Gender</label>
                  <select
                    value={profile.gender || 'prefer_not_to_say'}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        gender: e.target.value as PatientProfile['gender'],
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl bg-white"
                  >
                    <option value="prefer_not_to_say">Prefer not to say</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">City</label>
                  <input
                    type="text"
                    value={profile.city || ''}
                    onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Village</label>
                  <input
                    type="text"
                    maxLength={100}
                    value={profile.village || ''}
                    onChange={(e) => setProfile({ ...profile, village: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Mandal</label>
                  <input
                    type="text"
                    maxLength={100}
                    value={profile.mandal || ''}
                    onChange={(e) => setProfile({ ...profile, mandal: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Emergency Contact
                  </label>
                  <input
                    type="text"
                    value={profile.emergencyContact || ''}
                    onChange={(e) => setProfile({ ...profile, emergencyContact: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl bg-white"
                  />
                </div>
                <label className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-950">
                  <input
                    type="checkbox"
                    checked={profile.ashaFollowupConsent || false}
                    onChange={(e) =>
                      setProfile({ ...profile, ashaFollowupConsent: e.target.checked })
                    }
                    className="mt-0.5 accent-teal-700"
                  />
                  <span>
                    I agree to share my name, mobile number, village, mandal, screening/appointment status, and
                    ASHA follow-up notes with approved ASHA Workers assigned to my village and mandal for community
                    follow-up. I can withdraw this consent at any time.
                  </span>
                </label>
                {profile.ashaFollowupConsent && (
                  <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={profile.ashaClinicalRecordsConsent || false}
                        onChange={(e) =>
                          setProfile({ ...profile, ashaClinicalRecordsConsent: e.target.checked })
                        }
                        className="mt-0.5 accent-sky-700"
                      />
                      <span>
                        Optional: Share my age, oral screening symptoms and risk classification, plus specialist notes,
                        treatment prescriptions, and referral/follow-up plans with my assigned ASHA Worker.
                      </span>
                    </label>
                    {profile.hasAadhaarOnFile && (
                      <label className="flex items-start gap-2 border-t border-sky-200 pt-2">
                        <input
                          type="checkbox"
                          checked={profile.ashaAadhaarLastFourConsent || false}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              ashaAadhaarLastFourConsent: e.target.checked,
                            })
                          }
                          className="mt-0.5 accent-sky-700"
                        />
                        <span>
                          Optional: Share only the last four digits of my Aadhaar with my assigned ASHA Worker
                          for identity matching. The full number and Aadhaar image will never be shared.
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Medical History &amp; Previous Oral Health Notes
                </label>
                <textarea
                  rows={3}
                  value={profile.medicalHistory || ''}
                  onChange={(e) => setProfile({ ...profile, medicalHistory: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl bg-white"
                />
              </div>
              <button
                type="submit"
                className="ad-btn-teal px-5 py-2.5 text-sm font-semibold text-white rounded-xl cursor-pointer"
              >
                Save Profile
              </button>
            </div>
          </SignatureCard>
        </form>
      )}

      {activeTab === 'asha' && (
        <div className="space-y-6">
          <SignatureCard
            variant="teal"
            topRightBadge={profile?.village || 'Village not set'}
            icon={<MapPin className="w-6 h-6" />}
            pillLabel="Community follow-up"
            title="Your village ASHA Worker"
            meta="Approved ASHA Workers can view basic follow-up information after your consent. Sharing screening symptoms and specialist records or your masked Aadhaar requires separate optional consent. ASHA Workers cannot diagnose or prescribe treatment."
            footer={{
              label: 'Consent status',
              value: profile?.ashaFollowupConsent ? 'Sharing enabled' : 'Not sharing',
              ctaLabel: 'Update Profile',
              onCtaClick: () => onChangeTab('profile'),
            }}
          />

          {ashaRequestError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {ashaRequestError}
            </div>
          )}

          {!profile?.village?.trim() || !profile?.mandal?.trim() || !profile?.ashaFollowupConsent ? (
            <button
              type="button"
              onClick={() => onChangeTab('profile')}
              aria-label="Open your profile to complete ASHA connection details"
              className="w-full rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-left transition hover:border-teal-400 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <span className="block text-sm text-gray-600">
                Add your village and mandal and enable ASHA follow-up consent in your profile to connect with your local worker.
              </span>
              {!profile?.village?.trim() && (
                <span className="mt-2 block text-xs text-gray-500">Village is missing from your profile.</span>
              )}
              {!profile?.mandal?.trim() && (
                <span className="mt-1 block text-xs text-gray-500">Mandal is missing from your profile.</span>
              )}
              {!profile?.ashaFollowupConsent && (
                <span className="mt-1 block text-xs text-gray-500">ASHA follow-up consent is not enabled.</span>
              )}
              <span className="mt-3 inline-block rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white">
                Update Profile to Connect
              </span>
            </button>
          ) : ashaCare.ashaWorkers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">
              <p>
                No approved ASHA Worker is currently assigned to {profile.village}, {profile.mandal}.
              </p>
              {ashaCare.request?.status === 'pending' ? (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-medium text-amber-900">
                  Your ASHA Worker request is waiting for hospital assignment.
                </p>
              ) : ashaCare.request?.status === 'assigned' ? (
                <p className="mt-3 rounded-lg bg-teal-50 p-3 text-xs font-medium text-teal-900">
                  Your request has been assigned. The worker information will appear when their account is active.
                </p>
              ) : (
                ashaRequestFormOpen ? (
                  <div className="mt-4 space-y-3">
                    <label className="block text-xs font-semibold text-gray-700">
                      Choose PHC / Hospital
                      <select
                        required
                        value={ashaRequestHospitalId}
                        onChange={(event) => setAshaRequestHospitalId(event.target.value)}
                        className="mt-1 w-full max-w-lg rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm"
                      >
                        <option value="">Select a facility</option>
                        {ashaRequestFacilities.map((facility) => (
                          <option key={facility.id} value={facility.id}>
                            {facility.name} · {facility.city}, {facility.state}
                          </option>
                        ))}
                      </select>
                    </label>
                    {ashaRequestFacilities.length === 0 && (
                      <p className="text-xs text-amber-800">No active PHC/Hospital options are available.</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={ashaRequestSubmitting || !ashaRequestHospitalId}
                        onClick={() => void handleRequestAshaWorker()}
                        className="ad-btn-teal rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {ashaRequestSubmitting ? 'Sending request…' : 'Submit ASHA Worker Request'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAshaRequestFormOpen(false)}
                        className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={ashaFacilitiesLoading}
                    onClick={() => void openAshaRequestForm()}
                    className="ad-btn-teal mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {ashaFacilitiesLoading ? 'Loading facilities…' : 'Request ASHA Worker'}
                  </button>
                )
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {ashaCare.ashaWorkers.map((worker) => (
                <SignatureCard
                  key={worker.id}
                  variant="navy"
                  topRightBadge={`Assigned · ${worker.village}`}
                  icon={<User className="w-5 h-5" />}
                  pillLabel="Assigned ASHA Worker"
                  title={worker.fullName}
                  meta={`${worker.hospitalName} · ${worker.phone} · ${worker.village}, ${worker.mandal || ''}`}
                  footer={{
                    label: 'Assigned location',
                    value: `${worker.village}, ${worker.mandal || ''}`,
                    rightSlot: (
                      <a
                        href={`tel:${worker.phone}`}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800"
                      >
                        Call worker
                      </a>
                    ),
                  }}
                />
              ))}
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-900">ASHA follow-up history</h2>
            {ashaCare.followups.map((followup) => (
              <article key={followup.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-gray-900">{followup.ashaWorkerName}</h3>
                  <span className="text-xs text-gray-500">{followup.visitDate}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-teal-800">
                  {followup.type === 'screening_reminder'
                    ? 'Screening reminder'
                    : followup.type === 'appointment_followup'
                    ? 'Appointment follow-up'
                    : 'Follow-up visit'}
                </p>
                <p className="mt-1 text-xs font-medium text-teal-800">
                  {followup.outcome === 'education_provided'
                    ? 'Health education provided'
                    : followup.outcome === 'referred_to_doctor'
                    ? 'Referred to a doctor'
                    : 'Follow-up needed'}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{followup.notes}</p>
                {followup.followUpDate && (
                  <p className="mt-2 text-xs text-gray-500">Next follow-up: {followup.followUpDate}</p>
                )}
              </article>
            ))}
            {ashaCare.followups.length === 0 && (
              <p className="text-sm text-gray-500">No ASHA follow-up visits recorded.</p>
            )}
          </section>
        </div>
      )}

      {/* NORMAL APPOINTMENT BOOKING MODAL */}
      {bookingContext && (
        <div className="fixed inset-0 z-50 bg-[#0A192F]/55 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmBooking}
            className="bg-white border border-gray-200/80 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
          >
            <div className="ad-grad-teal px-6 py-4 text-white">
              <h3 className="text-lg font-bold font-display">Book Appointment</h3>
              <p className="text-xs text-white/85 mt-0.5">
                {bookingContext.doctor.fullName} ({bookingContext.doctor.specialization}) ·{' '}
                {bookingContext.hospital.name} · Fee ₹{bookingContext.doctor.consultationFee}
              </p>
            </div>
            <div className="p-6 space-y-4">

            {bookingFeedback && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {bookingFeedback}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  required
                  min={new Date().toISOString().slice(0, 10)}
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Consultation Mode
                </label>
                <select
                  value={bookingMode}
                  onChange={(e) => setBookingMode(e.target.value as 'video' | 'in_person')}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white"
                >
                  {bookingContext.doctor.onlineConsultationAvailable && (
                    <option value="video">Secure Video Consultation</option>
                  )}
                  {bookingContext.doctor.inPersonConsultationAvailable && (
                    <option value="in_person">In-Person Hospital Visit</option>
                  )}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Available Time Slots
              </label>
              {bookingSlots.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No consultation slots configured for this weekday. Please select another date.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {bookingSlots.map((slot) => (
                    <button
                      key={slot.time}
                      type="button"
                      disabled={!slot.available}
                      onClick={() => setSelectedSlot(slot.time)}
                      className={`py-2 text-xs font-mono font-semibold rounded-xl border cursor-pointer ${
                        !slot.available
                          ? 'bg-gray-100 text-gray-400 border-gray-200 line-through cursor-not-allowed'
                          : selectedSlot === slot.time
                          ? 'bg-[#0D5C58] text-white border-[#0D5C58]'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-[#0D5C58]'
                      }`}
                    >
                      {slot.time}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {screenings.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Attach Screening Report (Optional)
                </label>
                <select
                  value={bookingScreeningId}
                  onChange={(e) => setBookingScreeningId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white"
                >
                  <option value="">None</option>
                  {screenings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.reportCode} — {s.aiReport?.preliminaryRiskCategory || 'Screening'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Reason for Consultation
              </label>
              <textarea
                rows={2}
                required
                value={bookingReason}
                onChange={(e) => setBookingReason(e.target.value)}
                placeholder="Describe symptoms or screening concern..."
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBookingContext(null)}
                className="px-4 py-2 text-xs font-semibold border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={bookingLoading || !selectedSlot}
                className="ad-btn-teal px-5 py-2 text-xs font-semibold text-white disabled:opacity-50 rounded-xl cursor-pointer"
              >
                {bookingLoading ? 'Booking...' : 'Submit Appointment Request'}
              </button>
            </div>
            </div>
          </form>
        </div>
      )}

      {/* URGENT CONSULTATION REQUEST MODAL */}
      {urgentContext && (
        <div className="fixed inset-0 z-50 bg-[#0A192F]/55 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitUrgent}
            className="bg-white border border-gray-200/80 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
          >
            <div className="ad-grad-saffron px-6 py-4 text-white flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-white shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold font-display">
                  Urgent Consultation Request
                </h3>
                <p className="text-xs text-white/90 mt-0.5">
                  Hospital: {urgentContext.hospital.name} ({urgentContext.hospital.phone})
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">

            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
              Submitting an urgent request notifies available specialists at this hospital, but
              immediate care is not guaranteed until a doctor accepts. If you have severe bleeding
              or breathing/swallowing difficulty, go to an emergency department immediately.
            </div>

            {bookingFeedback && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {bookingFeedback}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Preferred Mode
              </label>
              <select
                value={urgentMode}
                onChange={(e) => setUrgentMode(e.target.value as 'video' | 'in_person')}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="video">Urgent Video Consultation</option>
                <option value="in_person">Urgent In-Person Hospital Visit</option>
              </select>
            </div>

            {screenings.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Link Screening Report
                </label>
                <select
                  value={urgentScreeningId}
                  onChange={(e) => setUrgentScreeningId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">None</option>
                  {screenings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.reportCode} — {s.aiReport?.preliminaryRiskCategory || 'Screening'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Brief Urgent Reason
              </label>
              <textarea
                rows={3}
                required
                value={urgentReason}
                onChange={(e) => setUrgentReason(e.target.value)}
                placeholder="Describe symptoms requiring prompt specialist attention..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUrgentContext(null)}
                className="px-4 py-2 text-xs font-semibold border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={bookingLoading}
                className="px-5 py-2 text-xs font-semibold text-white bg-gradient-to-br from-rose-600 to-red-700 hover:opacity-95 rounded-xl cursor-pointer"
              >
                {bookingLoading ? 'Notifying Hospital...' : 'Send Urgent Request'}
              </button>
            </div>
            </div>
          </form>
        </div>
      )}

      {/* ACTIVE VIDEO CONSULTATION */}
      {activeCallAppointment && (
        <VideoConsultationRoom
          appointmentId={activeCallAppointment.id}
          appointmentCode={activeCallAppointment.appointmentCode}
          patientName={profile?.fullName || userName}
          doctorName={activeCallAppointment.doctorName}
          userRole="patient"
          userName={profile?.fullName || userName}
          sendWsMessage={sendWsMessage}
          lastSignalMessage={lastSignalMessage}
          onClose={() => setActiveCallAppointment(null)}
        />
      )}
    </div>
  );
}

export const PATIENT_NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'screening', label: 'Start Screening', icon: FileText },
  { id: 'discover', label: 'Hospitals & Doctors', icon: Hospital },
  { id: 'appointments', label: 'Appointments', icon: Calendar },
  { id: 'history', label: 'Medical History', icon: History },
  { id: 'age-classification', label: 'Age Classification', icon: Users },
  { id: 'profile', label: 'Personal Profile', icon: User },
  { id: 'asha', label: 'Village ASHA', icon: MapPin },
];
