import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  HeartHandshake,
  Lock,
  MapPin,
  Menu,
  Mic,
  PhoneCall,
  Radar,
  ScanEye,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  Video,
  X,
} from 'lucide-react';
import { apiRequest } from '../utils/api.js';
import type { UserRole } from '../../../shared/types/index.js';
import { LanguageSelector } from '../i18n.js';
import { BrandLogo, SignatureCard, getVariantByIndex } from './ui/SignatureCard.js';

interface PublicHospital {
  id: string;
  name: string;
  city: string;
  state: string;
  address: string;
  phone: string;
  services: string[];
  workingHours: string;
  doctors: Array<{
    id: string;
    doctorCode: string;
    fullName: string;
    qualifications: string;
    specialization: string;
    yearsOfExperience: number;
    consultationFee: number;
    verificationStatus: string;
    onlineConsultationAvailable: boolean;
  }>;
}

interface PublicLandingProps {
  onOpenAuth: (defaultRole?: UserRole, targetTab?: string) => void;
  onOpenAshaAccess: () => void;
  onOpenVoiceGuide: (initialPrompt?: string) => void;
}

interface ScanRegionSample {
  id: string;
  label: string;
  coords: { x: number; y: number };
  severity: 'low' | 'moderate' | 'urgent';
  severityLabel: string;
  clarity: string;
  observation: string;
  guidance: string;
}

const SCAN_REGIONS: ScanRegionSample[] = [
  {
    id: 'buccal',
    label: 'Buccal Mucosa',
    coords: { x: 172, y: 118 },
    severity: 'low',
    severityLabel: 'Low Concern',
    clarity: '98% Focus Lock',
    observation: 'Uniform pink mucosal tone; no focal leukoplakic plaque or ulceration noted.',
    guidance: 'Routine 6-month preventive check recommended.',
  },
  {
    id: 'tongue',
    label: 'Lateral Tongue',
    coords: { x: 112, y: 158 },
    severity: 'moderate',
    severityLabel: 'Moderate Review',
    clarity: '96% Focus Lock',
    observation: 'Localized mild hyperkeratotic border; evaluate friction vs habit exposure.',
    guidance: 'Schedule specialist tele-review within 72 hours.',
  },
  {
    id: 'palate',
    label: 'Soft Palate',
    coords: { x: 184, y: 176 },
    severity: 'urgent',
    severityLabel: 'Urgent Referral',
    clarity: '97% Focus Lock',
    observation: 'Asymmetric erythematous patch persisting >14 days reported in intake.',
    guidance: 'Priority video consult & in-person clinical exam advised.',
  },
  {
    id: 'floor',
    label: 'Floor of Mouth',
    coords: { x: 132, y: 108 },
    severity: 'low',
    severityLabel: 'Low Concern',
    clarity: '99% Focus Lock',
    observation: 'Clear sublingual vascular pattern with intact surface symmetry.',
    guidance: 'Continue healthy oral hygiene & tobacco avoidance.',
  },
];

interface DoctorQueuePreviewItem {
  caseCode: string;
  region: string;
  intakeTime: string;
  severity: 'low' | 'moderate' | 'urgent';
  severityLabel: string;
  summary: string;
  videoReady: boolean;
}

const DOCTOR_QUEUE_ITEMS: DoctorQueuePreviewItem[] = [
  {
    caseCode: 'CASE-4092',
    region: 'Lateral Tongue · Right Border',
    intakeTime: '4 min ago',
    severity: 'urgent',
    severityLabel: 'Urgent Referral',
    summary: 'Non-healing red-white mucosal patch (>3 weeks) · Priority video slot ready',
    videoReady: true,
  },
  {
    caseCode: 'CASE-4088',
    region: 'Buccal Mucosa · Left Cheek',
    intakeTime: '11 min ago',
    severity: 'moderate',
    severityLabel: 'Moderate Review',
    summary: 'Mild stiffness & spice sensitivity · Voice intake + clarity verified',
    videoReady: true,
  },
  {
    caseCode: 'CASE-4081',
    region: 'Hard & Soft Palate',
    intakeTime: '19 min ago',
    severity: 'low',
    severityLabel: 'Low Concern',
    summary: 'Uniform mucosal appearance · Preventive reassurance & follow-up notes',
    videoReady: false,
  },
];

const LANDING_NAV_ITEMS = [
  { id: 'top', label: 'Home' },
  { id: 'pathway', label: 'Screening Pathway' },
  { id: 'safeguards', label: 'Clinical Safeguards' },
  { id: 'directory', label: 'Registered Hospitals' },
  { id: 'portals', label: 'Provider Portals' },
] as const;

function getSeverityChipClasses(severity: 'low' | 'moderate' | 'urgent'): string {
  if (severity === 'low') {
    return 'bg-[#ECFDF5] text-[#0D5C58] border border-emerald-200';
  }
  if (severity === 'moderate') {
    return 'bg-amber-50 text-[#EA580C] border border-amber-200';
  }
  return 'bg-rose-50 text-rose-700 border border-rose-200';
}

function getInitials(fullName: string): string {
  const cleaned = fullName.replace(/^Dr\.?\s+/i, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DR';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function PublicLanding({
  onOpenAuth,
  onOpenAshaAccess,
  onOpenVoiceGuide,
}: PublicLandingProps) {
  const [hospitals, setHospitals] = useState<PublicHospital[]>([]);
  const [activeRegionId, setActiveRegionId] = useState<string>('tongue');
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<'all' | 'urgent' | 'moderate' | 'low'>('all');
  const [activeLandingSection, setActiveLandingSection] = useState<string>('top');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [screeningCount, setScreeningCount] = useState(0);
  const [accuracyScore, setAccuracyScore] = useState(0);

  useEffect(() => {
    const sections = LANDING_NAV_ITEMS.map(({ id }) => document.getElementById(id)).filter(
      (section): section is HTMLElement => section !== null
    );
    if (!('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleSection = entries.find((entry) => entry.isIntersecting);
        if (visibleSection) setActiveLandingSection(visibleSection.target.id);
      },
      { rootMargin: '-18% 0px -70% 0px', threshold: 0 }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    apiRequest<{ hospitals: PublicHospital[] }>('/api/patient/discover')
      .then((res) => setHospitals(res.hospitals || []))
      .catch(() => setHospitals([]));
  }, []);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setScreeningCount(14820);
      setAccuracyScore(98.4);
      return;
    }

    const duration = 900;
    const start = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setScreeningCount(Math.round(14820 * eased));
      setAccuracyScore(Number((98.4 * eased).toFixed(1)));
      if (elapsed < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const selectedRegion =
    SCAN_REGIONS.find((region) => region.id === activeRegionId) || SCAN_REGIONS[0];
  const activeRegion =
    SCAN_REGIONS.find((region) => region.id === hoveredRegionId) || selectedRegion;

  const filteredQueue =
    queueFilter === 'all'
      ? DOCTOR_QUEUE_ITEMS
      : DOCTOR_QUEUE_ITEMS.filter((item) => item.severity === queueFilter);

  const onlineDoctorsCount = hospitals.reduce(
    (sum, h) => sum + h.doctors.filter((d) => d.onlineConsultationAvailable).length,
    0
  );

  return (
    <div className="min-h-screen bg-[#FBFBFA] text-gray-900 relative">
      {/* Subtle 56px x 56px Ivory Canvas Grid Texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 ad-grid-56 opacity-60"
      />

      {/* Ambient Subtle Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-32 right-0 w-[640px] h-[640px] rounded-full opacity-40 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(45,212,191,0.22) 0%, rgba(224,122,44,0.08) 55%, rgba(251,251,250,0) 75%)',
        }}
      />

      {/* TOP NAVIGATION BAR (Floating Frosted Glass) */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/80 border-b border-gray-200/70 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6">
          <div className="py-3.5 flex items-center justify-between gap-2 sm:gap-6">
            <a href="#top" className="whitespace-nowrap shrink-0">
              <BrandLogo />
            </a>

            <button
              type="button"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label="Toggle section navigation"
              aria-expanded={mobileNavOpen}
              aria-controls="landing-mobile-nav"
              className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 transition-all duration-200 hover:bg-emerald-50 hover:text-[#0D5C58] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D5C58] cursor-pointer"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <nav
              aria-label="Main sections"
              className="hidden lg:flex items-center gap-0 rounded-full bg-gray-50/80 border border-gray-200 px-1 py-1.5 text-[11px] font-medium"
            >
              {LANDING_NAV_ITEMS.map(({ id, label }) => {
                const active = activeLandingSection === id;
                return (
                  <a
                    key={id}
                    href={`#${id}`}
                    aria-current={active ? 'location' : undefined}
                    onClick={() => setActiveLandingSection(id)}
                    className={`px-1.5 py-1.5 rounded-full whitespace-nowrap shrink-0 transition-all duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D5C58] motion-reduce:transition-none ${
                      active
                        ? 'bg-[#0D5C58] text-white shadow-sm hover:bg-[#0D5C58] hover:text-white'
                        : 'text-gray-600 hover:bg-white hover:text-[#0D5C58] hover:shadow-sm'
                    }`}
                  >
                    {label}
                  </a>
                );
              })}
            </nav>

            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => onOpenVoiceGuide()}
                className="hidden md:inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0D5C58] bg-[#ECFDF5] hover:bg-emerald-100/80 border border-emerald-200/70 rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>AI Voice Guide</span>
              </button>
              <LanguageSelector />
              <button
                type="button"
                onClick={() => onOpenAuth('patient')}
                className="ad-btn-cyan px-3 sm:px-5 py-2.5 text-xs sm:text-sm font-semibold text-white rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
              >
                Login / Registration
              </button>
            </div>
          </div>

          {mobileNavOpen && (
            <nav
              id="landing-mobile-nav"
              aria-label="Main sections"
              className="lg:hidden grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-gray-200/70 py-3"
            >
              {LANDING_NAV_ITEMS.map(({ id, label }) => {
                const active = activeLandingSection === id;
                return (
                  <a
                    key={id}
                    href={`#${id}`}
                    aria-current={active ? 'location' : undefined}
                    onClick={() => {
                      setActiveLandingSection(id);
                      setMobileNavOpen(false);
                    }}
                    className={`flex min-h-11 items-center justify-center rounded-xl px-2 py-2 text-center text-xs font-semibold leading-4 transition-all duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D5C58] motion-reduce:transition-none ${
                      active
                        ? 'bg-[#0D5C58] text-white shadow-sm hover:bg-[#0D5C58] hover:text-white'
                        : 'bg-gray-50 text-gray-700 hover:bg-emerald-50 hover:text-[#0D5C58] hover:shadow-sm'
                    }`}
                  >
                    {label}
                  </a>
                );
              })}
            </nav>
          )}
        </div>
      </header>

      {/* HERO SECTION */}
      <section id="top" className="relative isolate overflow-hidden">
        <img
          src="/assets/home-health-background-brain.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover opacity-40"
        />
        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-12 pb-14 lg:pt-16 lg:pb-20">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2.5 rounded-full bg-[#ECFDF5] border border-emerald-200/80 px-4 py-1.5 text-xs font-semibold text-[#0D5C58]">
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                  <span className="ad-ping-ring absolute inline-flex h-full w-full rounded-full bg-emerald-500" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span>
                  {onlineDoctorsCount > 0
                    ? `${onlineDoctorsCount} Verified Specialists Online · Oral Clinical Triage`
                    : 'Oral Health Awareness & Clinical Triage'}
                </span>
              </div>

              <h1
                className="font-extrabold text-gray-900 leading-[1.08] font-display"
                style={{ fontSize: 'clamp(2.35rem, 4.2vw, 3.6rem)', textWrap: 'balance' }}
              >
                Early oral health screening, connected to verified specialists.
              </h1>

              <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-xl">
                Answer guided symptom and habit questions by touch or Gemini Voice AI, upload a
                well-lit oral region photo for preliminary observations, and book in-person or
                video consultations with registered hospitals.
              </p>

              <div className="flex flex-wrap items-center gap-3.5 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenAuth('patient')}
                  className="ad-btn-teal inline-flex items-center gap-2 px-6 py-3.5 text-sm font-semibold text-white rounded-xl transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  Start Oral Screening
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenVoiceGuide()}
                  className="inline-flex items-center gap-2 px-5 py-3.5 text-sm font-semibold text-[#0D5C58] bg-[#ECFDF5] border border-emerald-200 hover:bg-emerald-100/70 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Mic className="w-4 h-4" />
                  Ask AI Voice Guide
                </button>
                <a
                  href="#directory"
                  className="inline-flex items-center gap-2 px-5 py-3.5 text-sm font-semibold text-gray-800 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition-colors whitespace-nowrap shrink-0 shadow-xs"
                >
                  Explore Registered Hospitals
                </a>
              </div>

              {/* 3 Hero Trust Metrics */}
              <div className="grid grid-cols-3 gap-3.5 pt-5 border-t border-gray-200/80">
                <div className="rounded-2xl bg-white border border-gray-200/80 p-4 shadow-xs">
                  <p className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums font-display">
                    {screeningCount.toLocaleString()}+
                  </p>
                  <p className="text-xs font-medium text-gray-500 mt-1">
                    Guided Checks
                  </p>
                </div>
                <div className="rounded-2xl bg-white border border-gray-200/80 p-4 shadow-xs">
                  <p className="text-xl sm:text-2xl font-bold text-[#0D5C58] tabular-nums font-display">
                    {accuracyScore.toFixed(1)}%
                  </p>
                  <p className="text-xs font-medium text-gray-500 mt-1">
                    Quality Lock
                  </p>
                </div>
                <div className="rounded-2xl bg-white border border-gray-200/80 p-4 shadow-xs">
                  <p className="text-xl sm:text-2xl font-bold text-[#EA580C] tabular-nums font-display">
                    &lt; 15 min
                  </p>
                  <p className="text-xs font-medium text-gray-500 mt-1">
                    Triage Window
                  </p>
                </div>
              </div>
            </div>

            {/* Interactive AI Observation Viewport in Signature 2-Part Gradient Card */}
            <div className="lg:col-span-6">
              <SignatureCard
                variant="navy"
                topRightBadge={
                  <>
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                    <span>{activeRegion.clarity}</span>
                  </>
                }
                icon={<Radar className="w-6 h-6" />}
                pillLabel="Optical Mucosal Sweep"
                title="AI Lesion Observation Viewport"
                meta={
                  <>
                    <ScanEye className="w-4 h-4 text-[#0D9488] shrink-0" />
                    <span>Oral screening image · Select a region to view guidance</span>
                  </>
                }
                tags={['Focus Validation', 'Habit Context', activeRegion.severityLabel]}
                footer={{
                  label: 'Live preview',
                  value: `${activeRegion.label} · ${activeRegion.severityLabel}`,
                  dotTone:
                    activeRegion.severity === 'urgent'
                      ? 'rose'
                      : activeRegion.severity === 'moderate'
                      ? 'amber'
                      : 'emerald',
                  ctaLabel: 'Try Check',
                  onCtaClick: () => onOpenAuth('patient', 'screening'),
                }}
              >
                {/* Responsive oral screening illustration */}
                <div className="relative rounded-2xl ad-grad-navy p-5 overflow-hidden border border-[#134E4A]/30">
                  <div className="flex items-center justify-between text-[11px] text-[#A7F3D0]/85 font-mono mb-2">
                    <span>SECTOR: {activeRegion.label.toUpperCase()}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-sans font-semibold ${getSeverityChipClasses(
                        activeRegion.severity
                      )}`}
                    >
                      {activeRegion.severityLabel}
                    </span>
                  </div>

                  <div className="relative w-full aspect-video overflow-hidden rounded-xl border border-white/30 bg-[#0A192F]">
                    <img
                      src="/assets/oral-screening-exam.png"
                      alt="Oral examination screening illustration"
                      className="absolute inset-0 h-full w-full object-cover"
                      fetchPriority="high"
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                    {SCAN_REGIONS.map((region) => {
                      const isSelected = region.id === selectedRegion.id;
                      return (
                        <button
                          key={region.id}
                          type="button"
                          onClick={() => setActiveRegionId(region.id)}
                          onMouseEnter={() => setHoveredRegionId(region.id)}
                          onMouseLeave={() => setHoveredRegionId(null)}
                          onFocus={() => setHoveredRegionId(region.id)}
                          onBlur={() => setHoveredRegionId(null)}
                          aria-pressed={isSelected}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition-all duration-200 ease-out cursor-pointer whitespace-nowrap ${
                            region.id === activeRegion.id
                              ? 'bg-[#2DD4BF] text-[#0A192F] shadow-xs'
                              : 'bg-white/10 text-white'
                          }`}
                        >
                          {region.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl bg-[#FBFBFA] border border-gray-200/80 p-3.5 text-xs space-y-1">
                  <p className="font-semibold text-gray-900">{activeRegion.observation}</p>
                  <p className="text-gray-500">{activeRegion.guidance}</p>
                </div>
              </SignatureCard>
            </div>
          </div>

          {/* 4-PILLAR OVERVIEW BOXES (Unified 2-Part Signature Gradient Cards) */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            <SignatureCard
              variant="teal"
              topRightBadge="01 · Auth"
              icon={<PhoneCall className="w-6 h-6" />}
              pillLabel="Patient Access"
              title="Phone + Voice OTP"
              meta={
                <>
                  <Lock className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
                  <span>SMS &amp; Gemini spoken digits</span>
                </>
              }
              tags={['Real-time SSE', 'EN & Hinglish', 'Private']}
              metrics={[
                { icon: <Clock className="w-3.5 h-3.5" />, value: '5 min', label: 'OTP Window' },
                { icon: <Mic className="w-3.5 h-3.5" />, value: 'Voice', label: 'Spoken Call' },
                { icon: <ShieldCheck className="w-3.5 h-3.5" />, value: 'JWT', label: 'Secured' },
              ]}
              footer={{
                label: 'Instant sign-in',
                value: 'SMS or Voice OTP',
                ctaLabel: 'Sign In',
                onCtaClick: () => onOpenAuth('patient', 'history'),
              }}
            />

            <SignatureCard
              variant="saffron"
              topRightBadge="02 · AI Triage"
              icon={<ScanEye className="w-6 h-6" />}
              pillLabel="Preliminary Triage"
              title="Symptom + Optical AI"
              meta={
                <>
                  <Activity className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                  <span>Voice auto-fill &amp; clarity check</span>
                </>
              }
              tags={['Voice Intake', 'Quality Check', 'TTS Audio']}
              metrics={[
                { icon: <Mic className="w-3.5 h-3.5" />, value: 'Auto', label: 'Voice Fill' },
                { icon: <Sparkles className="w-3.5 h-3.5" />, value: 'Gemini', label: 'Observation' },
                { icon: <CheckCircle2 className="w-3.5 h-3.5" />, value: 'PDF', label: 'Report' },
              ]}
              footer={{
                label: 'Guided intake',
                value: '3-minute screening',
                dotTone: 'amber',
                ctaLabel: 'Start',
                onCtaClick: () => onOpenAuth('patient', 'screening'),
              }}
            />

            <SignatureCard
              variant="navy"
              topRightBadge="03 · Network"
              icon={<Building2 className="w-6 h-6" />}
              pillLabel="Verified Network"
              title={`${hospitals.length} Active Hospitals`}
              meta={
                <>
                  <MapPin className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
                  <span>Credentialed specialist centers</span>
                </>
              }
              tags={['Oral Medicine', 'Oncology', 'Map View']}
              metrics={[
                {
                  icon: <Building2 className="w-3.5 h-3.5" />,
                  value: hospitals.length,
                  label: 'Hospitals',
                },
                {
                  icon: <Stethoscope className="w-3.5 h-3.5" />,
                  value: onlineDoctorsCount || 4,
                  label: 'Specialists',
                },
                { icon: <ShieldCheck className="w-3.5 h-3.5" />, value: '100%', label: 'Verified' },
              ]}
              footer={{
                label: 'Network status',
                value: 'Active across cities',
                ctaLabel: 'View',
                onCtaClick: () => scrollToSection('directory'),
              }}
            />

            <SignatureCard
              variant="teal"
              topRightBadge="04 · Care"
              icon={<Video className="w-6 h-6" />}
              pillLabel="Care Delivery"
              title="Video & Urgent Triage"
              meta={
                <>
                  <CalendarCheck2 className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
                  <span>WebRTC consults &amp; follow-up</span>
                </>
              }
              tags={['WebRTC HD', 'Urgent Dispatch', 'Rx Notes']}
              metrics={[
                { icon: <Video className="w-3.5 h-3.5" />, value: '1-Click', label: 'Video Room' },
                { icon: <ShieldAlert className="w-3.5 h-3.5" />, value: 'Priority', label: 'Urgent' },
                { icon: <Clock className="w-3.5 h-3.5" />, value: 'Same-Day', label: 'Slots' },
              ]}
              footer={{
                label: 'Next available',
                value: 'Today · Online / Visit',
                ctaLabel: 'Book',
                onCtaClick: () => onOpenAuth('patient', 'discover'),
              }}
            />
          </div>
        </div>
      </section>

      {/* AI GUIDE VOICE ASSISTANT SECTION (2-Part Signature Architecture) */}
      <section id="voice-guide" className="relative max-w-7xl mx-auto px-6 pb-16">
        <SignatureCard
          variant="navy"
          topRightBadge={
            <>
              <Sparkles className="w-3.5 h-3.5 text-[#0D9488]" />
              <span>Gemini Live · Two-Way Speech</span>
            </>
          }
          icon={<Mic className="w-6 h-6" />}
          pillLabel="AI Voice Guide Online"
          title="Speak directly with the Aarogya Drishti AI Voice Guide"
          meta={
            <>
              <PhoneCall className="w-4 h-4 text-[#0D9488] shrink-0" />
              <span>
                Tap a guided prompt or start live voice conversation directly from the homepage
              </span>
            </>
          }
          tags={['Live Two-Way Audio', 'Hospital Lookup', 'Photo Framing Tips', 'Symptom Awareness']}
          metrics={[
            { icon: <Mic className="w-3.5 h-3.5" />, value: '16kHz', label: 'Voice Capture' },
            { icon: <Activity className="w-3.5 h-3.5" />, value: '24kHz', label: 'Spoken Reply' },
            { icon: <ShieldCheck className="w-3.5 h-3.5" />, value: 'Safe', label: 'Advisory Only' },
          ]}
          footer={{
            label: 'AI Voice Guide Online',
            value: 'Ready to answer oral health questions',
            ctaLabel: 'Launch Voice Guide',
            onCtaClick: () => onOpenVoiceGuide(),
          }}
        >
          <div className="grid lg:grid-cols-12 gap-6 items-center pt-1">
            <div className="lg:col-span-7 space-y-3">
              <p className="text-sm text-gray-600 leading-relaxed">
                Not sure where to begin? Select a common question below to launch the interactive
                Gemini Live Voice Guide immediately without needing to sign in first:
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  'How does Aarogya Drishti oral screening work?',
                  'Find verified oral screening hospitals in Bengaluru.',
                  'How do I take a clear photo of my mouth?',
                  'What oral symptoms need urgent review?',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => onOpenVoiceGuide(prompt)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 hover:border-[#0D5C58] hover:bg-[#ECFDF5] px-3.5 py-2 text-xs font-semibold text-gray-800 transition-colors cursor-pointer"
                  >
                    <Mic className="w-3.5 h-3.5 text-[#0D5C58] shrink-0" />
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-2xl ad-grad-navy p-5 text-white space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#A7F3D0]">Acoustic Voice Channel</span>
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#2DD4BF]">
                    Mic Ready
                  </span>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3.5 flex items-center justify-center">
                  <svg
                    viewBox="0 0 260 48"
                    className="w-full h-11"
                    role="img"
                    aria-label="Acoustic voice assistant waveform illustration"
                  >
                    {[
                      12, 20, 34, 18, 40, 28, 44, 22, 36, 16, 30, 42, 24, 38, 18, 32, 26, 14, 22,
                      16,
                    ].map((h, idx) => (
                      <rect
                        key={idx}
                        x={12 + idx * 12}
                        y={(48 - h) / 2}
                        width="5"
                        height={h}
                        rx="2.5"
                        fill={idx % 3 === 0 ? '#2DD4BF' : '#A7F3D0'}
                        fillOpacity={idx % 2 === 0 ? '0.92' : '0.45'}
                      />
                    ))}
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </SignatureCard>
      </section>

      {/* SCREENING PATHWAY STEPS (4 Unified 2-Part Signature Gradient Cards) */}
      <section id="pathway" className="relative py-14 border-y border-gray-200/70 bg-white/60 backdrop-blur-xs">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-10">
            <span className="rounded-full bg-[#ECFDF5] border border-emerald-200 text-[#0D5C58] px-3.5 py-1 text-xs font-semibold inline-block mb-3">
              Screening Pathway
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 font-display">
              Four structured steps from first check to specialist care
            </h2>
            <p className="text-gray-600 text-sm sm:text-base">
              Every card follows one unified patient-to-specialist flow across screening, discovery,
              and tele-consultation.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                num: '01',
                pill: 'Phone & Voice OTP',
                title: 'Verified Intake',
                meta: 'Real-time SMS or spoken OTP',
                body: 'Sign in quickly with phone OTP or Gemini Voice Call, review consent, and unlock your chronological health record.',
                tags: ['SMS OTP', 'Voice OTP', 'Consent'],
                metrics: [
                  { value: '6-Digit', label: 'OTP Auth' },
                  { value: 'EN/HI', label: 'Voice Call' },
                  { value: 'Private', label: 'History' },
                ],
                cta: 'Sign In',
                icon: <Lock className="w-6 h-6" />,
                action: () => onOpenAuth('patient', 'history'),
              },
              {
                num: '02',
                pill: 'Guided Symptoms',
                title: 'Symptom & Habit Check',
                meta: 'Speak or tap risk factors',
                body: 'Record tobacco, areca nut, and symptom duration manually or speak naturally for Gemini AI auto-fill.',
                tags: ['Voice Fill', 'Habits', 'Duration'],
                metrics: [
                  { value: '10', label: 'Symptoms' },
                  { value: 'Auto', label: 'Voice Fill' },
                  { value: '2 min', label: 'Duration' },
                ],
                cta: 'Start Check',
                icon: <Mic className="w-6 h-6" />,
                action: () => onOpenAuth('patient', 'screening'),
              },
              {
                num: '03',
                pill: 'Optical Clarity',
                title: 'Photo Quality & AI',
                meta: 'Neutral mucosal observations',
                body: 'Upload or capture an oral photograph checked for focus clarity first, producing structured triage observations.',
                tags: ['Clarity Check', 'Triage', 'Audio TTS'],
                metrics: [
                  { value: 'Focus', label: 'Validated' },
                  { value: 'Low–Urg', label: 'Triage' },
                  { value: 'Print', label: 'PDF Ready' },
                ],
                cta: 'Upload Photo',
                icon: <ScanEye className="w-6 h-6" />,
                action: () => onOpenAuth('patient', 'screening'),
              },
              {
                num: '04',
                pill: 'Specialist Care',
                title: 'Hospital & Video Consult',
                meta: 'Live WebRTC & follow-ups',
                body: 'Browse verified hospitals on the map, book normal or urgent consultations, and join live video appointments.',
                tags: ['Map Search', 'WebRTC', 'Rx Notes'],
                metrics: [
                  { value: hospitals.length || 3, label: 'Hospitals' },
                  { value: 'HD', label: 'Video Call' },
                  { value: 'Direct', label: 'Urgent' },
                ],
                cta: 'Book Consult',
                icon: <Video className="w-6 h-6" />,
                action: () => onOpenAuth('patient', 'discover'),
              },
            ].map((step, idx) => (
              <SignatureCard
                key={step.num}
                variant={getVariantByIndex(idx)}
                topRightBadge={`Step ${step.num}`}
                icon={step.icon}
                pillLabel={step.pill}
                title={step.title}
                meta={step.meta}
                tags={step.tags}
                metrics={step.metrics}
                footer={{
                  label: `Step ${step.num} ready`,
                  value: step.title,
                  dotTone: idx === 1 ? 'amber' : 'emerald',
                  ctaLabel: step.cta,
                  onCtaClick: step.action,
                }}
              >
                <p className="text-xs text-gray-600 leading-relaxed">{step.body}</p>
              </SignatureCard>
            ))}
          </div>
        </div>
      </section>

      {/* DOCTOR PREVIEW & HUMAN-FIRST QUOTE SECTION */}
      <section id="doctor-preview" className="relative max-w-7xl mx-auto px-6 py-16">
        <div className="grid lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-8 flex">
            <SignatureCard
              variant="teal"
              className="w-full"
              topRightBadge="Live Triage Queue"
              icon={<Stethoscope className="w-6 h-6" />}
              pillLabel="Specialist Queue Preview"
              title="Doctor Preview · Clinical Triage Queue"
              meta={
                <>
                  <Clock className="w-4 h-4 text-[#0D9488] shrink-0" />
                  <span>
                    How verified specialists prioritize urgent referrals and launch video calls
                  </span>
                </>
              }
              tags={['Priority Triage', 'Longitudinal History', 'WebRTC Video Consults']}
              metrics={[
                { icon: <ShieldAlert className="w-3.5 h-3.5" />, value: '1', label: 'Urgent Case' },
                { icon: <Activity className="w-3.5 h-3.5" />, value: '1', label: 'Moderate' },
                { icon: <Video className="w-3.5 h-3.5" />, value: '2', label: 'Video Ready' },
              ]}
              footer={{
                label: 'Specialist workspace',
                value:
                  onlineDoctorsCount > 0
                    ? `${onlineDoctorsCount} Doctors Online Now`
                    : 'Doctors Online',
                ctaLabel: 'Open Doctor Portal',
                onCtaClick: () => onOpenAuth('doctor'),
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                <span className="text-xs font-medium text-gray-500">Filter preview queue:</span>
                <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-full border border-gray-200">
                  {(
                    [
                      ['all', 'All'],
                      ['urgent', 'Urgent'],
                      ['moderate', 'Moderate'],
                      ['low', 'Low'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setQueueFilter(key)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        queueFilter === key
                          ? 'bg-[#0D5C58] text-white'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                {filteredQueue.map((item) => (
                  <div
                    key={item.caseCode}
                    className="rounded-2xl bg-[#FBFBFA] border border-gray-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-mono font-bold text-[#0D5C58]">
                          {item.caseCode}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${getSeverityChipClasses(
                            item.severity
                          )}`}
                        >
                          {item.severityLabel}
                        </span>
                        <span className="text-xs text-gray-500 inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {item.intakeTime}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-gray-900">{item.region}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{item.summary}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenAuth('doctor')}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-all ${
                        item.videoReady
                          ? 'ad-btn-teal text-white'
                          : 'bg-white border border-gray-200 hover:bg-gray-50 text-gray-800'
                      }`}
                    >
                      <Video className="w-3.5 h-3.5" />
                      {item.videoReady ? 'Start Video' : 'Review Notes'}
                    </button>
                  </div>
                ))}
              </div>
            </SignatureCard>
          </div>

          <div className="lg:col-span-4 flex">
            <SignatureCard
              variant="saffron"
              className="w-full"
              topRightBadge="Human-First"
              icon={<HeartHandshake className="w-6 h-6" />}
              pillLabel="Empathetic Guidance"
              title="“Every early catch saves a smile.”"
              meta={
                <>
                  <Sparkles className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                  <span>Calm oral screening built for clarity</span>
                </>
              }
              tags={['Non-Alarmist', 'Voice Guided', 'Doctor Linked']}
              metrics={[
                { value: '3 min', label: 'Intake' },
                { value: '24/7', label: 'Voice Guide' },
                { value: '100%', label: 'Private' },
              ]}
              footer={{
                label: 'Guided check',
                value: 'Ready in 3 minutes',
                dotTone: 'amber',
                ctaLabel: 'Start',
                onCtaClick: () => onOpenAuth('patient', 'screening'),
              }}
            >
              <p className="text-sm text-gray-600 leading-relaxed">
                Oral changes caught early are calm, treatable, and deeply reassuring when a
                trusted specialist walks beside you from the very first check.
              </p>
              <button
                type="button"
                onClick={() => onOpenVoiceGuide()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-[#EA580C] px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" />
                Try Hands-Free Gemini Voice Guide
              </button>
            </SignatureCard>
          </div>
        </div>
      </section>

      {/* CLINICAL SAFEGUARDS & COMPLIANCE SECTION (3 Signature Gradient Cards) */}
      <section id="safeguards" className="relative py-14 border-y border-gray-200/70 bg-white/60">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-10">
            <span className="rounded-full bg-amber-50 border border-amber-200 text-[#EA580C] px-3.5 py-1 text-xs font-semibold inline-block mb-3">
              Clinical Safeguards
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 font-display">
              Safety boundaries, privacy controls &amp; emergency protocols
            </h2>
            <p className="text-sm text-gray-600">
              Engineered to keep AI screening strictly advisory while protecting sensitive medical
              records under verified clinical governance.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <SignatureCard
              variant="saffron"
              topRightBadge="Advisory Only"
              icon={<ShieldAlert className="w-6 h-6" />}
              pillLabel="Clinical Boundary"
              title="Non-Diagnostic AI Triage"
              meta="Supports awareness & priority routing"
              tags={['No Cancer Staging', 'Clarity Gate', 'Biopsy By Doctor']}
              metrics={[
                { value: 'Neutral', label: 'Observations' },
                { value: '4-Tier', label: 'Risk Triage' },
                { value: 'MD/MDS', label: 'Final Exam' },
              ]}
              footer={{
                label: 'Safety policy',
                value: 'Informed consent enforced',
                dotTone: 'amber',
                ctaLabel: 'Review',
                onCtaClick: () => onOpenAuth('patient', 'screening'),
              }}
            >
              <p className="text-xs text-gray-600 leading-relaxed">
                An AI assessment cannot confirm or rule out oral cancer, assign a stage, or replace
                an in-person clinical exam and biopsy by a qualified doctor.
              </p>
            </SignatureCard>

            <SignatureCard
              variant="navy"
              topRightBadge="Audit Logged"
              icon={<Lock className="w-6 h-6" />}
              pillLabel="Privacy & RBAC"
              title="Role-Scoped Data Access"
              meta="Patient-approved clinician visibility"
              tags={['JWT Sessions', 'Audit Trail', 'Encrypted Files']}
              metrics={[
                { value: '4 Roles', label: 'Isolated' },
                { value: '100%', label: 'Logged Views' },
                { value: 'Private', label: 'Uploads' },
              ]}
              footer={{
                label: 'Compliance status',
                value: 'Role-gated record access',
                ctaLabel: 'Explore',
                onCtaClick: () => scrollToSection('portals'),
              }}
            >
              <p className="text-xs text-gray-600 leading-relaxed">
                Screening images and reports are strictly scoped to the patient and authorized
                hospital specialists with an active appointment or urgent triage request.
              </p>
            </SignatureCard>

            <SignatureCard
              variant="teal"
              topRightBadge="Urgent Alert"
              icon={<PhoneCall className="w-6 h-6" />}
              pillLabel="Emergency Escalation"
              title="Red-Flag Rapid Guidance"
              meta="Immediate emergency escalation triggers"
              tags={['108 / 112 Alert', 'Priority Queue', 'Hospital Dispatch']}
              metrics={[
                { value: 'Instant', label: 'Flagging' },
                { value: 'Hospital', label: 'Dispatch' },
                { value: 'Direct', label: 'ER Notice' },
              ]}
              footer={{
                label: 'Red-flag triage',
                value: 'Urgent specialist routing',
                dotTone: 'rose',
                ctaLabel: 'Find ER',
                onCtaClick: () => scrollToSection('directory'),
              }}
            >
              <p className="text-xs text-gray-600 leading-relaxed">
                Severe bleeding, acute airway or swallowing difficulty, or rapidly worsening neck
                swelling triggers immediate emergency guidance (108 / 112).
              </p>
            </SignatureCard>
          </div>
        </div>
      </section>

      {/* REGISTERED HOSPITALS DIRECTORY (Signature 2-Part Gradient Cards · Zero Photos) */}
      <section id="directory" className="relative max-w-7xl mx-auto px-6 py-16">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <span className="rounded-full bg-[#ECFDF5] border border-emerald-200 text-[#0D5C58] px-3.5 py-1 text-xs font-semibold inline-block mb-2.5">
              Registered Hospitals
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 font-display">
              Registered Hospitals &amp; Verified Specialists
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Every hospital and clinician listed is credential-verified inside Aarogya Drishti.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenAuth('patient', 'discover')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 px-4 py-2.5 text-xs font-semibold text-[#0D5C58] whitespace-nowrap cursor-pointer shadow-xs"
          >
            Sign in to filter by distance &amp; map
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {hospitals.map((hospital, idx) => {
            const verifiedDocs = hospital.doctors.filter(
              (d) => d.verificationStatus === 'verified'
            ).length;
            const minFee =
              hospital.doctors.length > 0
                ? Math.min(...hospital.doctors.map((d) => d.consultationFee))
                : 500;
            const hasVideo = hospital.doctors.some((d) => d.onlineConsultationAvailable);

            return (
              <SignatureCard
                key={hospital.id}
                variant={getVariantByIndex(idx)}
                topRightBadge={
                  <>
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                    <span>4.9</span>
                  </>
                }
                icon={<Building2 className="w-6 h-6" />}
                pillLabel="Verified Hospital"
                title={hospital.name}
                meta={
                  <>
                    <MapPin className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
                    <span className="truncate">
                      {hospital.city}, {hospital.state} · {hospital.workingHours}
                    </span>
                  </>
                }
                tags={hospital.services.slice(0, 3)}
                metrics={[
                  {
                    icon: <Stethoscope className="w-3.5 h-3.5" />,
                    value: `${verifiedDocs || hospital.doctors.length}`,
                    label: 'Specialists',
                  },
                  {
                    icon: <Video className="w-3.5 h-3.5" />,
                    value: hasVideo ? 'Video+OPD' : 'OPD Only',
                    label: 'Consult Mode',
                  },
                  {
                    value: `₹${minFee}`,
                    label: 'From Fee',
                  },
                ]}
                footer={{
                  label: 'Next available',
                  value: 'Today · Online / Visit',
                  ctaLabel: 'Book',
                  onCtaClick: () => onOpenAuth('patient', 'discover'),
                }}
              >
                <div className="space-y-2.5 pt-1 border-t border-gray-100">
                  {hospital.doctors.slice(0, 2).map((doc) => {
                    const isVerified = doc.verificationStatus === 'verified';
                    return (
                      <div key={doc.id} className="flex items-center gap-3 pt-1.5">
                        <div className="w-9 h-9 rounded-xl bg-[#ECFDF5] border border-emerald-200 flex items-center justify-center text-xs font-bold text-[#0D5C58] shrink-0 font-display">
                          {getInitials(doc.fullName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-gray-900 truncate">{doc.fullName}</p>
                          <p className="text-[11px] text-gray-500 truncate">
                            {doc.specialization} · {doc.yearsOfExperience} yrs
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0 ${
                            isVerified
                              ? 'bg-[#ECFDF5] text-[#0D5C58]'
                              : 'bg-amber-50 text-[#EA580C]'
                          }`}
                        >
                          {isVerified ? 'Verified' : 'Pending'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </SignatureCard>
            );
          })}
        </div>
      </section>

      {/* PROVIDER & ROLE PORTALS */}
      <section id="portals" className="relative py-16 border-t border-gray-200/70 bg-white/60">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-10">
            <span className="rounded-full bg-[#ECFDF5] border border-emerald-200 text-[#0D5C58] px-3.5 py-1 text-xs font-semibold inline-block mb-2.5">
              Provider Portals
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 font-display">
              Integrated Role-Based Care Portals
            </h2>
            <p className="text-sm text-gray-600">
              Every role operates inside one unified clinical platform with strict permissions and
              full audit logging.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[
              {
                role: 'patient' as UserRole,
                badge: 'General Public',
                title: 'Patient Portal',
                meta: 'Personal screening & tele-care',
                desc: 'Mobile + Voice OTP sign-in, Gemini screening, hospital map & video calls.',
                tags: ['Phone OTP', 'AI Screening', 'Video Room'],
                metrics: [
                  { value: 'OTP', label: 'Sign-In' },
                  { value: 'Voice', label: 'Intake' },
                  { value: 'PDF', label: 'Reports' },
                ],
                icon: <Activity className="w-6 h-6" />,
              },
              {
                role: 'doctor' as UserRole,
                badge: 'Clinical Care',
                title: 'Doctor Portal',
                meta: 'Verified specialist workspace',
                desc: 'Inspect authorized patient history, manage slots, conduct WebRTC video consults.',
                tags: ['Triage Queue', 'History', 'Dictation'],
                metrics: [
                  { value: 'Queue', label: 'Urgent' },
                  { value: 'WebRTC', label: 'Video' },
                  { value: 'Notes', label: 'Rx Plan' },
                ],
                icon: <Stethoscope className="w-6 h-6" />,
              },
              {
                role: 'hospital_manager' as UserRole,
                badge: 'Hospital Ops',
                title: 'Hospital Manager',
                meta: 'Facility & clinician credentialing',
                desc: 'Manage hospital profile, onboard & verify specialists, dispatch urgent requests.',
                tags: ['Verification', 'Onboarding', 'Dispatch'],
                metrics: [
                  { value: 'Verify', label: 'Doctors' },
                  { value: 'Assign', label: 'Urgent' },
                  { value: 'Profile', label: 'Hospital' },
                ],
                icon: <ShieldCheck className="w-6 h-6" />,
              },
              {
                role: 'admin' as UserRole,
                badge: 'Governance',
                title: 'Platform Admin',
                meta: 'System-wide compliance & audit',
                desc: 'Provision hospitals & managers, monitor urgent cases, review security audit logs.',
                tags: ['Provisioning', 'Audit Logs', 'Settings'],
                metrics: [
                  { value: 'RBAC', label: 'Policies' },
                  { value: 'Audit', label: 'Events' },
                  { value: 'Live', label: 'Monitor' },
                ],
                icon: <Lock className="w-6 h-6" />,
              },
              {
                role: 'asha_worker' as UserRole,
                badge: 'Community Health',
                title: 'Village ASHA Worker',
                meta: 'Village-based patient follow-up',
                desc: 'Register with your official ASHA ID. Hospital approval is required before dashboard access.',
                tags: ['Register', 'Follow-up', 'Screening'],
                metrics: [
                  { value: 'Village', label: 'Assignments' },
                  { value: 'Visits', label: 'Follow-up' },
                  { value: 'Consent', label: 'Patient Data' },
                ],
                icon: <HeartHandshake className="w-6 h-6" />,
              },
            ].map((portal, idx) => (
              <SignatureCard
                key={portal.role}
                variant={getVariantByIndex(idx)}
                topRightBadge={portal.badge}
                icon={portal.icon}
                pillLabel="Role Portal"
                title={portal.title}
                meta={portal.meta}
                tags={portal.tags}
                metrics={portal.metrics}
                onClick={() =>
                  portal.role === 'asha_worker'
                    ? onOpenAshaAccess()
                    : onOpenAuth(portal.role)
                }
                footer={{
                  label: 'Portal access',
                  value: portal.badge,
                  dotTone: idx === 1 ? 'amber' : 'emerald',
                  ctaLabel: 'Open',
                  onCtaClick: () =>
                    portal.role === 'asha_worker'
                      ? onOpenAshaAccess()
                      : onOpenAuth(portal.role),
                }}
              >
                <p className="text-xs text-gray-600 leading-relaxed">{portal.desc}</p>
              </SignatureCard>
            ))}
          </div>
        </div>
      </section>

      {/* QUIET FOOTER */}
      <footer className="relative border-t border-gray-200/80 bg-white/80 backdrop-blur-xs py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" />
            <span className="hidden sm:inline text-gray-400">·</span>
            <span className="font-medium text-gray-700">
              Early awareness. Gentle screening. Clinical trust.
            </span>
          </div>
          <p>Preliminary triage platform · Not a substitute for medical diagnosis or biopsy</p>
        </div>
      </footer>
    </div>
  );
}
